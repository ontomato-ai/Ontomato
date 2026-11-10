package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.BusinessMeaning;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.config.ServiceConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.schedules.ScheduleJson;
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.ActionFunctionAdmission;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ParameterForms;
import io.ontomato.dataengine.service.SandboxService;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.OntologyGenerationPrompts;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.CodeHashUtil;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.SystemUtils;
import io.ontomato.dataengine.util.ZipBundleUtil;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Slf4j
@Service
public class ActionServiceImpl implements ActionService {

  @Autowired private AdminService adminService;

  @Autowired private BusinessConfigService businessConfigService;

  @Autowired private SandboxService sandboxService;

  @Autowired private ActionDao actionDao;

  @Autowired private FunctionDao functionDao;

  @Autowired private KnowledgeDao knowledgeDao;

  @Autowired private ABCProgramService abcProgramService;

  @Autowired private LangService langService;

  @Autowired private OntologyGenerationService generationService;

  @Autowired private AgentRuntimeClient runtimeClient;

  @Autowired private io.ontomato.dataengine.service.scheduling.OntologyScheduleReferences scheduledReferences;

  @Autowired private io.ontomato.dataengine.service.IdentityService identity;

  @PostConstruct
	public void initService() {
		// Periodically clean up unpublished actions older than 12 hours
		new Thread(new Runnable() {
			@Override
			public void run() {
				Long timeoutTimeRange = 12 * 60 * 60 * 1000L;
				while (true) {
					try {
						Long now = System.currentTimeMillis();
						List<Object[]> oList = actionDao.queryList(Action.STATUS_PENDING_REVIEW, null, null, null);
						for (Object[] o : oList) {
							Action action = (Action)o[0];
							if (!Action.ORIGIN_SYSTEM.equals(action.getOrigin())) {
								if (now - action.getModifyTimestamp() > timeoutTimeRange && !scheduledReferences.referencesAction(action.getId())) {
									actionDao.delete(action.getId());
								}
							}
						}
					} catch (Exception e) {
						log.error(e.getMessage(), e);
					}
					try {
						Thread.sleep(60000L);
					} catch (Exception e) {}
				}
			}
		}).start();
	}

  @Override
  public Action generateFromNatureLanguage(
      String question, String lang, String domainId, boolean persistence) throws Exception {
    return generateFromNatureLanguage(question, lang, domainId, persistence, null);
  }

  @Override
  public List<String> exampleRequests(String lang, String domainId) throws Exception {
    Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
    List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
    StringBuilder schema = new StringBuilder();
    int classCount = 0;
    for (Map<String, Object> cls : classDefs) {
      if (classCount++ >= 8) break;
      String className = String.valueOf(cls.get("className"));
      String showName = cls.get("showName") == null ? className : String.valueOf(cls.get("showName"));
      schema.append("- ").append(showName).append(" (").append(className).append(")");
      Object attrs = cls.get("attrs");
      if (attrs instanceof List<?> list && !list.isEmpty()) {
        schema.append(": ");
        int attrCount = 0;
        for (Object item : list) {
          if (attrCount++ >= 6) break;
          Map<String, Object> attr = (Map<String, Object>) item;
          String name = String.valueOf(attr.get("name"));
          String label = attr.get("showName") == null ? name : String.valueOf(attr.get("showName"));
          schema.append(label).append("(").append(name).append("), ");
        }
      }
      schema.append("\n");
    }
    Object relations = jsonRule.get("relationship_rule");
    if (relations instanceof Map<?, ?> map) {
      int relationCount = 0;
      for (Map.Entry<?, ?> entry : map.entrySet()) {
        if (relationCount++ >= 8) break;
        Object value = entry.getValue();
        if (!(value instanceof Map<?, ?> relation)) continue;
        schema.append("- ").append(entry.getKey()).append(": ")
            .append(relation.get("fromclass")).append(" -> ").append(relation.get("toclass")).append("\n");
      }
    }
    String language = lang != null && lang.startsWith("zh") ? "Chinese" : "English";
    String prompt =
        "You help a user try an ontology **write action** generator. Based on the classes and relations below, "
            + "write exactly 3 very short business-like requests a user could type to change data: create, update or delete an object, "
            + "or create or delete a relation. Never ask for queries, lists, counts, dashboards or reports. "
            + "Each must be one sentence, use display names, avoid IDs and technical jargon, and be feasible as one action. "
            + "Vary the wording and the operation across the three examples. "
            + "Return strict JSON only: {\"examples\":[\"...\",\"...\",\"...\"]}. Language: "
            + language
            + ".\n\nClasses:\n"
            + schema;
    String content =
        runtimeClient.modelText(domainId, UUID.randomUUID().toString(), prompt);
    if (content == null || content.isBlank()) return List.of();
    String json = content.trim();
    int start = json.indexOf('{');
    int end = json.lastIndexOf('}');
    if (start >= 0 && end > start) json = json.substring(start, end + 1);
    JSONObject parsed = JSON.parseObject(json);
    JSONArray examples = parsed == null ? null : parsed.getJSONArray("examples");
    List<String> result = new ArrayList<>();
    if (examples != null) {
      for (int i = 0; i < examples.size() && result.size() < 3; i++) {
        String value = examples.getString(i);
        if (value != null && !value.isBlank()) result.add(value.trim());
      }
    }
    return result;
  }

