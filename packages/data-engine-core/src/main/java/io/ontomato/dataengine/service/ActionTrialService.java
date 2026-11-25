package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.ActionTarget;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.core.exception.ServiceException;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.AgentJson;
import io.ontomato.dataengine.service.impl.ActionCodeExplanationValidator;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.CodeHashUtil;
import io.ontomato.dataengine.util.DBSchemaUtil;
import jakarta.annotation.PostConstruct;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.DependsOn;
import org.springframework.context.annotation.Lazy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Slf4j
@Service
@DependsOn("jdbcInitDb")
public class ActionTrialService {
  public record TrialSummary(String id, String status, String result, String error, Long spendTime, Instant testedAt) {}
  public record PublishBlock(String code, String reason) {}

  private final JdbcTemplate jdbc;
  private final JSONRuleDao schemas;
  private final LangService messages;
  private final ActionService actions;
  private final IdentityService identity;
  private final DataSandboxService sandboxes;
  private final ActionPreconditionService preconditions;
  private final IdentitySnapshotLookup identitySnapshots;
  private final ABCProgramService programs;

  public ActionTrialService(JdbcTemplate jdbc, JSONRuleDao schemas, LangService messages,
      @Lazy ActionService actions, IdentityService identity, DataSandboxService sandboxes,
      ActionPreconditionService preconditions, IdentitySnapshotLookup identitySnapshots, ABCProgramService programs) {
    this.jdbc = jdbc;
    this.schemas = schemas;
    this.messages = messages;
    this.actions = actions;
    this.identity = identity;
    this.sandboxes = sandboxes;
    this.preconditions = preconditions;
    this.identitySnapshots = identitySnapshots;
    this.programs = programs;
  }

  @PostConstruct
  public void initialize() {
    jdbc.execute("""
        CREATE TABLE IF NOT EXISTS action_trials (
          id text PRIMARY KEY,
          domain_id text NOT NULL,
          action_id text,
          digest text NOT NULL,
          status text NOT NULL CHECK (status IN ('PASSED', 'FAILED')),
          result_json text,
          error_message text,
          spend_time_ms bigint,
          created_by text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """);
    jdbc.execute("""
        CREATE INDEX IF NOT EXISTS action_trials_domain_digest_idx
        ON action_trials (domain_id, digest, created_at DESC, id DESC)
        """);
    jdbc.execute("""
        CREATE INDEX IF NOT EXISTS action_trials_action_digest_idx
        ON action_trials (domain_id, action_id, digest, created_at DESC, id DESC)
        """);
  }

