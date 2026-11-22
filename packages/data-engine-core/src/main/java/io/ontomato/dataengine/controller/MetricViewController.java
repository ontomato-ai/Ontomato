package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.bean.function.Function;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewContent;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.BackendSessionEntrance;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.MetricViewForm;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.PanelFormFields;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.SessionCancelledException;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SseEmitterUtil;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class MetricViewController {
    private final io.ontomato.dataengine.service.agent.AgentExecutionScope agentExecutionScope;

    public MetricViewController(io.ontomato.dataengine.service.agent.AgentExecutionScope agentExecutionScope) {
        this.agentExecutionScope = agentExecutionScope;
    }

    @org.springframework.beans.factory.annotation.Autowired
    private io.ontomato.dataengine.service.BuildTestContextService buildTests;


	@Autowired
    private IdentityService identityService;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private MetricViewService metricViewService;
	
	@Autowired
	private LangService langService;

	@Autowired
	private BackendSessionEntrance sessionEntrance;

	@Autowired
	private SubjectDirectory subjectDirectory;

	@Autowired
	private ObjectMapper objectMapper;
	
	@PostMapping("/metricView/generateFromNatureLanguage")
    @ResponseBody
    public JSONObject generateFromNatureLanguage(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
	    	User user = SystemUtils.getCurUser();
			String question = param.getString("question");
			Boolean persistence = param.getBoolean("persistence");
			if (persistence == null) {
				persistence = false;
			}
			MetricView metricView = metricViewService.generateFromNatureLanguage(question, lang, user.getDomainId(), persistence);
			if (metricView == null) {
				throw new Exception(langService.get(lang, "MetricView.notGenerated"));
			}
			ret.put("success", true);
			ret.put("data", metricView);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	/**
	 * The metric a save writes. A request that names its submittedFields changes only those: the saved metric, or a new
	 * one's defaults, with each submitted field taken from the request. Without them, the request is the whole metric.
	 */
	private JSONObject submittedValues(JSONObject param, String domainId, String lang) {
		List<String> submitted = param.getList("submittedFields", String.class);
		param.remove("submittedFields");
		if (submitted == null) return param;
		String id = param.getString("id");
		JSONObject saved;
		if (id == null) {
			saved = MetricViewForm.defaults();
		} else {
			MetricView stored = metricViewService.queryById(id, domainId);
			if (stored == null) throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
			saved = PanelFormFields.asset(stored);
		}
		JSONObject values = PanelFormFields.withSubmitted(saved, param, submitted);
		if (id != null) values.put("id", id);
		return values;
	}

	@PostMapping("/metricView/save")
    @ResponseBody
    public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			if (param.containsKey("type")) throw new OwnerRefusal("METRIC_VIEW_TYPE_RETIRED", "MetricView type is retired; edit parameter bindings on a dynamic metric");
			JSONObject values = submittedValues(param, user.getDomainId(), lang);
            var acceptedFunction = Function.fromAsset(values);
            MetricView metricView = values.to(MetricView.class);
            metricView.setFunction(acceptedFunction);
			metricView.setDomainId(user.getDomainId());
			// The saved Function belongs to the caller's domain whatever the request says; the DAO keys the vector write by it.
			if (metricView.getFunction() != null) {
				metricView.getFunction().setDomainId(user.getDomainId());
			}
			MetricView saved = metricViewService.save(metricView, lang);
            ret.put("data", withDisplay(saved, subjectNames(user.getDomainId()), lang));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/metricView/delete")
    @ResponseBody
    public JSONObject delete(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			metricViewService.delete(id, SystemUtils.getCurUser().getDomainId(), lang);
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/metricView/queryById")
    @ResponseBody
    public JSONObject queryById(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
    		@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			User user = SystemUtils.getCurUser();
			if ("delete-availability".equals(param.getString("purpose"))) {
				var reason = metricViewService.systemDeletionRefusal(id, user.getDomainId(), lang);
				return JSONObject.of("success", true, "data", JSONObject.of("reason", reason));
			}
			MetricView metricView = metricViewService.queryById(id, user.getDomainId());
            if (metricView == null) throw new OwnerRefusal("METRIC_VIEW_NOT_FOUND", langService.get(lang, "MetricView.notFound"));
			ret.put("success", true);
			ret.put("data", withDisplay(metricView, subjectNames(user.getDomainId()), lang));
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/metricView/queryList")
    @ResponseBody
    public JSONObject queryList(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
		@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String status = param.getString("status");
			String origin = param.getString("origin");
			String className = param.getString("className");
			List<MetricView> metricViews = metricViewService.queryList(status, null, className, user.getDomainId());
			if (origin != null && !origin.isBlank()) {
				String expectedOrigin = origin.trim();
				metricViews = metricViews.stream().filter(metric -> expectedOrigin.equals(metric.getOrigin())).toList();
			}
			ret.put("success", true);
			ret.put("data", withDisplay(metricViews, user.getDomainId(), lang));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@GetMapping("/metricView/export")
	public ResponseEntity<byte[]> exportMetricViews(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		try {
			byte[] data = metricViewService.exportMetricViews(SystemUtils.getCurUser().getDomainId(), lang);
			return ResponseEntity.ok()
					.header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"metricViews.zip\"")
					.contentType(MediaType.APPLICATION_OCTET_STREAM)
					.body(data);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			return ResponseEntity.internalServerError().build();
		}
	}

	@PostMapping("/metricView/import")
	@ResponseBody
	public JSONObject importMetricViews(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			@RequestParam("file") MultipartFile file) {
		JSONObject ret = new JSONObject();
		try {
			ret = metricViewService.importMetricViews(file.getBytes(), lang);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/metricView/form")
	@ResponseBody
	public JSONObject form(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("data", metricViewService.form(param, lang, user.getDomainId()));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/metricView/setStatus")
	@ResponseBody
	public JSONObject setStatus(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			List<MetricViewService.StatusResult> results = metricViewService.setStatus(user.getDomainId(),
					statusIds(param), param.getString("status"), lang);
			JSONArray items = new JSONArray();
			for (MetricViewService.StatusResult result : results) {
				if (result.refusal() != null) {
					items.add(result.refusal().item(result.id()));
					continue;
				}
				JSONObject item = JSONObject.of("id", result.id(),
						"outcome", result.error() == null ? "success" : "failure");
				if (result.error() == null) item.put("data", result.data());
				else item.put("error", JSONObject.of("message", result.error()));
				items.add(item);
			}
			ret.put("data", JSONObject.of("items", items));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	/** The ids a batch publication-status change acts on; Jackson binds the request array as a List. */
	private static List<String> statusIds(JSONObject param) {
		Object raw = param.get("ids");
		if (!(raw instanceof List<?> list) || list.isEmpty())
			throw new OwnerRefusal("METRIC_VIEW_STATUS_INVALID", "ids: expected at least one metric id");
		List<String> ids = new ArrayList<>();
		for (Object id : list) {
			if (!(id instanceof String text) || text.isBlank())
				throw new OwnerRefusal("METRIC_VIEW_STATUS_INVALID", "ids: expected metric ids");
			ids.add(text);
		}
		return ids;
	}

	/** The metric's creator and reviewer ids become the names a reader sees; a missing subject stays null. */
	private ObjectNode withDisplay(MetricView metricView, Map<String, String> names, String lang) {
		ObjectNode item = objectMapper.valueToTree(metricView);
		item.put("createdByName", names.get(metricView.getCreatedBy()));
		item.put("reviewedByName", names.get(metricView.getReviewedBy()));
		item.put("statusLabel", statusLabel(metricView.getStatus(), lang));
		item.put("originLabel", originLabel(metricView.getOrigin(), lang));
		return item;
	}

	private ArrayNode withDisplay(List<MetricView> metricViews, String domainId, String lang) {
		Map<String, String> names = subjectNames(domainId);
		ArrayNode items = objectMapper.createArrayNode();
		for (MetricView metricView : metricViews) items.add(withDisplay(metricView, names, lang));
		return items;
	}

	private Map<String, String> subjectNames(String domainId) {
		Map<String, String> names = new HashMap<>();
		for (SubjectDirectory.Subject subject : subjectDirectory.subjectsInDomain(domainId))
			names.put(subject.id(), subject.displayName() == null || subject.displayName().isBlank()
					? subject.loginCode() : subject.displayName());
		return names;
	}

	private String statusLabel(String status, String lang) {
		if (status == null) return null;
		return switch (status) {
			case MetricView.STATUS_PENDING_REVIEW -> langService.get(lang, "PanelForm.status.pendingReview");
			case MetricView.STATUS_PUBLISHED -> langService.get(lang, "PanelForm.status.published");
			case MetricView.STATUS_UNUSED -> langService.get(lang, "PanelForm.status.unused");
			default -> status;
		};
	}

	private String originLabel(String origin, String lang) {
		if (origin == null) return null;
		return switch (origin) {
			case MetricView.ORIGIN_SYSTEM -> langService.get(lang, "PanelForm.origin.system");
			case MetricView.ORIGIN_USER -> langService.get(lang, "PanelForm.origin.user");
			default -> origin;
		};
	}

	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/metricView/find")
    @ResponseBody
    public JSONObject find(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String question = param.getString("question");
			String className = param.getString("className");
			List<MetricView> metricViews;
			if (question == null || "".equals(question.trim())) {
				metricViews = metricViewService.queryList(MetricView.STATUS_PUBLISHED, null, className, user.getDomainId());
			} else {
				metricViews = metricViewService.find(question.trim(), className, user.getDomainId());
			}
			JSONArray metricViewDefs = new JSONArray();
			for (MetricView metricView : metricViews) {
				JSONObject metricViewDef = new JSONObject();
				metricViewDef.put("id", metricView.getId());
				metricViewDef.put("name", metricView.getName());
				metricViewDef.put("logic", metricView.getFunction().getLogic());
                metricViewDef.put("parameters", metricView.getFunction().getParameters());
                metricViewDef.put("bindings", metricView.getBindings());
				metricViewDef.put("returnDef", metricView.getFunction().getReturnDef());
				metricViewDefs.add(metricViewDef);
			}
			ret.put("success", true);
			ret.put("data", metricViewDefs);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.TEST_DATA)
	@PostMapping("/metricView/test")
    @ResponseBody
    public JSONObject test(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param, jakarta.servlet.http.HttpServletRequest executionRequest) {
		JSONObject ret = new JSONObject();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			if (param.containsKey("type")) throw new OwnerRefusal("METRIC_VIEW_TYPE_RETIRED", "MetricView type is retired; edit parameter bindings on a dynamic metric");
            var acceptedFunction = Function.fromAsset(param);
            MetricView metricView = param.to(MetricView.class);
            metricView.setFunction(acceptedFunction);
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			MetricViewContent metricViewContent = metricViewService.test(metricView, lang, user, curUserDataPermission, timeoutMinutes, agentExecutionScope.target(executionRequest,user,curUserDataPermission,buildTests.resolve(executionRequest)));
			ret.put("success", true);
			ret.put("data", metricViewContent);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
            io.ontomato.dataengine.service.ExecutionTarget.failure(ret,e);
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.TEST_DATA)
	@PostMapping("/metricView/execute")
    @ResponseBody
    public JSONObject execute(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param, jakarta.servlet.http.HttpServletRequest executionRequest) {
		JSONObject ret = new JSONObject();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			String id = param.getString("id");
			JSONObject p = param.getJSONObject("param");
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			Object[] o = metricViewService.execute(id, param.getString("bindingId"), p, param.getJSONObject("parameterTexts"), lang, user, curUserDataPermission, timeoutMinutes, agentExecutionScope.target(executionRequest,user,curUserDataPermission,buildTests.resolve(executionRequest)));
			ret.put("success", true);
			ret.put("data", o[0]);
			((PythonExecuteResult)o[1]).markCompleteness(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
            io.ontomato.dataengine.service.ExecutionTarget.failure(ret,e);
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.TEST_DATA)
	@PostMapping("/metricView/testExecute")
    @ResponseBody
    public JSONObject testExecute(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param, jakarta.servlet.http.HttpServletRequest executionRequest) {
		JSONObject ret = new JSONObject();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			var acceptedFunction = Function.fromAsset(param.getJSONObject("metricView"));
            MetricView metricView = param.getJSONObject("metricView").to(MetricView.class);
            metricView.setFunction(acceptedFunction);
			JSONObject p = param.getJSONObject("param");
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			Object[] o = metricViewService.testExecute(metricView, param.getString("bindingId"), p, lang, user, curUserDataPermission, timeoutMinutes, agentExecutionScope.target(executionRequest,user,curUserDataPermission,buildTests.resolve(executionRequest)));
			ret.put("success", true);
			ret.put("data", o[0]);
			((PythonExecuteResult)o[1]).markCompleteness(ret);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
            io.ontomato.dataengine.service.ExecutionTarget.failure(ret,e);
		}
		return ret;
	}

	private String failureMessage(Exception e) {
		String message = e.getMessage();
		if (message == null || message.isBlank()) {
			return e.getClass().getName();
		}
		return message;
	}
	
}
