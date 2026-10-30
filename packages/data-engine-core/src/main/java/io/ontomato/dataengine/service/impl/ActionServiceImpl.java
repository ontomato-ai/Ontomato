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
import io.ontomato.dataengine.service.ABCProgramService;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.SandboxService;
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
								if (now - action.getModifyTimestamp() > timeoutTimeRange) {
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
    String businessId = UUID.randomUUID().toString();
    Map<String, Object> jsonRule = adminService.getJSONRule(domainId);
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
            domainId);
    try (var generation =
        generationService.generate("action", businessId, prompt, lang, domainId)) {
      JSONObject envelope = generation.result();
      String code = envelope.getString("code");
      String name = envelope.getString("name");
      String logic = envelope.getString("logic");
      JSONArray classNamesArray = envelope.getJSONArray("classNames");
      if (code == null || name == null || logic == null || classNamesArray == null) {
        return null;
      }
      List<String> classNames = classNamesArray.toList(String.class);
      if (classNames.isEmpty()) {
        return null;
      }
      if (!envelope.containsKey("parameterDefs")) {
        return null;
      }
      JSONArray defsArray = envelope.getJSONArray("parameterDefs");
      if (defsArray == null) {
        return null;
      }
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
      try {
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
      } catch (Exception e) {
      }
      return generation.settle(
          () -> {
            if (persistence) {
              action.setFunction(functionDao.save(function));
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
      if (!Function.OPERATION_WRITE.equals(existFunction.getOperation())) {
        throw new Exception(langService.get(lang, "Function.notWrite"));
      }
      codeChanged = !existFunction.getCode().equals(function.getCode());
    } else if (!Function.OPERATION_WRITE.equals(function.getOperation())) {
      throw new Exception(langService.get(lang, "Function.notWrite"));
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
            action.setFunction(functionDao.save(generatedFunction));
            return actionDao.save(action);
          });
    }
    action.setCodeHash(codeHash);
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    function = functionDao.save(function);
    action.setFunction(function);
    return actionDao.save(action);
  }

  @Override
	public void delete(String id, String lang) throws Exception {
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
        Action action = json.to(Action.class);
        Function function = action.getFunction();
        if (function == null || function.getId() == null) {
          throw new Exception("Action " + actionId + " has no embedded function");
        }
        if (domainId != null) {
          action.setDomainId(domainId);
          function.setDomainId(domainId);
        }
        String codeHash = CodeHashUtil.sha256(function.getCode());
        if (!allowMissingExplanation) {
          if (action.getCodeSegments() == null || action.getCodeSegments().isEmpty()) {
            throw new Exception(
                "Action "
                    + actionId
                    + " has no code explanation; run action re-explain or import with"
                    + " allowMissingExplanation=true");
          }
          if (action.getCodeHash() != null && !action.getCodeHash().equals(codeHash)) {
            throw new Exception(
                "Action "
                    + actionId
                    + " explanation does not match its code; run action re-explain");
          }
        }
        action.setCodeHash(codeHash);
        action.setExplanationVersion(Action.EXPLANATION_VERSION);
        functionDao.save(function);
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

  @Override
	public PythonExecuteResult execute(String id, JSONObject param, String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
		Action action = queryById(id);
		if (action != null) {
			if (Action.STATUS_PUBLISHED.equals(action.getStatus())) {
				Function function = action.getFunction();
				for (Parameter parameter : function.getParameters()) {
					Object value = param.get(parameter.getName());
					parameter.setValue(value);
				}
				Object[] o = abcProgramService.execute(UUID.randomUUID().toString(), function, user.getId(), permission, ServiceConst.NOT_SANDBOX, lang, timeoutMinutes, user.getDomainId());
				PythonExecuteResult result = (PythonExecuteResult)o[1];
				return result;
			} else {
				throw new Exception(langService.get(lang, "Action.notPublished"));
			}
		} else {
			throw new Exception(langService.get(lang, "Action.notFound"));
		}
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
    var schema = adminService.getJSONRule(domainId);
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
