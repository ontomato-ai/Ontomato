package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.ActionTarget;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.core.exception.ServiceException;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.DBSchemaUtil;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Runs a saved Action once inside an isolated business-DB sandbox and records the receipt via ActionTrialStore. */
@Slf4j
@Service
public class ActionTrialService {
  @org.springframework.beans.factory.annotation.Autowired
  private OntologyQueryService queries;

  private final ActionTrialStore trials;
  private final LangService messages;
  private final ActionService actions;
  private final io.ontomato.dataengine.service.authorization.ActionAuthorization authorization;
  private final DataSandboxService sandboxes;
  private final ActionPreconditionService preconditions;
  private final IdentitySnapshotLookup identitySnapshots;
  private final ABCProgramService programs;

  public ActionTrialService(ActionTrialStore trials, LangService messages, ActionService actions,
      io.ontomato.dataengine.service.authorization.ActionAuthorization authorization, DataSandboxService sandboxes, ActionPreconditionService preconditions,
      IdentitySnapshotLookup identitySnapshots, ABCProgramService programs) {
    this.trials = trials;
    this.messages = messages;
    this.actions = actions;
    this.authorization = authorization;
    this.sandboxes = sandboxes;
    this.preconditions = preconditions;
    this.identitySnapshots = identitySnapshots;
    this.programs = programs;
  }

  public JSONObject trialSavedAction(String actionId, JSONObject sampleInput, JSONObject parameterValues,
      String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
    return trialSavedAction(actionId, sampleInput, parameterValues, lang, user, permission,
        timeoutMinutes, null);
  }

  public JSONObject trialSavedAction(String actionId, JSONObject sampleInput, JSONObject parameterValues,
      String lang, User user, UserDataPermission permission, int timeoutMinutes, String callerToken)
      throws Exception {
    if (actionId == null || actionId.isBlank()) throw invalid("id: expected a nonempty action id");
    String domain = user.getDomainId();
    Action action = actions.queryById(actionId);
    if (action == null || !domain.equals(action.getDomainId()))
      throw new OwnerRefusal("ACTION_NOT_FOUND", messages.get(lang, "Action.notFound"));
    Function function = action.getFunction();
    if (function == null) throw invalid(messages.get(lang, "Action.functionMissing"));
    if (!domain.equals(function.getDomainId())) throw invalid("Function is outside the current domain");
    try {
      ActionFunctionAdmission.requireSupported(function, messages, lang);
    } catch (IllegalArgumentException error) {
      throw invalid(error.getMessage());
    }

    var subject = authorization.subject(user);
    authorization.requireEdit(subject, action);

    JSONObject sample;
    try {
      sample = sandboxes.validateSample(sampleInput == null
          ? JSONObject.of("objDatas", List.of(), "relDatas", List.of(), "vectorDatas", List.of())
          : sampleInput, Map.of(), domain);
    } catch (AgentHttpException | IllegalArgumentException error) {
      throw invalid(error.getMessage());
    }
    List<String> sampleClasses = sample.getJSONArray("objDatas").toJavaList(JSONObject.class).stream()
        .map(item -> item.getString("className")).distinct().toList();
    if (!sampleClasses.isEmpty()) {
      try {
        if (!QueryAccessService.classScope(permission, sampleClasses).containsAll(sampleClasses))
          throw forbidden("Sample includes classes outside the caller's scope");
      } catch (ResponseStatusException error) {
        throw forbidden(detail(error));
      }
    }

    JSONObject params = parameterValues == null ? new JSONObject() : new JSONObject(parameterValues);
    ActionTarget target = action.getTarget();
    // A missing target key is reported as a failed trial. The other parameters still undergo binding.
    if (target != null) params.putIfAbsent(target.keyParameter(), null);
    Function bound;
    try {
      bound = MetricViewBindings.executionWriteFunction(function, params);
    } catch (IllegalArgumentException error) {
      throw invalid(error.getMessage());
    }
    String digest = trials.digest(domain, function.getCode(), target, function.getParameters());
    String trialId = UUID.randomUUID().toString();
    long expiresAt = System.currentTimeMillis() + timeoutMinutes * 60000L;
    String sandboxId = null;
    try {
      try {
        sandboxId = sandboxes.open(domain, user.getId(), "action-trial:" + trialId, expiresAt, sampleClasses);
        if (sandboxId == null || sandboxId.isBlank())
          throw new IllegalStateException("Sandbox did not register an execution target");
        if (!sampleClasses.isEmpty()) {
          sandboxes.replaceClasses(sandboxId, sampleClasses, sample, domain);
          sandboxes.reset(sandboxId, domain);
        }
      } catch (RuntimeException error) {
        throw new OwnerRefusal("ACTION_TRIAL_SANDBOX_UNAVAILABLE",
            messages.get(lang, "Action.trialSandboxUnavailable") + ": " + detail(error));
      }
      var sandboxTarget = ExecutionTarget.actionTrial(sandboxId, sampleClasses, expiresAt);
      var admission = authorization.requireExecution(subject, action,
          new io.ontomato.dataengine.service.authorization.AuthorizationService.Standalone(), sandboxTarget);
      var result = execute(trialId, action, bound, params, lang, user, permission, timeoutMinutes,
          sandboxTarget, admission, callerToken);
      var trial = trials.record(trialId, domain, action.getId(), digest, result, user.getId());
      String status = trials.statusCode(trial);
      return JSONObject.of("trialId", trial.id(), "actionId", actionId, "digest", digest,
          "status", trial.status(), "passed", "passed".equals(status), "result", trial.result(),
          "error", trial.error(), "spendTime", trial.spendTime(), "testedAt", trial.testedAt().toString(),
          "trialStatus", status, "trialStatusLabel", messages.get(lang, "Action.sandboxTrial." + status));
    } finally {
      if (sandboxId != null && !sandboxId.isBlank()) {
        try {
          sandboxes.close(sandboxId, domain);
        } catch (RuntimeException error) {
          log.error("Could not close action trial sandbox {}", sandboxId, error);
        }
      }
    }
  }