  @Override
  public Action generateFromNatureLanguage(
      String question,
      String lang,
      String domainId,
      boolean persistence,
      JSONObject structuredSpec)
      throws Exception {
    String businessId = UUID.randomUUID().toString();
    Map<String, Object> jsonRule = generationService.authorizedRule(adminService.getJSONRule(domainId), domainId);
    List<Map<String, Object>> classDefs = (List<Map<String, Object>>) jsonRule.get("classDef");
    String prompt =
        OntologyGenerationPrompts.getActionMakerUserMessage(
            question,
            "",
            knowledgeDao,
            businessConfigService,
            lang,
            langService,
            jsonRule,
            domainId,
            structuredSpec);
    try (var generation =
        generationService.generate("action", businessId, prompt, lang, domainId)) {
      JSONObject envelope = generation.result();
      if (!(envelope.get("code") instanceof String)) throw new IllegalArgumentException("code: expected String; supply this field with its declared JSON type");
      if (!(envelope.get("name") instanceof String)) throw new IllegalArgumentException("name: expected String; supply this field with its declared JSON type");
      if (!(envelope.get("logic") instanceof String)) throw new IllegalArgumentException("logic: expected String; supply this field with its declared JSON type");
      if (!(envelope.get("classNames") instanceof JSONArray)) throw new IllegalArgumentException("classNames: expected JSONArray; supply this field with its declared JSON type");
      if (!(envelope.get("parameterDefs") instanceof JSONArray)) throw new IllegalArgumentException("parameterDefs: expected JSONArray; supply this field with its declared JSON type");
      String code = envelope.getString("code");
      String name = envelope.getString("name");
      String logic = envelope.getString("logic");
      JSONArray classNamesArray = envelope.getJSONArray("classNames");
      if (code == null || code.isBlank()) throw new IllegalArgumentException("code: expected a nonempty Python program with # ontomato-python:2");
      if (name == null || name.isBlank()) throw new IllegalArgumentException("name: expected a nonempty string");
      if (logic == null || logic.isBlank()) throw new IllegalArgumentException("logic: expected a nonempty string explaining the program");
      if (classNamesArray == null || classNamesArray.isEmpty()) throw new IllegalArgumentException("classNames: expected a nonempty array of class names");
      List<String> classNames = classNamesArray.toList(String.class);
      JSONArray defsArray = envelope.getJSONArray("parameterDefs");
      if (defsArray == null) throw new IllegalArgumentException("parameterDefs: expected an array; use [] for no parameters");
      List<Parameter> parameterDefs =
          DBSchemaUtil.buildParameters(defsArray.toList(Map.class), classDefs);
      Function function = new Function();
      function.setOrigin(Function.ORIGIN_USER);
      function.setOperation(Function.OPERATION_WRITE);
      function.setDomainId(domainId);
      function.setName(name);
      function.setParameters(parameterDefs);
      function.setCode(code);
      function.setLogic(logic);

      ReturnDef returnDef = new ReturnDef();
      returnDef.setIsVoid(true);
      returnDef.setClassNames(classNames);
      function.setReturnDef(returnDef);

      Action action = new Action();
      action.setName(function.getName());
      action.setOrigin(Action.ORIGIN_USER);
      action.setFunction(function);
      action.setStatus(Action.STATUS_PUBLISHED);
      action.setDomainId(domainId);
      action.setSubmissionCriteria(envelope.getJSONObject("submissionCriteria"));
      {
        Object[] explain =
            explainCode(
                function.getParameters(),
                function.getCode(),
                action.getDomainId(),
                lang,
                businessId,
                (segments, meaning) -> new Object[] {segments, meaning});
        JSONArray codeSegments = (JSONArray) explain[0];
        BusinessMeaning businessMeaning = (BusinessMeaning) explain[1];
        action.setCodeSegments(codeSegments);
        action.setBusinessMeaning(businessMeaning);
      }
      action.setCodeHash(CodeHashUtil.sha256(function.getCode()));
      action.setExplanationVersion(Action.EXPLANATION_VERSION);
      action.setDefinition(ActionDefinitionProjector.project(action));
      return generation.settle(
          () -> {
            if (persistence) {
              ActionFunctionAdmission.requireSupported(function, langService, lang);
              action.setFunction(functionDao.save(function, lang));
              return actionDao.save(action);
            }
            return action;
          });
    }
  }

