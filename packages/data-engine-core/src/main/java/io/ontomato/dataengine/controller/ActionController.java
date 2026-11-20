package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.bean.function.Function;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerFieldRefusal;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.agent.ActionCreationService;
import io.ontomato.dataengine.service.impl.ActionDraftService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class ActionController {
    private final io.ontomato.dataengine.service.agent.AgentExecutionScope agentExecutionScope;

    public ActionController(io.ontomato.dataengine.service.agent.AgentExecutionScope agentExecutionScope) {
        this.agentExecutionScope = agentExecutionScope;
    }

    @org.springframework.beans.factory.annotation.Autowired
    private io.ontomato.dataengine.service.BuildTestContextService buildTests;


	@Autowired
    private IdentityService identityService;
	
	@Autowired
	private BusinessConfigService businessConfigService;
	
	@Autowired
	private ActionService actionService;

	@Autowired
	private CaseExecutionGuard caseExecutionGuard;

	@Autowired
	private LangService langService;

	@Autowired
	private ActionDraftService actionDraftService;

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
			List<String> examples = actionService.exampleRequests(lang, user.getDomainId());
			ret.put("success", true);
			ret.put("data", JSONObject.of("examples", examples));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/action/save")
    @ResponseBody
    public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Function acceptedFunction;
			try {
				acceptedFunction = Function.fromAsset(param);
			} catch (IllegalArgumentException e) {
				throw new OwnerFieldRefusal("ACTION_FUNCTION_INVALID", "/function", "invalid_object", e.getMessage());
			}
            Action action = param.to(Action.class);
            action.setFunction(acceptedFunction);
			action.setDomainId(user.getDomainId());
			// The nested Function always belongs to the authenticated caller's domain.
			if (action.getFunction() != null) action.getFunction().setDomainId(user.getDomainId());
			action.setCreatedBy(user.getId());
			if (Action.STATUS_PUBLISHED.equals(action.getStatus())) action.setReviewedBy(user.getId());
			Action saved = actionService.save(action, param.getString("explanationRef"),
					new io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner(user.getId(), user.getDomainId()), lang);
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
	
	@GetMapping("/action/creationAgent")
    @ResponseBody
    public JSONObject creationAgent() {
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
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	/** Saves the draft snapshot directly; it never asks the explain agent to run again. */
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
			actionService.delete(id, lang);
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
	@PostMapping("/action/queryById")
    @ResponseBody
    public JSONObject queryById(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
		@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String id = param.getString("id");
			Action action = actionService.queryById(id);
			ret.put("success", true);
			ret.put("data", action == null ? null : withDisplay(action, subjectNames(user.getDomainId()), lang));
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
			List<Action> actions = actionService.queryList(status, null, className, user.getDomainId());
			ret.put("success", true);
			ret.put("data", withDisplay(actions, user.getDomainId(), lang));
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/action/definitionForm")
	@ResponseBody
	public JSONObject definitionForm(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("data", actionService.definitionForm(param, lang, user.getDomainId()));
			ret.put("success", true);
		} catch (Exception e) {
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
			log.error(e.getMessage(), e);
			return ResponseEntity.internalServerError().build();
		}
	}

	@PostMapping("/action/import")
	@ResponseBody
	public JSONObject importActions(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			@RequestParam("file") MultipartFile file,
			@RequestParam(value = "allowMissingExplanation", required = false, defaultValue = "false") boolean allowMissingExplanation) {
		JSONObject ret = new JSONObject();
		try {
			ret = actionService.importActions(file.getBytes(), lang, allowMissingExplanation);
		} catch (Exception e) {
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
			for (Action action : actions) {
				JSONObject actionDef = new JSONObject();
				actionDef.put("id", action.getId());
				actionDef.put("name", action.getName());
				actionDef.put("logic", action.getFunction().getLogic());
				actionDef.put("parameters", action.getFunction().getParameters());
				actionDef.put("returnDef", action.getFunction().getReturnDef());
				actionDef.put("definition", action.getDefinition());
				actionDefs.add(actionDef);
			}
			ret.put("success", true);
			ret.put("data", actionDefs);
		} catch (Exception e) {
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
	@BuildTestAccess(BuildTestAccess.Access.NO_BUSINESS_DATA)
	@PostMapping("/action/form")
    @ResponseBody
    public JSONObject form(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			JSONObject bound = param.getJSONObject("parameters");
			JSONArray readOnly = param.getJSONArray("readOnlyParameters");
			ret.put("data", actionService.form(param.getString("id"), bound == null ? new JSONObject() : bound,
					param.getJSONObject("values"), readOnly == null ? List.of() : readOnly.toJavaList(String.class),
					lang, SystemUtils.getCurUser()));
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
			caseExecutionGuard.verify(executionRequest, id, user);
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
			BusinessConfig businessConfig = businessConfigService.get(user.getDomainId());
    		int timeoutMinutes = Long.valueOf(businessConfig.getDslCookerTimeout() / 60000).intValue();
			if (timeoutMinutes <= 0) {
				timeoutMinutes = 1;
			}
			PythonExecuteResult result = actionService.execute(id, p, lang, user, curUserDataPermission, timeoutMinutes, agentExecutionScope.target(executionRequest,user,curUserDataPermission,buildTests.resolve(executionRequest)));
			if (result.getError() != null && !"".equals(result.getError().trim())) {
				throw new Exception(result.getError());
			}
			ret.put("success", true);
			ret.put("data", result);
		} catch (OwnerRefusal e) {
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
			caseExecutionGuard.clear();
			for (Path tempFile : tempFiles) {
				try {
					Files.deleteIfExists(tempFile);
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
		return ret;
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
		ObjectNode item = objectMapper.valueToTree(action);
		item.put("createdByName", names.get(action.getCreatedBy()));
		item.put("reviewedByName", names.get(action.getReviewedBy()));
		item.put("statusLabel", statusLabel(action.getStatus(), lang));
		item.put("originLabel", originLabel(action.getOrigin(), lang));
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
		Map<String, String> names = subjectNames(domainId);
		ArrayNode items = objectMapper.createArrayNode();
		for (Action action : actions) items.add(withDisplay(action, names, lang));
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
