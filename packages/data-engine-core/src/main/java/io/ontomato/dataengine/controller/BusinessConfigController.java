package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.BusinessConfig.EmbeddingModelProperties;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.config.ModelKeyMask;
import io.ontomato.dataengine.config.multisource.DataSourceEntry;
import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.ConfigurationProblem;
import io.ontomato.dataengine.dataAdapter.ConnectionSecretCodec;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnectionField;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnectionTester;
import io.ontomato.dataengine.dataAdapter.DataAdapterProvider;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.MultiDataSourceValidator;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRebuildService;
import io.ontomato.dataengine.service.vector.VectorRebuildStatus;
import io.ontomato.dataengine.util.SystemUtils;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
public class BusinessConfigController {

	private static final String MULTI = "multi";

	@Autowired
	private BusinessConfigService businessConfigService;


	@Autowired
	private EmbeddingService embeddingService;

	@Autowired
	private LangService langService;

	@Autowired
	private VectorRebuildService vectorRebuildService;

	/** Optional in unit tests that construct the controller directly; Spring injects it in the app. */
	@Autowired(required = false)
	private ConnectionSecretCodec connectionSecretCodec;

	
	@Autowired
	private DataAdapterRegistry dataAdapterRegistry;

	@Autowired
	private AdminService adminService;
	
