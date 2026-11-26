package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ControllerConst;
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
import io.ontomato.dataengine.service.SandboxPermissionService;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.authorization.ManagementOperations.Operation;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import io.ontomato.dataengine.service.vector.VectorRebuildService;
import io.ontomato.dataengine.service.vector.VectorRebuildStatus;
import io.ontomato.dataengine.util.SystemUtils;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
public class BusinessConfigController {

    private static final String GENERAL_READ = "settings.general.read";
    private static final String GENERAL_CHANGE = "settings.general.change";
    private static final String CONNECTIONS_READ = "settings.connections.read";
    private static final String CONNECTIONS_CHANGE = "settings.connections.change";
    private static final String CONNECTIONS_TEST = "settings.connections.test";
    private static final String CONNECTIONS_PROBE = "settings.connections.probe-sandbox";
    private static final String VECTORS_READ = "settings.vectors.read";
    private static final String VECTORS_CHANGE = "settings.vectors.change";
    private static final String DIAGNOSTIC_READ = "records.monitoring.config.read";

    @Component
    public static final class Operations implements ManagementOperations.Contributor {
        @Override
        public List<Operation> managementOperations() {
            return List.of(
                new Operation(GENERAL_READ, "Read general settings", ManagementOperations.Access.READ),
                new Operation(GENERAL_CHANGE, "Change general settings", ManagementOperations.Access.CHANGE),
                new Operation(CONNECTIONS_READ, "Read data connections", ManagementOperations.Access.READ),
                new Operation(CONNECTIONS_CHANGE, "Change data connections", ManagementOperations.Access.CHANGE),
                new Operation(CONNECTIONS_TEST, "Test data connections", ManagementOperations.Access.CHANGE),
                new Operation(CONNECTIONS_PROBE, "Probe the sandbox connection", ManagementOperations.Access.CHANGE),
                new Operation(VECTORS_READ, "Read vector index configuration", ManagementOperations.Access.READ),
                new Operation(VECTORS_CHANGE, "Change vector index configuration", ManagementOperations.Access.CHANGE),
                new Operation(DIAGNOSTIC_READ, "Read monitoring configuration", ManagementOperations.Access.READ));
        }
    }

	@Autowired
	private ManagementRequestAccess management;

	private static final String MULTI = "multi";

	@Autowired
	private BusinessConfigService businessConfigService;



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

	@Autowired
	private SandboxPermissionService sandboxPermissions;
	