  private PythonExecuteResult execute(String trialId, Action action, Function function, JSONObject params,
      String lang, User user, UserDataPermission permission, int timeoutMinutes, ExecutionTarget target,
      CapabilityGrantLookup.Admission admission, String callerToken) throws Exception {
    long started = System.currentTimeMillis();
    try {
      if (action.getTarget() != null) {
        String key = action.getTarget().key(params);
        String targetClass = DBSchemaUtil.normalizeClassName(action.getTarget().className(), trials.classes(user.getDomainId()));
        target.requireClasses(List.of(targetClass));
        if (!admission.unrestricted() && !queries.actionTargetExists(action.getTarget(), key, admission,
            new QueryAccessService.Access(user, permission, null, null, null).withTarget(target)))
          return failed(messages.get(lang, "Action.targetOutsideScope"), started);
      }
      var verdict = preconditions.evaluate(action, params, user, permission, target);
      if (!verdict.satisfied())
        return failed(messages.get(lang, "Action.preconditionFailed") + ": " + String.join("; ", verdict.violations()), started);
      var snapshot = identitySnapshots.snapshot(user, user.getDomainId());
      var grant = ActionRuntimeGrant.capture(action, user, params,
          new io.ontomato.dataengine.service.authorization.AuthorizationService.Standalone());
      Object[] execution = programs.execute(trialId, function, user.getId(), permission, target.sandboxId(),
          lang, timeoutMinutes, user.getDomainId(),
          new ABCProgramService.ExecutionContext(null, snapshot, target, grant, callerToken));
      PythonExecuteResult result = (PythonExecuteResult) execution[1];
      if (ActionTrialStore.passed(result)) {
        if (execution[0] != null)
          result.setResult(JSON.toJSONString(JSONObject.of("answer", execution[0]), JSONWriter.Feature.WriteMapNullValue));
        else if (result.getResult() == null || result.getResult().isBlank()) result.setResult("{\"completed\":true}");
      }
      return result;
    } catch (ResponseStatusException | IllegalArgumentException | ServiceException error) {
      return failed(detail(error), started);
    }
  }

  private static String detail(RuntimeException error) {
    if (error instanceof ResponseStatusException response && response.getReason() != null && !response.getReason().isBlank())
      return response.getReason();
    String message = error.getMessage();
    return message == null || message.isBlank() ? error.getClass().getSimpleName() : message;
  }

  private static PythonExecuteResult failed(String message, long started) {
    var result = new PythonExecuteResult();
    result.setError(message);
    result.setSpendTime(System.currentTimeMillis() - started);
    return result;
  }

  private static OwnerRefusal invalid(String message) {
    return new OwnerRefusal("ACTION_TRIAL_INVALID", message);
  }

  private static OwnerRefusal forbidden(String message) {
    return new OwnerRefusal("ACTION_TRIAL_FORBIDDEN", message);
  }
}