	@PostMapping("/businessConfig/testEmbeddingModel")
    @ResponseBody
    public JSONObject testEmbeddingModel(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		EmbeddingModelProperties embeddingModelProperties = JSONObject.parseObject(JSON.toJSONString(input.getJSONObject("modelConfig")), EmbeddingModelProperties.class);
    		if (embeddingModelProperties == null || embeddingModelProperties.getDimensions() == null
    				|| embeddingModelProperties.getDimensions() <= 0) {
    			throw new IllegalArgumentException("modelConfig.dimensions must be a positive integer");
    		}
			EmbeddingModelProperties storedEmbedding = businessConfigService.get(SystemUtils.getCurUser().getDomainId())
					.getEmbeddingModelProperties();
			embeddingModelProperties.setApiKey(ModelKeyMask.restoreEmbedding(embeddingModelProperties.getApiKey(),
					storedEmbedding == null ? null : storedEmbedding.getApiKey()));
    		embeddingModelProperties.setLogRequests(true);
    		embeddingModelProperties.setLogResponses(true);
    		String userContent = input.getString("userContent");
    		if (userContent == null || "".equals(userContent.trim())) {
    			userContent = "Hello";
    		}
    		JSONObject aiContent = embeddingService.testEmbeddingModel(embeddingModelProperties, userContent);
    		ret.put("data", aiContent);
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@PostMapping("/businessConfig/saveEmbeddingModel")
    @ResponseBody
    public JSONObject saveEmbeddingModel(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		EmbeddingModelProperties embeddingModelProperties = JSONObject.parseObject(JSON.toJSONString(input), EmbeddingModelProperties.class);
    		if (embeddingModelProperties == null || embeddingModelProperties.getDimensions() == null
    				|| embeddingModelProperties.getDimensions() <= 0) {
    			throw new IllegalArgumentException("dimensions must be a positive integer");
    		}
			vectorRebuildService.saveEmbeddingModel(user.getDomainId(), lang, embeddingModelProperties);
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}

	@GetMapping("/businessConfig/vectorRebuildStatus")
    @ResponseBody
    public JSONObject vectorRebuildStatus() {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		VectorRebuildStatus status = vectorRebuildService.status(user.getDomainId());
    		ret.put("data", status);
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}

	@PostMapping("/businessConfig/rebuildVectors")
    @ResponseBody
    public JSONObject rebuildVectors(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		vectorRebuildService.start(user.getDomainId(), lang);
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
    @PostMapping("/businessConfig/pauseVectorRebuild")
    @ResponseBody
    public JSONObject pauseVectorRebuild(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang) {
        JSONObject ret = new JSONObject();
        try {
            User user = SystemUtils.getCurUser();
            vectorRebuildService.pause(user.getDomainId(), lang);
            ret.put("success", true);
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            ret.put("success", false);
            ret.put("message", e.getMessage());
        }
        return ret;
    }

	@PostMapping("/businessConfig/saveKnowledgeMaxResult")
    @ResponseBody
    public JSONObject saveKnowledgeMaxResult(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		Integer knowledgeMaxResult = input.getInteger("knowledgeMaxResult");
    		if (knowledgeMaxResult != null) {
    			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
        		businessConfig.setKnowledgeMaxResult(knowledgeMaxResult);
        		businessConfigService.set(businessConfig, user.getDomainId());
    		}
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}

	@PostMapping("/businessConfig/saveDslCookerTimeout")
    @ResponseBody
    public JSONObject saveDslCookerTimeout(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		Long dslCookerTimeout = input.getLong("dslCookerTimeout");
    		if (dslCookerTimeout != null && dslCookerTimeout > 0) {
    			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
        		businessConfig.setDslCookerTimeout(dslCookerTimeout);
        		businessConfigService.set(businessConfig, user.getDomainId());
    		}
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}

	@PostMapping("/businessConfig/saveLang")
    @ResponseBody
    public JSONObject saveLang(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		String lang = input.getString("lang");
    		if (lang != null) {
    			lang = lang.trim();
    		}
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		businessConfig.setLang(lang);
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@GetMapping("/businessConfig/dataAdapters")
    @ResponseBody
    public JSONObject dataAdapters() {
		User user = SystemUtils.getCurUser();
		JSONArray adapters = new JSONArray();
    	for (DataAdapterProvider provider : dataAdapterRegistry.installed()) {
    		JSONObject item = new JSONObject();
    		item.put("type", provider.type());
    		item.put("label", provider.label());
			item.put("requiresJoinFields", provider.requiresJoinFields());
    		item.put("fields", provider.connectionFields());
    		item.put("examples", provider.connectionExamples());
			JSONArray fieldInfos = new JSONArray();
			for (DataAdapterConnectionField field : provider.connectionFieldDefinitions()) {
				JSONObject info = new JSONObject();
				info.put("name", field.name());
				info.put("label", field.label());
				info.put("required", field.required());
				info.put("secret", field.secret());
				info.put("example", field.example());
				info.put("fullWidth", field.fullWidth());
				fieldInfos.add(info);
			}
			item.put("fieldInfos", fieldInfos);
			adapters.add(item);
    	}
		// The current domain's adapter type without its saved connections: what non-management readers need.
		JSONObject data = new JSONObject();
		data.put("currentType", businessConfigService.get(user.getDomainId()).getDataAdapter());
		data.put("adapters", adapters);
    	JSONObject ret = new JSONObject();
    	ret.put("data", data);
    	ret.put("success", true);
		return ret;
	}
	
	@PostMapping("/businessConfig/useDataAdapter")
    @ResponseBody
    public JSONObject useDataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		DataAdapterProvider provider = dataAdapterRegistry.provider(input.getString("type"));
    		if (MULTI.equals(provider.type())) {
    			throw new IllegalArgumentException("The multi data adapter is saved through /businessConfig/useMultiDataSource");
    		}
    		BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		DataAdapterConnection connection = connectionOf(provider, input);
    		if (connectionSecretCodec != null) {
    			connectionSecretCodec.keepMasked(provider.type(),
    					businessConfig.getDataAdapterConnections().get(provider.type()), connection);
    		}
    		businessConfig.getDataAdapterConnections().put(provider.type(), connection);
    		businessConfig.setDataAdapter(provider.type());
    		businessConfigService.set(businessConfig, user.getDomainId());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}

	/**
	 * Switch the current domain to the multi data adapter with the given definition.
	 *
	 * <p>The definition is checked on its own and against the domain's ontomap under the multi adapter's
	 * rules; nothing is saved unless both pass, and a failure lists every located problem. Each source keeps
	 * only the connection fields its type declares. The single-source connections are left untouched.</p>
	 */
	@PostMapping("/businessConfig/useMultiDataSource")
    @ResponseBody
    public JSONObject useMultiDataSource(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		MultiDataSourceDefinition definition = input.to(MultiDataSourceDefinition.class);
    		List<ConfigurationProblem> problems = MultiDataSourceValidator.problems(definition, dataAdapterRegistry);
    		if (problems.isEmpty()) {
    			for (DataSourceEntry source : definition.getDataSources()) {
    				DataAdapterConnection given = source.getConnection();
    				source.setConnection(connectionOf(dataAdapterRegistry.provider(source.getAdapterType()),
    						given == null ? new JSONObject() : JSONObject.from(given)));
    			}
    			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    			if (connectionSecretCodec != null) {
    				connectionSecretCodec.keepMaskedMulti(businessConfig, definition);
    			}
    			businessConfig.setMultiDataSource(definition);
    			businessConfig.setDataAdapter(MULTI);
    			Map<String, Object> jsonRule = adminService.getJSONRule(user.getDomainId());
    			problems = dataAdapterRegistry.create(businessConfig, jsonRule).validateOntoMap(jsonRule);
    			if (problems.isEmpty()) {
    				businessConfigService.set(businessConfig, user.getDomainId());
    				ret.put("success", true);
    				return ret;
    			}
    		}
    		ret.put("success", false);
    		ret.put("message", "Invalid multi-source configuration: "
    				+ String.join("; ", problems.stream().map(ConfigurationProblem::detail).toList()));
    		ret.put("data", JSONObject.of("problems", problems));
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}

	@PostMapping("/businessConfig/testDataAdapter")
    @ResponseBody
    public JSONObject testDataAdapter(@RequestBody JSONObject input) {
    	JSONObject ret = new JSONObject();
    	try {
    		DataAdapterProvider provider = dataAdapterRegistry.provider(input.getString("type"));
    		// A masked secret is resolved from the saved connection for this type; nothing is written.
    		DataAdapterConnection candidate = connectionOf(provider, input);
    		if (connectionSecretCodec != null) {
    			BusinessConfig stored = businessConfigService.get(SystemUtils.getCurUser().getDomainId());
    			connectionSecretCodec.keepMasked(provider.type(),
    					stored.getDataAdapterConnections().get(provider.type()), candidate);
    		}
    		DataAdapter adapter = dataAdapterRegistry.createForTest(provider.type(), candidate);
    		ret.put("data", adapter.testConnection());
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", DataAdapterConnectionTester.failureMessage(e));
    	}
		return ret;
	}

	/**
	 * The request values of the fields this provider declares; undeclared fields are ignored.
	 *
	 * <p>Every declared field is copied by name into the flat connection map, so the shared
	 * controller has no knowledge of url/user/password or of any other adapter's vocabulary.
	 * A value may be sent flat (the normal wire shape) or under {@code properties} (kept as a
	 * compatibility path for clients that already build the nested shape).</p>
	 */
	private static DataAdapterConnection connectionOf(DataAdapterProvider provider, JSONObject input) {
		DataAdapterConnection connection = new DataAdapterConnection();
		JSONObject nested = input.getJSONObject("properties");
		for (String field : provider.connectionFields()) {
			String value = input.getString(field);
			if (value == null && nested != null) {
				value = nested.getString(field);
			}
			if (value != null) {
				connection.put(field, value);
			}
		}
		validateConnection(provider, connection);
		return connection;
	}

	private static void validateConnection(DataAdapterProvider provider, DataAdapterConnection connection) {
		for (DataAdapterConnectionField field : provider.connectionFieldDefinitions()) {
			if (!field.required()) {
				continue;
			}
			String value = connection.get(field.name());
			if (value == null || value.isBlank()) {
				throw new IllegalArgumentException(
						"Connection field '" + field.name() + "' is required");
			}
		}
	}
	
	@GetMapping("/businessConfig/getConfig")
    @ResponseBody
    public JSONObject getConfig() {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
			// Mask the Embedding key on the response's own copy.
			BusinessConfig view = connectionSecretCodec == null
					? businessConfig
					: connectionSecretCodec.maskedCopy(businessConfig);
			ModelKeyMask.maskEmbedding(view.getEmbeddingModelProperties());
			ret.put("data", view);
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
	@GetMapping("/businessConfig/getConfigAndDesc")
    @ResponseBody
    public JSONObject getConfigAndDesc() {
    	JSONObject ret = new JSONObject();
    	try {
    		User user = SystemUtils.getCurUser();
    		JSONObject data = new JSONObject();
			data.put("config", businessConfigService.getDiagnosticConfig(user.getDomainId()));
    		data.put("desc", businessConfigService.getWholeConfigDesc());
    		ret.put("data", data);
    		ret.put("success", true);
    	} catch (Exception e) {
    		log.error(e.getMessage(), e);
    		ret.put("success", false);
    		ret.put("message", e.getMessage());
    	}
		return ret;
	}
	
}