	@GetMapping("/businessConfig/vectorRebuildStatus")
    @ResponseBody
    @Owned
    public JSONObject vectorRebuildStatus() {
        User user = management.require(VECTORS_READ);
    	JSONObject ret = new JSONObject();
    	try {
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
    @Owned
    public JSONObject rebuildVectors(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang) {
        User user = management.require(VECTORS_CHANGE);
    	JSONObject ret = new JSONObject();
    	try {
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
    @Owned
    public JSONObject pauseVectorRebuild(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang) {
        User user = management.require(VECTORS_CHANGE);
        JSONObject ret = new JSONObject();
        try {
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
    @Owned
    public JSONObject saveKnowledgeMaxResult(@RequestBody JSONObject input) {
        User user = management.require(GENERAL_CHANGE);
    	JSONObject ret = new JSONObject();
    	try {
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
    @Owned
    public JSONObject saveDslCookerTimeout(@RequestBody JSONObject input) {
        User user = management.require(GENERAL_CHANGE);
    	JSONObject ret = new JSONObject();
    	try {
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
    @Owned
    public JSONObject saveLang(@RequestBody JSONObject input) {
        User user = management.require(GENERAL_CHANGE);
    	JSONObject ret = new JSONObject();
    	try {
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
    @Owned
    public JSONObject useDataAdapter(@RequestBody JSONObject input) {
        User user = management.require(CONNECTIONS_CHANGE);
    	JSONObject ret = new JSONObject();
    	try {
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
            ret.put("data", JSONObject.of("sandboxCapability",
                    sandboxPermissions.check(user.getDomainId(), businessConfig)));
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
    @Owned
    public JSONObject useMultiDataSource(@RequestBody JSONObject input) {
        User user = management.require(CONNECTIONS_CHANGE);
    	JSONObject ret = new JSONObject();
    	try {
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
                    ret.put("data", JSONObject.of("sandboxCapability",
                            sandboxPermissions.check(user.getDomainId(), businessConfig)));
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
	@Owned
	public JSONObject testDataAdapter(@RequestBody JSONObject input) {
		User user = management.require(CONNECTIONS_TEST);
		JSONObject ret = new JSONObject();
		try {
			DataAdapterProvider provider = dataAdapterRegistry.provider(input.getString("type"));
			String sourceId = input.getString("sourceId");
			DataAdapterConnection candidate = connectionOf(provider, input);
			if (connectionSecretCodec != null) {
				BusinessConfig stored = businessConfigService.get(user.getDomainId());
				DataAdapterConnection saved = stored.getDataAdapterConnections().get(provider.type());
				var multiSource = stored.getMultiDataSource();
				if (sourceId != null && !sourceId.isBlank() && multiSource != null) {
					DataSourceEntry source = multiSource.source(sourceId);
					if (source != null && provider.type().equals(source.getAdapterType())) saved = source.getConnection();
				}
				connectionSecretCodec.keepMasked(provider.type(), saved, candidate);
			}
			DataAdapter adapter = dataAdapterRegistry.createForTest(provider.type(), candidate);
			JSONObject report = adapter.testConnection();
			report.put("sandboxCapability", sandboxPermissions.test(user.getDomainId(), provider.type(), candidate, adapter));
			ret.put("data", report);
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
	
    @BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
    @GetMapping("/businessConfig/generalForm")
    @Owned
    public JSONObject generalForm(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String locale) {
        User user = management.require(GENERAL_READ);
        BusinessConfig settings = businessConfigService.get(user.getDomainId());
        JSONObject fields = new JSONObject();
        for (String name : java.util.List.of("knowledgeMaxResult", "dslCookerTimeoutSeconds", "lang")) {
            String key = "GeneralSettings." + name;
            fields.put(name, JSONObject.of("label", langService.get(locale, key), "help", langService.get(locale, key + "Hint")));
        }
        return JSONObject.of(
                "knowledgeMaxResult", settings.getKnowledgeMaxResult(),
                "dslCookerTimeout", settings.getDslCookerTimeout(),
                "lang", settings.getLang(),
                "languages", langService.installedLanguages(),
                "fields", fields);
    }

    @PostMapping("/businessConfig/checkSandboxPermission")
    @Owned
    public JSONObject checkSandboxPermission() {
        User user = management.require(CONNECTIONS_PROBE);
        try {
            return JSONObject.of("success", true,
                    "data", JSONObject.of("sandboxCapability", sandboxPermissions.check(user.getDomainId())));
        } catch (Exception failure) {
            log.error(failure.getMessage(), failure);
            return JSONObject.of("success", false, "message", failure.getMessage());
        }
    }

	@GetMapping("/businessConfig/getConfig")
    @ResponseBody
    @Owned
    public JSONObject getConfig() {
        User user = management.require(CONNECTIONS_READ);
    	JSONObject ret = new JSONObject();
    	try {
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
			// Mask connection secrets on the response copy.
			BusinessConfig view = connectionSecretCodec == null
					? businessConfig
					: connectionSecretCodec.maskedCopy(businessConfig);
			JSONObject data = JSONObject.from(view);
			data.put("sandboxCapability", sandboxPermissions.read(user.getDomainId(), businessConfig));
			ret.put("data", data);
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
    @Owned
    public JSONObject getConfigAndDesc() {
        User user = management.require(DIAGNOSTIC_READ);
    	JSONObject ret = new JSONObject();
    	try {
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
