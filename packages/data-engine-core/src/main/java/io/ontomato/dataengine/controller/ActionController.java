package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import io.ontomato.dataengine.bean.function.Function;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.security.CaseExecutionGuard;
import io.ontomato.dataengine.service.ActionForm;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.ActionTrialService;
import io.ontomato.dataengine.service.ActionTrialStore;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.PanelFormFields;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.agent.ActionCreationService;
import io.ontomato.dataengine.service.impl.ActionDraftService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import io.ontomato.dataengine.service.authorization.AuthorizationService.WorkflowStep;
import io.ontomato.dataengine.service.ExecutionTarget;
import org.springframework.web.bind.annotation.ExceptionHandler;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
@Owned
public class ActionController {
    private final io.ontomato.dataengine.service.agent.AgentExecutionScope agentExecutionScope;

    public ActionController(io.ontomato.dataengine.service.agent.AgentExecutionScope agentExecutionScope) {
        this.agentExecutionScope = agentExecutionScope;
    }

    @org.springframework.beans.factory.annotation.Autowired
    private io.ontomato.dataengine.service.DataSandboxService buildTests;


	@Autowired
    private IdentityService identityService;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private ActionService actionService;

    @Autowired private ActionAuthorization authorization;

    @ExceptionHandler(ActionAuthorization.Denied.class)
    public ResponseEntity<JSONObject> forbidden(ActionAuthorization.Denied denied) {
        var body = new JSONObject();
        denied.writeTo(body);
        return ResponseEntity.status(403).body(body);
    }

	@Autowired
	private CaseExecutionGuard caseExecutionGuard;

	@Autowired
	private LangService langService;

	@Autowired
	private ActionDraftService actionDraftService;

	@Autowired private ActionTrialService actionTrials;

	@Autowired private ActionTrialStore actionTrialStore;

	@Autowired
	private SubjectDirectory subjectDirectory;

	@Autowired
	private ObjectMapper objectMapper;
	
	@PostMapping("/action/generateFromNatureLanguage")
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
			JSONObject structuredSpec = param.getJSONObject("structuredSpec");
			Action action = actionService.generateFromNatureLanguage(question, lang, user.getDomainId(), persistence, structuredSpec);
			if (action == null) {
				throw new Exception(langService.get(lang, "Action.notGenerated"));
			}
			ret.put("success", true);
			ret.put("data", action);
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/action/exampleRequests")
    @ResponseBody
    public JSONObject exampleRequests(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			authorization.requireCreate(authorization.subject(user));
			List<String> examples = actionService.exampleRequests(lang, user.getDomainId());
			ret.put("success", true);
			ret.put("data", JSONObject.of("examples", examples));
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	/**
	 * The Action a save writes. A request that names its submittedFields changes only those: the saved Action, or a new
	 * one's defaults, with each submitted field taken from the request; a draft's explanation reference travels with it.
	 * Without them, the request is the whole Action.
	 */
	private JSONObject submittedValues(JSONObject param, String domainId, String lang) throws Exception {
		List<String> submitted = param.getList("submittedFields", String.class);
		param.remove("submittedFields");
		if (submitted == null) return param;
		String id = param.getString("id");
		JSONObject saved;
		if (id == null) {
			saved = ActionForm.defaultValues();
		} else {
			Action stored = actionService.queryById(id);
			if (stored == null || !domainId.equals(stored.getDomainId()))
				throw new OwnerRefusal("ACTION_NOT_FOUND", langService.get(lang, "Action.notFound"));
			saved = PanelFormFields.asset(stored);
		}
		JSONObject values = PanelFormFields.withSubmitted(saved, param, submitted);
		if (id != null) values.put("id", id);
		if (param.containsKey("explanationRef")) values.put("explanationRef", param.get("explanationRef"));
		return values;
	}

	@PostMapping("/action/save")
    @ResponseBody
    public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject request) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String requestedStatus = request.getString("status");
			ActionForm.requireDraftStatus(requestedStatus);
			JSONObject param = submittedValues(request, user.getDomainId(), lang);
			Function acceptedFunction;
			try {
				acceptedFunction = Function.fromAsset(param);
			} catch (IllegalArgumentException e) {
				throw new OwnerFieldRefusal("ACTION_FUNCTION_INVALID", "/function", "invalid_object", e.getMessage());
			}
            Action action = param.to(Action.class);
            if (param.get("coauthorIds") != null && (!(param.get("coauthorIds") instanceof List<?> authors)
                    || authors.stream().anyMatch(author -> !(author instanceof String id) || id.isBlank())))
                throw new OwnerFieldRefusal("ACTION_COAUTHORS_INVALID", "/coauthorIds", "invalid_option",
                        "Expected an array of nonempty user IDs.");
            action.setFunction(acceptedFunction);
            action.setStatus(requestedStatus);
			action.setDomainId(user.getDomainId());
			action.setCreatedBy(user.getId());
			Action saved = actionService.save(action, param.getString("explanationRef"),
					new io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner(user.getId(), user.getDomainId()), lang);
			ret.put("data", withDisplay(saved, subjectNames(user.getDomainId(), List.of(saved)), lang));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@GetMapping("/action/creationAgent")
    @ResponseBody
    public JSONObject creationAgent() {
        authorization.requireCreate(authorization.subject(SystemUtils.getCurUser()));
		return JSONObject.of("success", true, "data", JSONObject.of("agentId", ActionCreationService.AGENT));
	}