  @Override
  public Action save(Action action, String lang) throws Exception {
    JSONArray storedCodeSegments = null;
    BusinessMeaning storedBusinessMeaning = null;
    String storedCodeHash = null;
    Integer storedExplanationVersion = null;
    if (action.getId() != null) {
      Object[] exist = actionDao.queryById(action.getId());
      if (exist == null) {
        throw new Exception(langService.get(lang, "Action.notFound"));
      }
      Action existAction = (Action) exist[0];
      if (Action.ORIGIN_SYSTEM.equals(existAction.getOrigin())) {
        throw new Exception(langService.get(lang, "Action.cannotModifySystem"));
      }
      if (!action.getDomainId().equals(existAction.getDomainId())) {
        throw new Exception(langService.get(lang, "Action.domainMismatch"));
      }
      if (scheduledReferences.referencesAction(action.getId()) && (action.getFunction() == null
          || !java.util.Objects.equals(exist[1], action.getFunction().getId())))
        throw new IllegalArgumentException("A scheduled action must retain its referenced function");
      storedCodeSegments = existAction.getCodeSegments();
      storedBusinessMeaning = existAction.getBusinessMeaning();
      storedCodeHash = existAction.getCodeHash();
      storedExplanationVersion = existAction.getExplanationVersion();
    }
    // Explanations are server-derived. A request cannot supply them; they are reused only when the
    // stored explanation belongs to exactly this code and to the current explanation version.
    action.setCodeSegments(null);
    action.setBusinessMeaning(null);
    Function function = action.getFunction();
    if (function == null) {
      throw new Exception(langService.get(lang, "Function.cannotBeEmpty"));
    }
    ActionFunctionAdmission.requireSupported(function, langService, lang);
    // Vector storage and the domain-scoped asset index key off the function's domain; the
    // controller sets it on the action, so carry it onto a new function before saving.
    if (function.getDomainId() == null || function.getDomainId().isBlank()) {
      function.setDomainId(action.getDomainId());
    }
    boolean codeChanged = true;
    if (function.getId() != null) {
      Function existFunction = functionDao.queryById(function.getId());
      if (existFunction == null) {
        throw new Exception(langService.get(lang, "Function.notFound"));
      }
      codeChanged = !existFunction.getCode().equals(function.getCode());
    }
    String codeHash = CodeHashUtil.sha256(function.getCode());
    boolean reusable =
        !codeChanged
            && storedCodeSegments != null
            && !storedCodeSegments.isEmpty()
            && codeHash != null
            && codeHash.equals(storedCodeHash)
            && storedExplanationVersion != null
            && storedExplanationVersion == Action.EXPLANATION_VERSION;
    if (reusable) {
      action.setCodeSegments(storedCodeSegments);
      action.setBusinessMeaning(storedBusinessMeaning);
    } else {
      Function generatedFunction = function;
      return explainCode(
          function.getParameters(),
          function.getCode(),
          action.getDomainId(),
          lang,
          UUID.randomUUID().toString(),
          (segments, meaning) -> {
            action.setCodeSegments(segments);
            action.setBusinessMeaning(meaning);
            action.setCodeHash(codeHash);
            action.setExplanationVersion(Action.EXPLANATION_VERSION);
            action.setFunction(functionDao.save(generatedFunction, lang));
            return actionDao.save(action);
          });
    }
    action.setCodeHash(codeHash);
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    function = functionDao.save(function, lang);
    action.setFunction(function);
    return actionDao.save(action);
  }