  public String digest(String domainId, String code, ActionTarget target, List<Parameter> parameters) {
    return digest(domainId, code, target, parameters, classes(domainId));
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> classes(String domainId) {
    return (List<Map<String, Object>>) schemas.query(domainId).get("classDef");
  }

  private String digest(String domainId, String code, ActionTarget target, List<Parameter> parameters,
      List<Map<String, Object>> classes) {
    var declared = (parameters == null ? List.<Parameter>of() : parameters).stream()
        .map(parameter -> JSONObject.of("name", parameter.getName(), "type", parameter.getType(),
            "classNames", parameter.getClassNames() == null ? List.of() : parameter.getClassNames().stream()
                .map(name -> DBSchemaUtil.normalizeClassName(name, classes)).distinct().sorted().toList()))
        .toList();
    var normalizedTarget = target == null ? null : JSONObject.of(
        "className", DBSchemaUtil.normalizeClassName(target.className(), classes), "keyParameter", target.keyParameter());
    return AgentJson.hash(JSONObject.of("domainId", domainId, "codeHash", CodeHashUtil.sha256(code == null ? "" : code),
        "target", normalizedTarget, "parameters", declared));
  }

  public TrialSummary latest(Action action) {
    if (action == null || action.getFunction() == null) return null;
    Function function = action.getFunction();
    String digest = digest(action.getDomainId(), function.getCode(), action.getTarget(), function.getParameters());
    var rows = jdbc.query("""
        SELECT id, status, result_json, error_message, spend_time_ms, created_at
        FROM action_trials WHERE domain_id=? AND digest=? AND (action_id=? OR action_id IS NULL)
        ORDER BY created_at DESC, id DESC LIMIT 1
        """, (row, index) -> summary(row), action.getDomainId(), digest, action.getId());
    return rows.isEmpty() ? null : rows.getFirst();
  }

  public Map<String, TrialSummary> latestByActions(String domainId, List<Action> actions) {
    var executable = actions.stream().filter(action -> action.getFunction() != null).toList();
    if (executable.isEmpty()) return Map.of();
    var classes = classes(domainId);
    var candidates = executable.stream().map(action -> JSONObject.of("action_id", action.getId(), "digest",
        digest(domainId, action.getFunction().getCode(), action.getTarget(), action.getFunction().getParameters(), classes)))
        .toList();
    var latest = new HashMap<String, TrialSummary>();
    jdbc.query("""
        SELECT candidate.action_id, trial.id, trial.status, trial.result_json,
               trial.error_message, trial.spend_time_ms, trial.created_at
        FROM jsonb_to_recordset(?::jsonb) AS candidate(action_id text, digest text)
        CROSS JOIN LATERAL (
          SELECT id, status, result_json, error_message, spend_time_ms, created_at
          FROM action_trials WHERE domain_id=? AND digest=candidate.digest
            AND (action_id=candidate.action_id OR action_id IS NULL)
          ORDER BY created_at DESC, id DESC LIMIT 1
        ) trial
        """, row -> { latest.put(row.getString("action_id"), summary(row)); },
        JSON.toJSONString(candidates), domainId);
    return Collections.unmodifiableMap(latest);
  }

  private static TrialSummary summary(ResultSet row) throws SQLException {
    return new TrialSummary(row.getString("id"), row.getString("status"), row.getString("result_json"),
        row.getString("error_message"), row.getObject("spend_time_ms", Long.class),
        row.getObject("created_at", OffsetDateTime.class).toInstant());
  }

  public String statusCode(TrialSummary summary) {
    return summary == null ? "notRun" : "PASSED".equals(summary.status()) ? "passed" : "failed";
  }

  public PublishBlock publishBlock(Action action, TrialSummary latest, String lang) {
    return Action.STATUS_PUBLISHED.equals(action.getStatus()) ? null : publicationRequirements(action, () -> latest, lang);
  }

  public void requirePublishable(Action action, String lang) {
    var block = publicationRequirements(action, () -> latest(action), lang);
    if (block != null) throw new OwnerRefusal(block.code(), block.reason());
  }

  private PublishBlock publicationRequirements(Action action, Supplier<TrialSummary> lookup, String lang) {
    if (!ActionCodeExplanationValidator.ready(action))
      return new PublishBlock("ACTION_EXPLANATION_REQUIRED", messages.get(lang, "Action.explanationRequired"));
    TrialSummary latest = lookup.get();
    if (latest == null)
      return new PublishBlock("ACTION_TRIAL_REQUIRED", messages.get(lang, "Action.trialRequired"));
    if (!"PASSED".equals(latest.status()))
      return new PublishBlock("ACTION_TRIAL_FAILED", messages.get(lang, "Action.trialFailed"));
    return null;
  }

  public JSONObject trialSavedAction(String actionId, JSONObject sampleInput, JSONObject parameterValues,
      String lang, User user, UserDataPermission permission, int timeoutMinutes) throws Exception {
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

    try {
      identity.requireActionExecutionAccess(user.getId(), domain);
    } catch (ResponseStatusException error) {
      if (error.getStatusCode().value() != 403) throw error;
      throw forbidden(detail(error));
    }

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
    String digest = digest(domain, function.getCode(), target, function.getParameters());
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
      var result = execute(trialId, action, bound, params, lang, user, permission, timeoutMinutes, sandboxTarget);
      var trial = record(trialId, domain, action.getId(), digest, result, user.getId());
      String status = statusCode(trial);
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
      String lang, User user, UserDataPermission permission, int timeoutMinutes, ExecutionTarget target) throws Exception {
    long started = System.currentTimeMillis();
    try {
      if (action.getTarget() != null) {
        action.getTarget().key(params);
        String targetClass = DBSchemaUtil.normalizeClassName(action.getTarget().className(), classes(user.getDomainId()));
        target.requireClasses(List.of(targetClass));
      }
      var verdict = preconditions.evaluate(action, params, user, permission, target);
      if (!verdict.satisfied())
        return failed(messages.get(lang, "Action.preconditionFailed") + ": " + String.join("; ", verdict.violations()), started);
      var snapshot = identitySnapshots.snapshot(user, user.getDomainId());
      Object[] execution = programs.execute(trialId, function, user.getId(), permission, target.sandboxId(),
          lang, timeoutMinutes, user.getDomainId(), new ABCProgramService.ExecutionContext(null, snapshot, target));
      PythonExecuteResult result = (PythonExecuteResult) execution[1];
      if (passed(result)) {
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

  private static boolean passed(PythonExecuteResult result) {
    return result.getError() == null || result.getError().isBlank();
  }

  public void recordAuthoringTrial(String domainId, String digest, PythonExecuteResult result, String userId) {
    record(UUID.randomUUID().toString(), domainId, null, digest, result, userId);
  }

  private TrialSummary record(String id, String domainId, String actionId, String digest, PythonExecuteResult result,
      String userId) {
    boolean passed = passed(result);
    Instant testedAt = Instant.now();
    var summary = new TrialSummary(id, passed ? "PASSED" : "FAILED", passed ? result.getResult() : null,
        passed ? null : result.getError(), result.getSpendTime(), testedAt);
    jdbc.update("""
        INSERT INTO action_trials
          (id, domain_id, action_id, digest, status, result_json, error_message, spend_time_ms, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, id, domainId, actionId, digest, summary.status(), summary.result(), summary.error(),
        summary.spendTime(), userId, testedAt.atOffset(ZoneOffset.UTC));
    return summary;
  }
}