	/**
	 * Builds a draft from the last files of a conversational action-creation run. The explain
	 * agent runs here once; the returned draft carries its explanation for a direct save.
	 */
	@PostMapping("/action/drafts")
    @ResponseBody
    public JSONObject drafts(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String sessionId = param.getString("sessionId");
			String runId = param.getString("runId");
			if (sessionId == null || runId == null) {
				throw new Exception("sessionId and runId are required");
			}
			JSONObject draft = actionDraftService.create(sessionId, runId, lang);
			ret.put("success", true);
			ret.put("data", draft);
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	/** Saves the snapshot as a pending draft, with explanation work done outside the request. */
	@PostMapping("/action/saveDraft")
    @ResponseBody
    public JSONObject saveDraft(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String draftId = param.getString("draftId");
			if (draftId == null) throw new Exception("draftId is required");
			Action action = actionDraftService.save(draftId, lang);
			ret.put("success", true);
			ret.put("data", action);
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/action/delete")
    @ResponseBody
    public JSONObject delete(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String id = param.getString("id");
			actionService.delete(id, lang, SystemUtils.getCurUser());
			ret.put("success", true);
		} catch (OwnerRefusal e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/action/queryById")
    @ResponseBody
    public JSONObject queryById(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
		@RequestBody JSONObject param, jakarta.servlet.http.HttpServletRequest request) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String id = param.getString("id");
			if ("delete-availability".equals(param.getString("purpose"))) {
				Action action = actionService.queryById(id);
                if (action != null && user.getDomainId().equals(action.getDomainId()))
                    authorization.requireEdit(authorization.subject(user), action);
                var reason = actionService.systemDeletionRefusal(id, user.getDomainId(), lang);
				return JSONObject.of("success", true, "data", JSONObject.of("reason", reason));
			}
			Action action = actionService.queryById(id);
			ret.put("success", true);
			if (action == null || !user.getDomainId().equals(action.getDomainId())) {
				ret.put("data", null);
			} else {
				if ("execute".equals(param.getString("purpose"))) {
                    var target = buildTests.resolve(request);
                    if (!target.testing() && !Action.STATUS_PUBLISHED.equals(action.getStatus()))
                        throw new OwnerRefusal("ACTION_NOT_EXECUTABLE", langService.get(lang, "Action.notPublished"));
                    var subject = authorization.subject(user);
                    authorization.requireExecution(subject, action,
                            new io.ontomato.dataengine.service.authorization.AuthorizationService.Standalone(), target);
                    return JSONObject.of("success", true, "data", executionDefinition(action));
                }
                var subject = authorization.subject(user);
                if ("publication-review".equals(param.getString("purpose"))) authorization.requireEdit(subject, action);
                else authorization.requireDefinition(subject, action);
                ObjectNode display = withDisplay(action, subjectNames(user.getDomainId(), List.of(action)), lang);
				if ("publication-review".equals(param.getString("purpose"))) {
					display.set("sandboxTrialLabel", display.get("trialStatusLabel"));
					if (action.getCodeSegments() == null || action.getCodeSegments().isEmpty())
						display.put("explanationMissingLabel", langService.get(lang, "Action.explanationMissing"));
				}
				ret.put("data", display);
			}
		} catch (OwnerRefusal e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/action/queryList")
    @ResponseBody
    public JSONObject queryList(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
		@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String status = param.getString("status");
			String className = param.getString("className");
            var subject = authorization.subject(user);
            boolean execution = "execute".equals(param.getString("purpose"));
            java.util.function.Predicate<Action> visible = execution
                    ? action -> authorization.standalone(subject, action, ExecutionTarget.LIVE).admitted()
                    : action -> authorization.allowsDefinition(subject, action);
            String selectedStatus = execution ? Action.STATUS_PUBLISHED : status;
            ret.put("success", true);
            if (param.getBooleanValue("countOnly")) {
                ret.put("data", JSONObject.of("total", actionService.count(selectedStatus, null, className, user.getDomainId(), visible)));
            } else {
                var actions = actionService.queryList(selectedStatus, null, className, user.getDomainId()).stream().filter(visible).toList();
                if (execution) ret.put("data", actions.stream().map(ActionController::executionDefinition).toList());
                else ret.put("data", withDisplay(actions, user.getDomainId(), lang));
            }
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

    static JSONObject executionDefinition(Action action) {
        var function = action.getFunction();
        return JSONObject.of("id", action.getId(), "name", action.getName(), "target", action.getTarget(),
                "status", action.getStatus(), "description", action.getDescription(),
                "codeHash", action.getCodeHash(), "approvalMode", action.getApprovalMode(),
                "definition", JSONObject.of("affects", action.getDefinition().get("affects")),
                "function", function == null ? null : JSONObject.of("parameters", function.getParameters()));
    }

	@org.springframework.beans.factory.annotation.Autowired
	private io.ontomato.dataengine.service.SandboxPermissionService sandboxPermissions;

	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@GetMapping("/action/sandboxCapability")
	public JSONObject sandboxCapability() {
		User user = SystemUtils.getCurUser();
		return JSONObject.of("success", true, "data", sandboxPermissions.read(user.getDomainId()));
	}

	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/action/definitionForm")
	@ResponseBody
	public JSONObject definitionForm(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("data", actionService.definitionForm(param, lang, user));
			ret.put("success", true);
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/action/setStatus")
	@ResponseBody
	public JSONObject setStatus(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			List<ActionService.StatusResult> results = actionService.setStatus(user.getDomainId(), user.getId(),
                    statusIds(param), param.getString("status"), lang);
            if (results.stream().allMatch(result -> result.refusal() instanceof ActionAuthorization.Denied))
                throw (ActionAuthorization.Denied) results.getFirst().refusal();
			JSONArray items = new JSONArray();
			for (ActionService.StatusResult result : results) {
				if (result.data() != null) {
					items.add(JSONObject.of("id", result.id(), "outcome", "success", "data", result.data()));
				} else if (result.refusal() != null) {
					items.add(result.refusal().item(result.id()));
				} else {
					items.add(JSONObject.of("id", result.id(), "outcome", "failure",
							"error", JSONObject.of("message", result.error())));
				}
			}
			ret.put("data", JSONObject.of("items", items));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
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
			throw new OwnerRefusal("ACTION_STATUS_INVALID", "ids: expected at least one action id");
		List<String> ids = new ArrayList<>();
		for (Object id : list) {
			if (!(id instanceof String text) || text.isBlank())
				throw new OwnerRefusal("ACTION_STATUS_INVALID", "ids: expected action ids");
			ids.add(text);
		}
		return ids;
	}

	@PostMapping("/action/re-explain")
	@ResponseBody
	public JSONObject reExplainActions(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			@RequestBody(required = false) JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			List<String> ids = new ArrayList<String>();
			JSONArray array = param == null ? null : param.getJSONArray("ids");
			if (array != null) {
				for (int i = 0; i < array.size(); i++) {
					ids.add(array.getString(i));
				}
			}
			Boolean missingOnly = param == null ? null : param.getBoolean("missingOnly");
			ret.put("success", true);
			ret.put("data", actionService.reExplainActions(ids, missingOnly == null || missingOnly, lang));
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@GetMapping("/action/export")
	public ResponseEntity<byte[]> exportActions(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		try {
			byte[] data = actionService.exportActions(lang);
			return ResponseEntity.ok()
					.header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"actions.zip\"")
					.contentType(MediaType.APPLICATION_OCTET_STREAM)
					.body(data);
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			return ResponseEntity.internalServerError().build();
		}
	}

	@PostMapping("/action/import")
	@ResponseBody
	public JSONObject importActions(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			@RequestParam("file") MultipartFile file) {
		JSONObject ret = new JSONObject();
		try {
			ret = actionService.importActions(file.getBytes(), lang);
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/action/find")
    @ResponseBody
    public JSONObject find(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String question = param.getString("question");
			String className = param.getString("className");
			List<Action> actions;
			if (question == null || "".equals(question.trim())) {
				actions = actionService.queryList(Action.STATUS_PUBLISHED, null, className, user.getDomainId());
			} else {
				actions = actionService.find(question.trim(), className, user.getDomainId());
			}
			JSONArray actionDefs = new JSONArray();
            var subject = authorization.subject(user);
            for (Action action : actions) {
                if (!Action.STATUS_PUBLISHED.equals(action.getStatus()) || action.getFunction() == null
                        || !authorization.standalone(subject, action, ExecutionTarget.LIVE).admitted()) continue;
                JSONObject actionDef = new JSONObject();
				actionDef.put("id", action.getId());
				actionDef.put("name", action.getName());
                actionDef.put("description", action.getDescription());
                actionDef.put("status", action.getStatus());
				actionDef.put("parameters", action.getFunction().getParameters());
				actionDef.put("returnDef", action.getFunction().getReturnDef());
				actionDef.put("definition", JSONObject.of("affects", action.getDefinition().get("affects")));
				actionDefs.add(actionDef);
			}
			ret.put("success", true);
			ret.put("data", actionDefs);
		} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	/**
	 * An Action's form: without {@code values} its fields and their initial text from the bound {@code parameters};
	 * with them the field errors, or the typed parameters that {@code /action/execute} then takes.
	 */
	@BuildTestAccess(BuildTestAccess.Access.TEST_DATA)
	@PostMapping("/action/form")
    @ResponseBody
    public JSONObject form(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param,
            jakarta.servlet.http.HttpServletRequest request) {
		JSONObject ret = new JSONObject();
		try {
			JSONObject bound = param.getJSONObject("parameters");
			JSONArray readOnly = param.getJSONArray("readOnlyParameters");
            User user = SystemUtils.getCurUser();
            var permission = identityService.getCurrentUserDataPermission();
            var target = agentExecutionScope.target(request, user, permission, buildTests.resolve(request));
            ret.put("data", actionService.form(param.getString("id"), bound == null ? new JSONObject() : bound,
					param.getJSONObject("values"), readOnly == null ? List.of() : readOnly.toJavaList(String.class),
					lang, user, permission, target));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/action/trial")
	public JSONObject trial(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
			jakarta.servlet.http.HttpServletRequest executionRequest,
			@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			if (!(param.get("id") instanceof String id) || id.isBlank())
				throw new OwnerRefusal("ACTION_TRIAL_INVALID", "id: expected a nonempty action id");
			JSONObject sample = trialObject(param, "sample");
			JSONObject parameters = trialObject(param, "parameters");
			User user = SystemUtils.getCurUser();
			ret.put("data", actionTrials.trialSavedAction(id, sample, parameters, lang, user,
					identityService.getCurrentUserDataPermission(), executionTimeout(user),
					callerToken(executionRequest)));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	private static JSONObject trialObject(JSONObject body, String field) {
		Object value = body.get(field);
		if (value != null && !(value instanceof Map<?, ?>))
			throw new OwnerRefusal("ACTION_TRIAL_INVALID", field + ": expected an object");
		return body.getJSONObject(field);
	}

	private int executionTimeout(User user) {
		BusinessConfig config = businessConfigService.get(user.getDomainId());
		return Math.max(1, (int) (config.getDslCookerTimeout() / 60000));
	}

	@BuildTestAccess(BuildTestAccess.Access.TEST_DATA)
	@PostMapping("/action/execute")
    @ResponseBody
    public JSONObject execute(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang,
    		jakarta.servlet.http.HttpServletRequest executionRequest,
    		@RequestParam("id") String id,
    		@RequestParam("param") String paramJson,
    		@RequestParam(value = "file", required = false) List<MultipartFile> files) {
		JSONObject ret = new JSONObject();
		List<Path> tempFiles = new ArrayList<Path>();
		try {
			UserDataPermission curUserDataPermission = identityService.getCurrentUserDataPermission();
	    	User user = SystemUtils.getCurUser();
			var path = caseExecutionGuard.resolve(executionRequest, id, paramJson, user);
            if (path instanceof WorkflowStep && files != null && !files.isEmpty())
                throw new ActionAuthorization.Denied("WORKFLOW_STEP_FORBIDDEN", "Workflow steps do not accept uploaded files.");
			JSONObject p = JSONObject.parseObject(paramJson);
			if (files != null && !files.isEmpty()) {
				for (String key : p.keySet()) {
					Object value = p.get(key);
					if (value instanceof JSONObject) {
						JSONObject vectorValue = (JSONObject) value;
						String uploadFile = vectorValue.getString("uploadFile");
						if (uploadFile != null && !"".equals(uploadFile.trim())) {
							int idx = Integer.parseInt(uploadFile.trim());
							MultipartFile file = files.get(idx);
							Path saved = saveTempFile(file);
							tempFiles.add(saved);
							vectorValue.put("uploadFilePath", saved.toAbsolutePath().toString());
							vectorValue.remove("uploadFile");
						}
					}
				}
			}
			int timeoutMinutes = executionTimeout(user);
			PythonExecuteResult result = actionService.execute(id, p, lang, user, curUserDataPermission, timeoutMinutes,
				agentExecutionScope.target(executionRequest,user,curUserDataPermission,buildTests.resolve(executionRequest)), path,
				callerToken(executionRequest));
			if (result.getError() != null && !"".equals(result.getError().trim())) {
				throw new Exception(result.getError());
			}
			ret.put("success", true);
			ret.put("data", result);
		} catch (OwnerRefusal e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
            if (e instanceof org.springframework.web.server.ResponseStatusException denied && denied.getStatusCode().value() == 403) {
                ((ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()).getResponse().setStatus(403);
                ret.put("code", 403);
            }
            io.ontomato.dataengine.service.ExecutionTarget.failure(ret,e);
		} finally {
			for (Path tempFile : tempFiles) {
				try {
					Files.deleteIfExists(tempFile);
				} catch (Exception e) {
            if (e instanceof ActionAuthorization.Denied denied) throw denied;
					log.error(e.getMessage(), e);
				}
			}
		}
		return ret;
	}

	private static String callerToken(jakarta.servlet.http.HttpServletRequest request) {
		String token = request.getHeader("tk");
		if (token == null || token.isBlank()) {
			String authorization = request.getHeader("Authorization");
			if (authorization != null && authorization.regionMatches(true, 0, "Bearer ", 0, 7))
				token = authorization.substring(7);
		}
		return token == null || token.isBlank() ? null : token.trim();
	}
	
	private Path saveTempFile(MultipartFile file) throws Exception {
		File dir = new File("conf/abcProgramWorkspaces/");
		dir.mkdirs();
		String name = UUID.randomUUID().toString() + "_" + file.getOriginalFilename();
		Path saved = Paths.get(dir.getPath(), name);
		Files.copy(file.getInputStream(), saved);
		return saved;
	}

	/** The action's creator and reviewer ids become the names a reader sees; a missing subject stays null. */
	private ObjectNode withDisplay(Action action, Map<String, String> names, String lang) {
		return withDisplay(action, names, lang, actionTrialStore.latest(action));
	}

	private ObjectNode withDisplay(Action action, Map<String, String> names, String lang, ActionTrialStore.TrialSummary latest) {
		ObjectNode item = objectMapper.valueToTree(action);
		item.put("createdByName", names.get(action.getCreatedBy()));
		item.put("reviewedByName", names.get(action.getReviewedBy()));
		item.put("statusLabel", statusLabel(action.getStatus(), lang));
		item.put("originLabel", originLabel(action.getOrigin(), lang));
		String trialStatus = actionTrialStore.statusCode(latest);
		var block = actionTrialStore.publishBlock(action, latest, lang);
		item.put("trialStatus", trialStatus);
		item.put("trialStatusLabel", langService.get(lang, "Action.sandboxTrial." + trialStatus));
		item.put("lastTrialAt", latest == null ? null : latest.testedAt().toString());
		item.put("lastTrialError", "failed".equals(trialStatus) ? latest.error() : null);
		item.put("publishBlockedCode", block == null ? null : block.code());
		item.put("publishBlockedReason", block == null ? null : block.reason());
		labelKinds(item.path("codeSegments"), lang);
		labelKinds(item.path("definition").path("effects"), lang);
		return item;
	}

	/** Each explained code segment at every depth, and each derived effect, named by its kind in the reader's language. */
	private void labelKinds(JsonNode items, String lang) {
		for (JsonNode node : items) {
			ObjectNode item = (ObjectNode) node;
			item.put("kindLabel", langService.get(lang, "ActionSegment.kind." + item.path("kind").asText()));
			labelKinds(item.path("segs"), lang);
			labelKinds(item.path("trySegs"), lang);
			for (JsonNode group : item.path("catchs")) labelKinds(group.path("segs"), lang);
			for (JsonNode group : item.path("branchArms")) labelKinds(group.path("segs"), lang);
		}
	}

	private ArrayNode withDisplay(List<Action> actions, String domainId, String lang) {
		Map<String, String> names = subjectNames(domainId, actions);
		ArrayNode items = objectMapper.createArrayNode();
		var trials = actionTrialStore.latestByActions(domainId, actions);
		for (Action action : actions) items.add(withDisplay(action, names, lang, trials.get(action.getId())));
		return items;
	}

	private Map<String, String> subjectNames(String domainId, List<Action> actions) {
		var ids = actions.stream().flatMap(row -> Stream.of(row.getCreatedBy(), row.getReviewedBy()))
				.filter(Objects::nonNull).collect(Collectors.toSet());
		return subjectDirectory.displayNamesInDomain(domainId, ids);
	}

	private String statusLabel(String status, String lang) {
		if (status == null) return null;
		return switch (status) {
			case Action.STATUS_PENDING_REVIEW -> langService.get(lang, "PanelForm.status.pendingReview");
			case Action.STATUS_PUBLISHED -> langService.get(lang, "PanelForm.status.published");
			case Action.STATUS_UNUSED -> langService.get(lang, "PanelForm.status.unused");
			default -> status;
		};
	}

	private String originLabel(String origin, String lang) {
		if (origin == null) return null;
		return switch (origin) {
			case Action.ORIGIN_SYSTEM -> langService.get(lang, "PanelForm.origin.system");
			case Action.ORIGIN_USER -> langService.get(lang, "PanelForm.origin.user");
			default -> origin;
		};
	}
	
}