  @Override
	public void delete(String id, String lang) throws Exception {
    if (scheduledReferences.referencesAction(id)) throw new IllegalArgumentException("Action is referenced by a scheduled task");
		Object[] exist = actionDao.queryById(id);
		if (exist != null) {
			Action existAction = (Action)exist[0];
			if (Action.ORIGIN_SYSTEM.equals(existAction.getOrigin())) {
				throw new Exception(langService.get(lang, "Action.cannotDeleteSystem"));
			}
			actionDao.delete(id);
		}
	}

  @Override
	public Action queryById(String id) {
		Object[] o  = actionDao.queryById(id);
		if (o != null) {
			Action action = (Action)o[0];
			String functionId = (String)o[1];
			Function function = functionDao.queryById(functionId);
			action.setFunction(function);
			action.setDefinition(ActionDefinitionProjector.project(action));
			return action;
		} else {
			return null;
		}
	}

  @Override
	public List<Action> queryList(String status, String functionId, String className, String domainId) {
		List<Object[]> oList = actionDao.queryList(status, functionId, className, domainId);
		List<Function> functions = functionDao.queryList(null, null, null);
		Map<String, Function> functionMap = new HashMap<String, Function>();
		for (Function function : functions) {
			functionMap.put(function.getId(), function);
		}
		List<Action> actions = new ArrayList<Action>();
		for (Object[] o : oList) {
			Action action = (Action)o[0];
			String fId = (String)o[1];
			action.setFunction(functionMap.get(fId));
			action.setDefinition(ActionDefinitionProjector.project(action));
			actions.add(action);
		}
		return actions;
	}

  @Override
	public List<Action> find(String question, String className, String domainId) {
		List<Object[]> oList = actionDao.find(question, className, 10, 0, domainId);
		List<Function> functions = functionDao.queryList(null, null, domainId);
		Map<String, Function> functionMap = new HashMap<String, Function>();
		for (Function function : functions) {
			functionMap.put(function.getId(), function);
		}
		List<Action> actions = new ArrayList<Action>();
		for (Object[] o : oList) {
			Action action = (Action)o[0];
			String functionId = (String)o[1];
			action.setFunction(functionMap.get(functionId));
			actions.add(action);
		}
		return actions;
	}

  @Override
	public byte[] exportActions(String lang) throws Exception {
		List<Action> actions = queryList(null, null, null, null);
		String json = JSON.toJSONString(actions, Feature.WriteMapNullValue);
		return ZipBundleUtil.zip("actions.json", json.getBytes(StandardCharsets.UTF_8));
	}

  @Override
  public JSONObject importActions(byte[] zipData, String lang, boolean allowMissingExplanation)
      throws Exception {
    byte[] jsonBytes = ZipBundleUtil.unzipFirstJson(zipData);
    JSONArray array = JSON.parseArray(new String(jsonBytes, StandardCharsets.UTF_8));
    User user = SystemUtils.getCurUser();
    String domainId = user == null ? null : user.getDomainId();
    int successCount = 0;
    JSONArray failures = new JSONArray();
    for (int i = 0; i < array.size(); i++) {
      String actionId = null;
      try {
        JSONObject json = array.getJSONObject(i);
        actionId = json.getString("id");
        if (!(json.get("function") instanceof JSONObject rawFunction)) throw new IllegalArgumentException("Action.function: expected an embedded Function object");
        Function parsedFunction = Function.fromInput(rawFunction);
        Action action = json.to(Action.class);
        action.setFunction(parsedFunction);
        Function function = action.getFunction();
        if (function == null || function.getId() == null) {
          throw new Exception("Action " + actionId + " has no embedded function");
        }
        ActionFunctionAdmission.requireSupported(function, langService, lang);
        if (domainId != null) {
          action.setDomainId(domainId);
          function.setDomainId(domainId);
        }
        String codeHash = CodeHashUtil.sha256(function.getCode());
        if (!allowMissingExplanation || Action.STATUS_PUBLISHED.equals(action.getStatus())) {
          if (action.getCodeSegments() == null || action.getCodeSegments().isEmpty()) {
            throw new Exception(
                "Action "
                    + actionId
                    + " has no code explanation; run action re-explain or import with"
                    + " allowMissingExplanation=true");
          }
          if (!codeHash.equals(action.getCodeHash())) {
            throw new Exception(
                "Action "
                    + actionId
                    + " explanation does not match its code; run action re-explain");
          }
        }
        if (Action.STATUS_PUBLISHED.equals(action.getStatus())) ActionCodeExplanationValidator.requireReady(action);
        action.setCodeHash(codeHash);
        action.setExplanationVersion(Action.EXPLANATION_VERSION);
        functionDao.save(function, lang);
        actionDao.save(action);
        successCount++;
      } catch (Exception e) {
        log.error("Failed to import action {}: {}", actionId, e.getMessage(), e);
        JSONObject failure = new JSONObject();
        failure.put("index", i);
        failure.put("id", actionId);
        failure.put("message", e.getMessage());
        failures.add(failure);
      }
    }
    JSONObject ret = new JSONObject();
    ret.put("success", failures.isEmpty());
    ret.put("successCount", successCount);
    ret.put("failureCount", failures.size());
    ret.put("failures", failures);
    return ret;
  }

