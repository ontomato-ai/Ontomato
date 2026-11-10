package io.ontomato.dataengine.service.impl;

import java.util.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import io.ontomato.dataengine.service.WriteFunctionOperationService;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.util.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.SandboxService;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class SandboxServiceImpl implements SandboxService {
	
	@Autowired
	private DataRagConfig dataRagConfig;

	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private VectorResourceDao vectorResourceDao;

	@Autowired
	private JSONRuleDao jsonRuleDao;
	
    @Autowired
    private WriteFunctionOperationService writes;

    @Override
    @SuppressWarnings("unchecked")
    public JSONObject bindSample(JSONObject sample, String domain) {
      var config = com.alibaba.fastjson2.JSON.parseObject(com.alibaba.fastjson2.JSON.toJSONString(businessConfigService.get(domain)));
      var classes = sample.getJSONArray("objDatas").toJavaList(JSONObject.class).stream().map(row->row.getString("className")).toList();
      var adapter=getDataAdapter(domain);
      if(!adapter.supportsSandbox(classes)) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY,"BUILD_TEST_UNSUPPORTED");
      var hashes = new JSONObject();
      var connections=config.getJSONObject("dataAdapterConnections");
      connections.forEach((name,connection)->hashes.put(name,io.ontomato.dataengine.service.agent.AgentJson.hash(connection)));
      config.remove("dataAdapterConnections");
      var multi=config.getJSONObject("multiDataSource");
      if(multi!=null) for(var source:multi.getJSONArray("dataSources").toJavaList(JSONObject.class)) {
        hashes.put("source:"+source.getString("id"),io.ontomato.dataengine.service.agent.AgentJson.hash(source.get("connection")));
        source.remove("connection");
      }
      return JSONObject.of("config",config,"connectionHashes",hashes,"rule",jsonRuleDao.query(domain),"classNames",classes);
    }

    @Override
    public void dropSampleStructure(JSONObject binding, JSONArray resources, String domain, java.util.function.Consumer<JSONArray> save) {
      var config=com.alibaba.fastjson2.JSON.parseObject(binding.getJSONObject("config").toJSONString(),BusinessConfig.class);
      var current=businessConfigService.get(domain);
      var hashes=binding.getJSONObject("connectionHashes");
      if("multi".equals(config.getDataAdapter())) {
        for(var source:config.getMultiDataSource().getDataSources()) {
          var present=current.getMultiDataSource()==null ? null : current.getMultiDataSource().source(source.getId());
          if(present==null || !java.util.Objects.equals(source.getAdapterType(),present.getAdapterType()) || !java.util.Objects.equals(hashes.getString("source:"+source.getId()),io.ontomato.dataengine.service.agent.AgentJson.hash(present.getConnection())))
            throw new IllegalStateException("Original source unavailable: "+source.getId());
          source.setConnection(present.getConnection());
        }
      } else {
        var connection=current.getDataAdapterConnections().get(config.getDataAdapter());
        if(!java.util.Objects.equals(hashes.getString(config.getDataAdapter()),io.ontomato.dataengine.service.agent.AgentJson.hash(connection)))
          throw new IllegalStateException("Original source unavailable: "+config.getDataAdapter());
        config.setDataAdapterConnections(current.getDataAdapterConnections());
      }
      var adapter=dataAdapterRegistry.create(config,binding.getJSONObject("rule"));
      for(int index=resources.size()-1;index>=0;index--) {
        var resource=resources.getJSONObject(index);
        if("DELETED".equals(resource.getString("cleanupStatus"))) continue;
        try {
          if("pending".equals(resource.getString("kind"))) throw new IllegalStateException("Resource creation not confirmed: "+resource);
          if("vector".equals(resource.getString("kind"))) vectorResourceDao.dropRecordedVector(resource);
          else adapter.dropRecordedResource(resource);
          resource.put("cleanupStatus","DELETED");save.accept(resources);
        } catch(RuntimeException failure) { resource.put("cleanupStatus","FAILED");save.accept(resources);throw failure; }
      }
    }

    @Override
    @SuppressWarnings("unchecked")
    public void createSampleStructure(String sandbox, JSONObject sample, String domain) {
      var adapter = getDataAdapter(domain);
      var classes = sample.getJSONArray("objDatas").toJavaList(JSONObject.class).stream()
          .map(row -> row.getString("className")).toList();
      if (classes.isEmpty() || !adapter.supportsSandbox(classes))
        throw new IllegalArgumentException("BUILD_TEST_UNSUPPORTED: source does not support sandbox");
      var schema = jsonRuleDao.query(domain);
      var definitions = (List<Map<String, Object>>) schema.get("classDef");
      adapter.createNamespace(sandbox, classes);
      for (var cls : definitions) if (classes.contains(cls.get("className"))) createClass(sandbox, cls, domain);
      var relationships = (Map<String, Map<String, String>>) schema.get("relationship_rule");
      relationships.forEach((name, rel) -> {
        if (classes.contains(rel.get("fromclass")) && classes.contains(rel.get("toclass"))) createEdge(sandbox, name, domain);
      });
    }

    @Override
    @SuppressWarnings("unchecked")
    public void createSampleStructure(String sandbox,JSONObject sample,String domain,java.util.function.Consumer<JSONArray> save) {
      var adapter=getDataAdapter(domain);
      var classes=sample.getJSONArray("objDatas").toJavaList(JSONObject.class).stream().map(row->row.getString("className")).toList();
      var schema=jsonRuleDao.query(domain);
      var definitions=((List<Map<String,Object>>)schema.get("classDef")).stream().filter(cls->classes.contains(cls.get("className"))).toList();
      adapter.validateSandboxClasses(sandbox,definitions);
      var planned=new java.util.ArrayList<JSONObject>();
      for(var cls:definitions) for(String attr:getVectorAttrNames(cls))
        planned.add(vectorResourceDao.plannedSandboxVector(adapter.sandboxClassName(sandbox,(String)cls.get("className")),attr,domain));
      vectorResourceDao.validateSandboxVectorNames(planned);
      var resources=new JSONArray();
      var namespace=JSONObject.of("kind","pending","logicalName",sandbox,"operation","namespace");
      resources.add(namespace);save.accept(resources);
      var namespaces=adapter.createRecordedNamespaces(sandbox,classes);
      resources.clear();resources.addAll(namespaces);save.accept(resources);
      for(var cls:definitions) {
        var resource=JSONObject.of("kind","pending","logicalName",adapter.sandboxClassName(sandbox,(String)cls.get("className")));
        resources.add(resource);save.accept(resources);
        resource.putAll(adapter.createRecordedClass(sandbox,cls));save.accept(resources);
      }
      var relationships=(Map<String,Map<String,String>>)schema.get("relationship_rule");
      relationships.forEach((name,rel)->{if(classes.contains(rel.get("fromclass")) && classes.contains(rel.get("toclass"))) adapter.createEdgeType(sandbox,name);});
      for(var plan:planned) {
        var resource=JSONObject.of("kind","pending","logicalName",plan.getString("logicalName"),"directory",plan.getString("directory"));
        resources.add(resource);save.accept(resources);
        resource.putAll(vectorResourceDao.createRecordedVector(plan,domain));save.accept(resources);
      }
    }

    @Override
    @SuppressWarnings("unchecked")
    public JSONObject validateSample(JSONObject body, Map<String, byte[]> attachments, String domainId) {
    List<Map> objDatas = body.getList("objDatas", Map.class),
        relDatas = body.getList("relDatas", Map.class),
        vectorDatas = body.getList("vectorDatas", Map.class);
    if (objDatas == null || relDatas == null)
      throw AgentHttpException.invalid("objDatas and relDatas are required");
    // Check the object data
    Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
    List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
    Map<String, Map<String, Object>> classDefMap = new HashMap<String, Map<String, Object>>();
    for (Map<String, Object> classDef : classDefs) {
      classDefMap.put((String) classDef.get("className"), classDef);
    }
    Map<String, Set<String>> classIdsMap = new HashMap<String, Set<String>>();
    for (Map<String, Object> objData : objDatas) {
      // ABC and DSL accept both "/orders" and "orders"; fixtures must normalize too, otherwise
      // reset() later stores a class name that the sandbox class map cannot resolve.
      String className =
          DBSchemaUtil.normalizeClassName((String) objData.get("className"), classDefs);
      objData.put("className", className);
      if(classIdsMap.containsKey(className)) throw AgentHttpException.invalid("Duplicate sample class: "+className);
      Map<String, Object> classDef = classDefMap.get(className);
      if (classDef != null) {
        Set<String> attrNameSet = new HashSet<String>();
        String pk = DslUtil.getPrimaryKey(classDef);
        List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
        for (Map<String, Object> attrDef : attrDefs) {
          if (attrDef.get("enable") == null || (Boolean) attrDef.get("enable")) {
            attrNameSet.add((String) attrDef.get("name"));
          }
        }
        Set<String> ids = new HashSet<String>();
        List<Map<String, Object>> rows = (List<Map<String, Object>>) objData.get("rows");
        for (Map<String, Object> row : rows) {
          for (String key : row.keySet()) {
            if (attrDefs.stream().anyMatch(attr -> key.equals(attr.get("name")) && "vector".equals(attr.get("type"))))
              throw AgentHttpException.invalid("Vector fields must be loaded through vectorDatas");
            if (!attrNameSet.contains(key)) {
              throw AgentHttpException.invalid(
                  "The row of Class["
                      + className
                      + "] has a property["
                      + key
                      + "], but that property does not belong to Class["
                      + className
                      + "].");
            }
          }
          if (row.get(pk) != null && !"".equals(((String) row.get(pk)).trim())) {
            String id = ((String) row.get(pk));
            for (String cn : classIdsMap.keySet()) {
              if (classIdsMap.get(cn).contains(id)) {
                throw AgentHttpException.invalid("Property[" + pk + "]: " + id + ", is duplicated.");
              }
            }
            if (ids.contains(id)) {
              throw AgentHttpException.invalid("Property[" + pk + "]: " + id + ", is duplicated.");
            }
            ids.add(id);
          } else {
            throw AgentHttpException.invalid(
                "The row of Class["
                    + className
                    + "] has not primary key property["
                    + pk
                    + "], or the value of primary key property["
                    + pk
                    + "] is null or empty string.");
          }
        }
        classIdsMap.put(className, ids);
      } else {
        throw AgentHttpException.invalid("Class[" + className + "] is not exist.");
      }
    }

    // Check the relationship data
    List<Map<String, Object>> newRelDatas = new ArrayList<Map<String, Object>>();
    Map<String, Object> relationship_rule = (Map<String, Object>) jsonRule.get("relationship_rule");
    for (Map<String, Object> relData : relDatas) {
      String relationName = (String) relData.get("relationName");
      String sourceObjId = (String) relData.get("sourceObjId");
      String targetObjId = (String) relData.get("targetObjId");

      if (relationship_rule.get(relationName) != null) {
        Map<String, String> relationDef = (Map<String, String>) relationship_rule.get(relationName);
        String fromClass = relationDef.get("fromclass");
        String toClass = relationDef.get("toclass");
        Set<String> fromIds = classIdsMap.get(fromClass);
        if (fromIds == null || !fromIds.contains(sourceObjId)) {
          throw AgentHttpException.invalid(
              "The relation data: {relationName:"
                  + relationName
                  + ", sourceObjId: "
                  + sourceObjId
                  + ", targetObjId: "
                  + targetObjId
                  + "}, sourceObjId["
                  + sourceObjId
                  + "] is not in Class["
                  + fromClass
                  + "].");
        }
        Set<String> toIds = classIdsMap.get(toClass);
        if (toIds == null || !toIds.contains(targetObjId)) {
          throw AgentHttpException.invalid(
              "The relation data: {relationName:"
                  + relationName
                  + ", sourceObjId: "
                  + sourceObjId
                  + ", targetObjId: "
                  + targetObjId
                  + "}, targetObjId["
                  + targetObjId
                  + "] is not in Class["
                  + toClass
                  + "].");
        }
        Map<String, Object> newRelData = new HashMap<String, Object>();
        newRelData.put("relationName", relationName);
        newRelData.put("sourceClassName", fromClass);
        newRelData.put("sourceObjId", sourceObjId);
        newRelData.put("targetClassName", toClass);
        newRelData.put("targetObjId", targetObjId);
        newRelDatas.add(newRelData);
      } else {
        throw AgentHttpException.invalid("Relation[" + relationName + "] is not exist.");
      }
    }

    // Check the vector data
    List<Map<String, Object>> newVectorDatas = new ArrayList<Map<String, Object>>();
    if (vectorDatas != null) {
      for (Map<String, Object> vectorData : vectorDatas) {
        String className =
            DBSchemaUtil.normalizeClassName((String) vectorData.get("className"), classDefs);
        String objectId = (String) vectorData.get("objectId");
        String attrName = (String) vectorData.get("attrName");
        String text = (String) vectorData.get("text");
        String file = (String) vectorData.get("file");
        if (vectorData.containsKey("fileId")) throw AgentHttpException.invalid("Use file with uploaded bytes; fileId is not sample data");
        if (file != null && (file.startsWith("/") || file.contains("..") || file.contains("\\") || !attachments.containsKey(file)))
          throw AgentHttpException.invalid("Missing or invalid sample attachment: " + file);
        if(file!=null && !VectorResourceDao.isValidSuffix(file.substring(file.lastIndexOf('.')+1)))
          throw AgentHttpException.invalid("Invalid attachment suffix: "+file);
        Map<String, Object> classDef = classDefMap.get(className);
        if (classDef == null) {
          throw AgentHttpException.invalid("The vector data: Class[" + className + "] is not exist.");
        }
        Set<String> ids = classIdsMap.get(className);
        if (ids == null || !ids.contains(objectId)) {
          throw AgentHttpException.invalid(
              "The vector data: objectId[" + objectId + "] is not in Class[" + className + "].");
        }
        if (attrName == null || "".equals(attrName.trim())) {
          throw AgentHttpException.invalid("The vector data: attrName is empty.");
        }
        boolean isVectorAttr = false;
        List<Map<String, Object>> attrDefs = (List<Map<String, Object>>) classDef.get("attrs");
        for (Map<String, Object> attrDef : attrDefs) {
          if (attrName.equals(attrDef.get("name")) && "vector".equals(attrDef.get("type"))) {
            isVectorAttr = true;
            break;
          }
        }
        if (!isVectorAttr) {
          throw AgentHttpException.invalid(
              "The vector data: attrName["
                  + attrName
                  + "] is not a vector attribute of Class["
                  + className
                  + "].");
        }
        if (text == null || "".equals(text.trim())) {
          throw AgentHttpException.invalid("The vector data: text is empty.");
        }
        Map<String, Object> newVectorData = new HashMap<String, Object>();
        newVectorData.put("className", className);
        newVectorData.put("objectId", objectId);
        newVectorData.put("attrName", attrName);
        newVectorData.put("text", text);
        newVectorData.put("file", file);
        newVectorDatas.add(newVectorData);
      }
    }

    return
        JSONObject.of("objDatas", objDatas, "relDatas", newRelDatas, "vectorDatas", newVectorDatas);
    }

    @Override
    @SuppressWarnings("unchecked")
    public void loadSample(String sandboxId, JSONObject data, Map<String, byte[]> attachments, String domainId) throws Exception {
      Map<String, Object> jsonRule = jsonRuleDao.query(domainId);
      List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
      Map<String, Map<String, Object>> classDefMap = new HashMap<>();
      for (var cls : classDefs) classDefMap.put((String) cls.get("className"), cls);
            JSONArray objDatas = data.getJSONArray("objDatas");
            for (int i = 0; i < objDatas.size(); i++) {
              JSONObject objData = objDatas.getJSONObject(i);
              String className =
                  DBSchemaUtil.normalizeClassName(objData.getString("className"), classDefs);
              objData.put("className", className);
              JSONArray rows = objData.getJSONArray("rows");
              Map<String, Object> classDef = classDefMap.get(className);
              insertObjects(sandboxId, classDef, rows, domainId);
            }

            JSONArray relDatas = data.getJSONArray("relDatas");
            insertRelations(sandboxId, relDatas, domainId);

            JSONArray vectorDatas = data.getJSONArray("vectorDatas");
            if (vectorDatas != null) {
              for (int i = 0; i < vectorDatas.size(); i++) {
                JSONObject vectorData = vectorDatas.getJSONObject(i);
                String className =
                    DBSchemaUtil.normalizeClassName(vectorData.getString("className"), classDefs);
                String objectId = vectorData.getString("objectId");
                String attrName = vectorData.getString("attrName");
                String text = vectorData.getString("text");
                String file = vectorData.getString("file");
                byte[] bytes = file == null ? text.getBytes(StandardCharsets.UTF_8) : attachments.get(file);
                String suffix = file == null ? "txt" : file.substring(file.lastIndexOf('.') + 1);
                writes.appendVector(className, attrName, objectId, text,
                    new ByteArrayInputStream(bytes), suffix, sandboxId, domainId);
              }
            }
    }

	@Override
	public void createNamespace(String tmpNamespace, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
        if (!adapter.supportsSandbox()) throw new IllegalArgumentException("Source does not support sandbox");
		adapter.createNamespace(tmpNamespace);
	}

	@Override
	public void truncateNamespace(String tmpNamespace, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.truncateNamespace(tmpNamespace);
		vectorResourceDao.truncateNamespace(getVectorNamespace(adapter, tmpNamespace), domainId);
	}

	@Override
	public void dropNamespace(String tmpNamespace, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.dropNamespace(tmpNamespace);
		vectorResourceDao.dropNamespace(getVectorNamespace(adapter, tmpNamespace), domainId);
	}

	@Override
	public void createClass(String tmpNamespace, Map<String, Object> classDef, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.createClass(tmpNamespace, classDef);
		String vectorTableName = adapter.sandboxClassName(tmpNamespace, ((String) classDef.get("className")).trim());
		for (String attrName : getVectorAttrNames(classDef)) {
			vectorResourceDao.ensureVectorTable(vectorTableName, attrName, domainId);
		}
	}
	
	/**
	 * The sandbox namespace prefix for vector tables (empty class name yields just the namespace),
	 * used to prefix-scan a sandbox's vector tables on truncate/drop. Delegates to the adapter's
	 * {@code sandboxClassName} so the M3/relational prefix rule stays in one place.
	 */
	private String getVectorNamespace(DataAdapter adapter, String tmpNamespace) {
		return adapter.sandboxClassName(tmpNamespace, "");
	}
	
	private List<String> getVectorAttrNames(Map<String, Object> classDef) {
		List<String> attrNames = new ArrayList<String>();
		List<Map<String, Object>> attrDefs = (List<Map<String, Object>>)classDef.get("attrs");
		for (Map<String, Object> attrDef : attrDefs) {
			if (attrDef.get("enable") == null || (Boolean)attrDef.get("enable")) {
				if ("vector".equals(attrDef.get("type"))) {
					attrNames.add((String)attrDef.get("name"));
				}
			}
		}
		return attrNames;
	}
	
	@Override
	public void createEdge(String tmpNamespace, String edgeName, String domainId) {
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.createEdgeType(tmpNamespace, edgeName);
	}

	@Override
	public void insertObjects(String tmpNamespace, Map<String, Object> classDef, JSONArray objs, String domainId) throws Exception {
		if (objs == null || objs.size() == 0) {
			return;
		}
		
		DataAdapter adapter = getDataAdapter(domainId);
		adapter.insertObjects(tmpNamespace, classDef, objs);
	}

	@Override
	public void insertRelations(String tmpNamespace, JSONArray rels, String domainId) throws Exception {
		if (rels != null) {
			DataAdapter adapter = getDataAdapter(domainId);
			
			for (int i = 0; i < rels.size(); i++) {
				JSONObject rel = rels.getJSONObject(i);
				String relationName = rel.getString("relationName");
				String sourceClassName = rel.getString("sourceClassName");
				String sourceObjId = rel.getString("sourceObjId");
				String targetClassName = rel.getString("targetClassName");
				String targetObjId = rel.getString("targetObjId");
				adapter.createEdge(tmpNamespace, relationName, sourceClassName, sourceObjId, targetClassName, targetObjId);
			}
		}
	}
	
	/** The domain's adapter with its ontomap: writing an edge needs the relationship definitions. */
	private DataAdapter getDataAdapter(String domainId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		return dataAdapterRegistry.create(businessConfig, jsonRuleDao.query(domainId));
	}

}
