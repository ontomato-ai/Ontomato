package io.ontomato.dataengine.service.impl;

import java.io.File;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.VectorResourceService;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import io.ontomato.dataengine.util.DslUtil;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class VectorResourceServiceImpl implements VectorResourceService {
	
	@Autowired
	private VectorResourceDao vectorResourceDao;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;

	@Autowired
	private BusinessConfigService businessConfigService;

	@Autowired
	private JSONRuleDao jsonRuleDao;

	@Autowired
	private EmbeddingService embeddingService;

	@Autowired
	private VectorRetrievalGate retrievalGate;

	/** Texts per embedding request of a batch upload; providers such as DashScope accept at most 10. */
	static final int EMBED_BATCH_SIZE = 10;

	@Override
	public void rebuildIndex(String className, String attrName, String domainId) {
		vectorResourceDao.rebuildIndex(className, attrName, domainId);
	}

	@Override
	public VectorResource save(VectorResource vectorResource, InputStream is, String suffix, String domainId) {
		return vectorResourceDao.insert(vectorResource, is, suffix, domainId);
	}

	@Override
	public VectorResource saveAndAttach(VectorResource vectorResource, InputStream is, String suffix, String domainId) {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		Map<String, Object> classDef = requireClassDef(vectorResource.getClassName(), jsonRule);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfigService.get(domainId), jsonRule);
		return attachNew(vectorResource, is, suffix, domainId, null, classDef, adapter);
	}

	@Override
	public List<JSONObject> saveAndAttachAll(List<VectorResource> vectorResources, String domainId) {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfigService.get(domainId), jsonRule);
		List<JSONObject> results = new ArrayList<>(vectorResources.size());
		for (int from = 0; from < vectorResources.size(); from += EMBED_BATCH_SIZE) {
			List<VectorResource> batch = vectorResources.subList(from, Math.min(from + EMBED_BATCH_SIZE, vectorResources.size()));
			int offset = from;
			// Embedding and storing share one write boundary, so a generation change cannot fall between them.
			results.addAll(retrievalGate.write(domainId, () -> saveBatch(batch, offset, domainId, jsonRule, adapter)));
		}
		return results;
	}

	/** Embed one batch in a single request, then store and attach each resource on its own. */
	private List<JSONObject> saveBatch(List<VectorResource> batch, int offset, String domainId,
			Map<String, Object> jsonRule, DataAdapter adapter) {
		String[] failures = new String[batch.size()];
		List<Integer> embeddable = new ArrayList<>();
		List<String> briefs = new ArrayList<>();
		for (int i = 0; i < batch.size(); i++) {
			VectorResource resource = batch.get(i);
			if (resource.getContent() == null || resource.getContent().trim().isEmpty()) {
				failures[i] = "content is required";
			} else if (resource.getClassName() == null || resource.getAttrName() == null || resource.getObjectId() == null) {
				failures[i] = "className, attrName and objectId are required";
			} else {
				embeddable.add(i);
				briefs.add(vectorResourceDao.replace(resource.getContent()));
			}
		}
		float[][] vectors = new float[batch.size()][];
		if (!briefs.isEmpty()) {
			try {
				List<float[]> embedded = embeddingService.embedAll(briefs, domainId);
				for (int j = 0; j < embeddable.size(); j++) {
					vectors[embeddable.get(j)] = embedded.get(j);
				}
			} catch (Exception e) {
				log.error("Embedding a batch of {} vector resources failed", briefs.size(), e);
				for (int i : embeddable) {
					failures[i] = "embedding failed: " + e.getMessage();
				}
			}
		}
		List<JSONObject> results = new ArrayList<>(batch.size());
		for (int i = 0; i < batch.size(); i++) {
			JSONObject result = new JSONObject();
			result.put("index", offset + i);
			if (failures[i] == null) {
				try {
					VectorResource resource = batch.get(i);
					Map<String, Object> classDef = requireClassDef(resource.getClassName(), jsonRule);
					result.put("data", attachNew(resource, null, null, domainId, vectors[i], classDef, adapter));
				} catch (Exception e) {
					log.error("Saving vector resource {} of the batch failed", offset + i, e);
					failures[i] = e.getMessage() == null ? e.getClass().getName() : e.getMessage();
				}
			}
			result.put("success", failures[i] == null);
			if (failures[i] != null) {
				result.put("message", failures[i]);
			}
			results.add(result);
		}
		return results;
	}

	/** Store one resource ({@code vector} null embeds it here) and append it to the object's vector attribute. */
	private VectorResource attachNew(VectorResource vectorResource, InputStream is, String suffix, String domainId,
			float[] vector, Map<String, Object> classDef, DataAdapter adapter) {
		String originalText = vectorResource.getContent();
		JSONArray current;
		try {
			current = adapter.queryVectorAttr(classDef, vectorResource.getAttrName(), vectorResource.getObjectId());
		} catch (RuntimeException re) {
			throw re;
		} catch (Exception e) {
			throw new RuntimeException("Failed to query vector attribute: " + e.getMessage(), e);
		}

		VectorResource saved = vectorResourceDao.insert(vectorResource, is, suffix, domainId, vector);
		try {
			JSONArray updated = new JSONArray();
			boolean exists = false;
			for (int i = 0; i < current.size(); i++) {
				JSONObject item = current.getJSONObject(i);
				if (saved.getPath().equals(item.getString("path"))) {
					exists = true;
				}
				updated.add(item);
			}
			if (!exists) {
				JSONObject newItem = new JSONObject();
				newItem.put("path", saved.getPath());
				newItem.put("text", originalText);
				updated.add(newItem);
			}
			writeObjectVectorAttr(adapter, classDef, saved.getAttrName(), saved.getObjectId(), updated);
		} catch (Exception e) {
			try {
				vectorResourceDao.delete(saved.getClassName(), saved.getAttrName(), saved.getObjectId(), saved.getPath(), domainId);
			} catch (Exception rollbackEx) {
				e.addSuppressed(rollbackEx);
			}
			if (e instanceof RuntimeException re) {
				throw re;
			}
			throw new RuntimeException("attach vector resource to object failed: " + e.getMessage(), e);
		}
		return saved;
	}

	@Override
	public void deleteAndDetach(String className, String attrName, String objectId, String path, String domainId) {
		Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
		Map<String, Object> classDef = requireClassDef(className, jsonRule);

		BusinessConfig businessConfig = businessConfigService.get(domainId);
		DataAdapter adapter = dataAdapterRegistry.create(businessConfig, jsonRule);

		JSONArray current;
		try {
			current = adapter.queryVectorAttr(classDef, attrName, objectId);
		} catch (RuntimeException re) {
			throw re;
		} catch (Exception e) {
			throw new RuntimeException("Failed to query vector attribute: " + e.getMessage(), e);
		}

		vectorResourceDao.delete(className, attrName, objectId, path, domainId);
		try {
			JSONArray updated = new JSONArray();
			for (int i = 0; i < current.size(); i++) {
				JSONObject item = current.getJSONObject(i);
				if (!path.equals(item.getString("path"))) {
					updated.add(item);
				}
			}
			writeObjectVectorAttr(adapter, classDef, attrName, objectId, updated);
		} catch (RuntimeException re) {
			throw re;
		} catch (Exception e) {
			throw new RuntimeException("detach vector resource from object failed: " + e.getMessage(), e);
		}
	}

	private Map<String, Object> requireClassDef(String className, Map<String, Object> jsonRule) {
		List<Map<String, Object>> classDefs = jsonRule != null ? (List<Map<String, Object>>) jsonRule.get("classDef") : null;
		if (classDefs != null) {
			for (Map<String, Object> cd : classDefs) {
				if (className.equals(cd.get("className"))) {
					return cd;
				}
			}
		}
		throw new IllegalArgumentException("classDef not found for className: " + className);
	}

	private void writeObjectVectorAttr(DataAdapter adapter, Map<String, Object> classDef, String attrName,
			String objectId, JSONArray updated) throws Exception {
		String pkField = DslUtil.getPrimaryKey(classDef);
		JSONObject setValues = new JSONObject();
		setValues.put(attrName, updated);
		JSONObject where = new JSONObject();
		where.put("field", pkField);
		where.put("operator", "=");
		where.put("value", objectId);
		adapter.updateObjects(null, classDef, setValues, where);
	}

	@Override
	public File getFile(String indexName, String fileName) {
		return vectorResourceDao.getFile(indexName, fileName);
	}

}