  @Override
  public JSONObject reExplainActions(List<String> ids, boolean missingOnly, String lang)
      throws Exception {
    User user = SystemUtils.getCurUser();
    String domainId = user == null ? null : user.getDomainId();
    List<Action> actions = new ArrayList<Action>();
    JSONArray failures = new JSONArray();
    if (ids == null || ids.isEmpty()) {
      actions = queryList(null, null, null, domainId);
    } else {
      for (String id : ids) {
        Action action = queryById(id);
        if (action == null) {
          JSONObject failure = new JSONObject();
          failure.put("id", id);
          failure.put("message", "Action not found");
          failures.add(failure);
        } else {
          actions.add(action);
        }
      }
    }
    int successCount = 0;
    int skippedCount = 0;
    for (Action action : actions) {
      String id = action.getId();
      try {
        if (domainId != null && !domainId.equals(action.getDomainId())) {
          throw new Exception("Action belongs to another domain");
        }
        Function function = action.getFunction();
        if (function == null) {
          throw new Exception("Action has no embedded function");
        }
        String codeHash = CodeHashUtil.sha256(function.getCode());
        boolean ready =
            action.getCodeSegments() != null
                && !action.getCodeSegments().isEmpty()
                && codeHash != null
                && codeHash.equals(action.getCodeHash())
                && Integer.valueOf(Action.EXPLANATION_VERSION)
                    .equals(action.getExplanationVersion());
        if (missingOnly && ready) {
          skippedCount++;
          continue;
        }
        explainCode(
            function.getParameters(),
            function.getCode(),
            action.getDomainId(),
            lang,
            UUID.randomUUID().toString(),
            (segments, meaning) -> {
              action.setCodeSegments(segments);
              action.setBusinessMeaning(meaning);
              action.setCodeHash(codeHash);
              action.setExplanationVersion(Action.EXPLANATION_VERSION);
              return actionDao.save(action);
            });
        successCount++;
      } catch (Exception e) {
        log.error("Failed to re-explain action {}: {}", id, e.getMessage(), e);
        JSONObject failure = new JSONObject();
        failure.put("id", id);
        failure.put("message", e.getMessage());
        failures.add(failure);
      }
    }
    JSONObject ret = new JSONObject();
    ret.put("success", failures.isEmpty());
    ret.put("successCount", successCount);
    ret.put("skippedCount", skippedCount);
    ret.put("failureCount", failures.size());
    ret.put("failures", failures);
    return ret;
  }

  /** The published Action of the user's domain, once the user may execute Actions. */
  private Action executable(String id, String lang, User user) throws Exception {
    identity.requireActionExecutionAccess(user.getId(), user.getDomainId());
    Action action = queryById(id);
    if (action == null) throw new Exception(langService.get(lang, "Action.notFound"));
    if (!user.getDomainId().equals(action.getDomainId()) || action.getFunction() == null ||
        !user.getDomainId().equals(action.getFunction().getDomainId())) throw new IllegalArgumentException("Action is outside the current domain");
    if (!Action.STATUS_PUBLISHED.equals(action.getStatus())) throw new Exception(langService.get(lang, "Action.notPublished"));
    ActionFunctionAdmission.requireSupported(action.getFunction(), langService, lang);
    return action;
  }

  @Override
	public PythonExecuteResult execute(String id, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
        Function function = io.ontomato.dataengine.service.MetricViewBindings.executionWriteFunction(executable(id, lang, user).getFunction(), param);
		Object[] o = abcProgramService.execute(UUID.randomUUID().toString(), function, user.getId(), permission, ServiceConst.NOT_SANDBOX, lang, timeoutMinutes, user.getDomainId());
		PythonExecuteResult result = (PythonExecuteResult)o[1];
        if (result.getError() != null && !result.getError().isBlank()) { result.setResult(null); }
        else result.setResult(o[0] == null ? "{\"completed\":true}" : JSON.toJSONString(JSONObject.of("answer", o[0]), Feature.WriteMapNullValue));
		return result;
	}

  @Override
  public JSONObject form(String id, JSONObject bound, JSONObject submitted, List<String> readOnly, String lang, User user) throws Exception {
    List<Parameter> parameters = executable(id, lang, user).getFunction().getParameters();
    var names = new HashSet<String>();
    for (Parameter parameter : parameters) {
      names.add(parameter.getName());
      if (!ParameterForms.supports(parameter.getType(), ParameterForms.Context.INTERACTIVE))
        throw new IllegalArgumentException("Unsupported parameter type: " + parameter.getType());
    }
    var named = new HashSet<String>(bound.keySet());
    named.addAll(readOnly);
    if (submitted != null) named.addAll(submitted.keySet());
    for (String name : named)
      if (!names.contains(name)) throw new IllegalArgumentException("Unknown parameter: " + name);
    for (String name : readOnly)
      if (!bound.containsKey(name)) throw new IllegalArgumentException("Read-only parameter without a bound value: " + name);
    if (submitted != null)
      for (var entry : submitted.entrySet())
        if (!(entry.getValue() instanceof String)) throw new IllegalArgumentException("The text of " + entry.getKey() + " must be a string");
    var values = ScheduleJson.object();
    for (Parameter parameter : parameters) {
      String name = parameter.getName();
      values.put(name, submitted == null || readOnly.contains(name)
          ? ParameterForms.text(bound.get(name)) : (String) submitted.getOrDefault(name, ""));
    }
    var form = new JSONObject();
    form.put("fields", ParameterForms.fields(parameters, ParameterForms.Context.INTERACTIVE, "", lang));
    form.put("values", values);
    if (submitted == null) {
      form.put("errors", ScheduleJson.array());
      form.put("parameters", null);
      return form;
    }
    var interpreted = ParameterForms.interactive(parameters, values, bound, readOnly, lang);
    form.put("errors", interpreted.errors());
    form.put("parameters", interpreted.errors().isEmpty() ? interpreted.values() : null);
    return form;
  }

  /**
   * Fills the explanation of an already assembled draft Action. Draft creation owns the only
   * explain call; saving the draft reuses this stored result and never explains again.
   */
  public void explainForDraft(Action action, String lang) throws Exception {
    Function function = action.getFunction();
    if (function == null) throw new Exception("The draft has no function");
    explainCode(
        function.getParameters(),
        function.getCode(),
        action.getDomainId(),
        lang,
        UUID.randomUUID().toString(),
        (segments, meaning) -> {
          action.setCodeSegments(segments);
          action.setBusinessMeaning(meaning);
          return null;
        });
  }

  @FunctionalInterface
  private interface ExplanationConsumer<T> {
    T accept(JSONArray segments, BusinessMeaning meaning) throws Exception;
  }

  private <T> T explainCode(
      List<Parameter> parameters,
      String code,
      String domainId,
      String lang,
      String businessId,
      ExplanationConsumer<T> consumer)
      throws Exception {
    var schema = generationService.authorizedRule(adminService.getJSONRule(domainId), domainId);
    String prompt =
        OntologyGenerationPrompts.getActionCodeExplainerUserMessage(
            parameters, schema, lang, langService);
    try (var generation =
        generationService.generate("explain", businessId, prompt, lang, domainId, code)) {
      JSONObject result = generation.result();
      JSONArray segments = ActionCodeExplanationValidator.segments(result);
      BusinessMeaning meaning = ActionCodeExplanationValidator.businessMeaning(result);
      return generation.settle(() -> consumer.accept(segments, meaning));
    } catch (Exception error) {
      throw new Exception(
          langService.get(lang, "Action.parseCodeExplainFailed") + ": " + error.getMessage(),
          error);
    }
  }
}
