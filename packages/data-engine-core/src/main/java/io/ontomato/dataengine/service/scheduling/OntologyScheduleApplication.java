package io.ontomato.dataengine.service.scheduling;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.config.ServiceConst;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.schedules.*;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.util.ErrorText;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class OntologyScheduleApplication implements ScheduleApplication {
  /** A saved task holds each parameter's text under this prefix and the parameter's name. */
  private static final String PARAMETER_KEY = "parameter:";

  private final FunctionDao functions;
  private final ActionService actions;
  private final ABCProgramService programs;
  private final BusinessConfigService configs;
  private final IdentityService identity;
  private final OntologyScheduleReferences references;
  private final CapabilityGrantLookup grants;

  public String id() {
    return "ontology";
  }

  public String description(String locale) {
    return locale.startsWith("zh") ? "执行一个动作或函数" : "Execute an action or function";
  }

  public void authorize(Actor actor) {
    for (Action action : actions.queryList(Action.STATUS_PUBLISHED, null, null, actor.domain())) {
      if (action.getFunction() != null && actor.domain().equals(action.getFunction().getDomainId())
          && unsupportedReason(action.getFunction(), actor.locale()) == null && permitted(action.getId(), actor)) return;
    }
    if (permitted(null, actor) && functions.queryList(Function.OPERATION_WRITE, null, actor.domain()).stream()
        .anyMatch(f -> unsupportedReason(f, actor.locale()) == null)) return;
    throw denied(actor);
  }

  @Override
  public void authorize(Actor actor, JsonNode content) {
    String selection = content.path("execution").asText("");
    if (selection.isBlank()) { authorize(actor); return; }
    int split = selection.indexOf(':');
    if (split < 1) throw unavailable();
    String actionId = switch (selection.substring(0, split)) {
      case "action" -> selection.substring(split + 1);
      case "function" -> null;
      default -> throw unavailable();
    };
    if (!permitted(actionId, actor)) throw denied(actor);
  }

  private boolean permitted(String actionId, Actor actor) {
    try {
      if (actionId != null) return grants.admission(actor.creator(), actor.domain(), CapabilityGrantLookup.ACTION, actionId).admitted();
      identity.requireActionExecutionAccess(actor.creator(), actor.domain());
      return true;
    } catch (org.springframework.web.server.ResponseStatusException denied) {
      if (denied.getStatusCode().value() != 403) throw denied;
      return false;
    }
  }

  private ScheduleException denied(Actor actor) {
    return new ScheduleException(403, "PERMISSION_DENIED", zh(actor)
        ? "你没有执行动作或函数的权限" : "You do not have permission to execute actions or functions");
  }

  public boolean asynchronous() {
    return false;
  }

  public int deadlineMinutes(Execution execution) {
    return Math.max(1, configs.get(execution.domainId()).getReportCardPythonTimeout()) + 1;
  }

  private record Target(Action action, Function function, String label) {
    String actionId() { return action == null ? null : action.getId(); }
  }

  private Target target(String value, String domain, String locale) {
    int split = value.indexOf(':');
    if (split < 1) throw unavailable();
    String kind = value.substring(0, split), id = value.substring(split + 1);
    if (kind.equals("action")) {
      var action = actions.queryById(id);
      if (action == null
          || !domain.equals(action.getDomainId())
          || !Action.STATUS_PUBLISHED.equals(action.getStatus())
          || action.getFunction() == null
          || !domain.equals(action.getFunction().getDomainId())) throw unavailable();
      String reason = unsupportedReason(action.getFunction(), locale);
      if (reason != null) throw new ScheduleException(422, "TARGET_UNAVAILABLE", reason);
      return new Target(action, action.getFunction(), label(action.getName(), id));
    }
    if (!kind.equals("function")) throw unavailable();
    var function = functions.queryById(id);
    if (function == null || !domain.equals(function.getDomainId())) throw unavailable();
    String reason = unsupportedReason(function, locale);
    if (reason != null) throw new ScheduleException(422, "TARGET_UNAVAILABLE", reason);
    return new Target(null, function, label(function.getName(), id));
  }

  private static String unsupportedReason(Function function, String locale) {
    String reason = unsupported(function);
    return reason != null
        ? reason
        : PythonProgramProtocol.unavailableReason(function.getCode(), locale);
  }

  /** Whether a function can run on a schedule: a write function whose parameters fit the form and can be scheduled. */
  private static String unsupported(Function function) {
    if (function == null || !Function.OPERATION_WRITE.equals(function.getOperation()))
      return "Expected a write function";
    var names = new HashSet<String>();
    if (function.getParameters() == null) return "Parameter definitions unavailable";
    if (function.getParameters().size() >= 100) return "Too many parameters for the scheduled form";
    for (var parameter : function.getParameters()) {
      if (parameter.getName() == null
          || parameter.getName().isBlank()
          || parameter.getName().length() > 246
          || !names.add(parameter.getName())) return "Invalid parameter names";
      if (parameter.getType() == null) return "Parameter type is missing";
      if (!ParameterForms.supports(parameter.getType(), ParameterForms.Context.INTERACTIVE))
        return "Unsupported parameter type";
      if (!ParameterForms.supports(parameter.getType(), ParameterForms.Context.SCHEDULED))
        return "Object, dataset and vector parameters do not support scheduling";
    }
    return null;
  }

  /** The values a saved task's parameters take when it starts at {@code start}; invalid text refuses the task. */
  private static JSONObject values(Function function, JsonNode content, String zone, Instant start, String locale) {
    var parameters =
        ParameterForms.scheduled(
            function.getParameters(), PARAMETER_KEY, content, ZoneId.of(zone), start, "/content/", locale);
    if (!parameters.errors().isEmpty())
      throw new ScheduleException(
          422,
          "FIELD_VALIDATION_FAILED",
          "Check the parameter values",
          Map.of("fields", parameters.errors()));
    return parameters.values();
  }

  private static ScheduleException unavailable() {
    return new ScheduleException(
        422, "TARGET_UNAVAILABLE", "The action or write function is unavailable");
  }

  private static String label(String value, String id) {
    return value == null || value.isBlank() ? id : value;
  }

  public static String formRevision(Function function, String actionId) {
    var fields = array();
    for (var parameter : function.getParameters())
      fields.add(object("name", parameter.getName(), "type", parameter.getType()));
    var input =
        object(
            "actionId",
            actionId,
            "functionId",
            function.getId(),
            "code",
            function.getCode(),
            "parameters",
            fields,
            "writeClasses",
            function.getReturnDef() == null ? null : function.getReturnDef().getClassNames(),
            "format",
            "lines-local-time-v1");
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(input.toString().getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }

  public JsonNode form(FormInput input, Actor actor) {
    String selected = input.values().path("execution").asText("");
    var options = array();
    Target selectedTarget = null;
    for (var action : actions.queryList(Action.STATUS_PUBLISHED, null, null, actor.domain())) {
      if (!permitted(action.getId(), actor)) continue;
      var function = action.getFunction();
      String reason = function == null || !actor.domain().equals(function.getDomainId())
          ? "Target unavailable" : unsupportedReason(function, actor.locale());
      var candidate = new Target(action, function, label(action.getName(), action.getId()));
      String value = "action:" + action.getId();
      options.add(option(value, candidate, reason, action.getDescription(), actor));
      if (selected.equals(value) && reason == null) selectedTarget = candidate;
    }
    if (permitted(null, actor)) {
      for (var function : functions.queryList(Function.OPERATION_WRITE, null, actor.domain())) {
        String reason = unsupportedReason(function, actor.locale());
        var candidate = new Target(null, function, label(function.getName(), function.getId()));
        String value = "function:" + function.getId();
        options.add(option(value, candidate, reason, function.getDescription(), actor));
        if (selected.equals(value) && reason == null) selectedTarget = candidate;
      }
    }
    if (!selected.isBlank() && !hasChoice(options, selected))
      options.add(FormFields.option(selected, selected, zh(actor) ? "目标已不可用" : "Target unavailable", null));
    return targetForm(input, actor, options, selectedTarget);
  }

  private boolean hasChoice(JsonNode options, String selected) {
    for (var option : options) if (selected.equals(option.path("value").asText())) return true;
    return false;
  }

  private JsonNode option(String value, Target target, String reason, String description, Actor actor) {
    String kind = target.action() == null ? (zh(actor) ? " · 函数" : " · Function") : (zh(actor) ? " · 动作" : " · Action");
    return FormFields.option(value, target.label() + kind, reason, description);
  }

  private JsonNode targetForm(FormInput input, Actor actor, com.fasterxml.jackson.databind.node.ArrayNode options, Target target) {
    boolean zh = zh(actor);
    String selected = input.values().path("execution").asText("");
    var fields = array();
    fields.add(FormFields.select("execution", zh ? "执行" : "Execute", options, true));
    String revision = "ontology-unselected-v1";
    if (target != null) {
      revision = formRevision(target.function(), target.actionId());
      fields.addAll(ParameterForms.fields(target.function().getParameters(), ParameterForms.Context.SCHEDULED,
          PARAMETER_KEY, actor.locale()));
    }
    JsonNode values =
        "execution".equals(input.changedField()) ? object("execution", selected) : input.values();
    var form = (ObjectNode) ScheduleForms.form(id(), revision, fields, values);
    if (form.path("submittable").asBoolean() && !selected.isBlank()) {
      var errors =
          ParameterForms.scheduled(
                  target.function().getParameters(),
                  PARAMETER_KEY,
                  form.path("values"),
                  ZoneId.of(input.timeZone()),
                  Instant.now(),
                  "/values/",
                  actor.locale())
              .errors();
      if (!errors.isEmpty()) {
        form.set("errors", errors);
        form.put("submittable", false);
      }
    }
    return form;
  }

  public Validation validate(TaskDefinition definition, Actor actor) {
    String selected = definition.content().path("execution").asText("");
    var input = new FormInput(definition.content(), null, null, definition.timeZone());
    if (selected.isBlank()) return ScheduleForms.validate(definition, targetForm(input, actor, array(), null));
    var target = target(selected, actor.domain(), actor.locale());
    var options = array().add(option(selected, target, null, null, actor));
    var validation = ScheduleForms.validate(definition, targetForm(input, actor, options, target));
    return new Validation(
        validation.content(),
        validation.formRevision(),
        definition.timeZone(),
        validation.summary(),
        object("actionId", target.actionId(), "functionId", target.function().getId()));
  }

  public void attach(UUID taskId, Validation validation) {
    references.attach(
        taskId,
        validation.references().path("actionId").asText(null),
        validation.references().path("functionId").asText());
  }

  public void detach(UUID taskId) {
    references.detach(taskId);
  }

  public JsonNode start(Execution execution, Actor actor) {
    var target =
        target(
            execution.definition().content().path("execution").asText(),
            actor.domain(),
            actor.locale());
    if (target.action() == null && !permitted(null, actor)) throw denied(actor);
    if (!execution
        .definition()
        .formRevision()
        .equals(formRevision(target.function(), target.actionId())))
      throw new ScheduleException(
          409, "FORM_CHANGED", "The execution definition changed before admission");
    Instant started = Instant.now();
    var values =
        values(
            target.function(),
            execution.definition().content(),
            execution.definition().timeZone(),
            started,
            actor.locale());
    var state = ScheduleForms.execution("completed");
    state.set(
        "resultLink",
        object(
            "appId",
            id(),
            "path",
            "/schedules?taskId=" + execution.taskId() + "&runId=" + execution.runId()));
    state.set(
        "executionDetails",
        object(
            "parameters",
            values,
            "executionAt",
            started.toString(),
            "executionId",
            execution.runId()));
    try {
      int timeout = Math.max(1, configs.get(actor.domain()).getReportCardPythonTimeout());
      io.ontomato.dataengine.bean.PythonExecuteResult result;
      if (target.action() != null) {
        result = actions.executeScheduled(target.action(), values, actor.locale(), actor.user(), actor.permission(), timeout, execution.runId());
      } else {
        var function = MetricViewBindings.executionWriteFunction(target.function(), values);
        var output = programs.execute(execution.runId().toString(), function, actor.creator(), actor.permission(),
            ServiceConst.NOT_SANDBOX, actor.locale(), timeout, actor.domain(),
            new ABCProgramService.ExecutionContext(execution.runId(), null, ExecutionTarget.LIVE));
        result = (io.ontomato.dataengine.bean.PythonExecuteResult) output[1];
      }
      state.put("result", result.getResult());
      state.set("spendTime", JSON.valueToTree(result.getSpendTime()));
      if (result.getError() != null && !result.getError().isBlank()) {
        state.put("status", "failed");
        state.set("error", object("code", "run_failed", "message", result.getError()));
      } else state.put("resultSummary", zh(actor) ? "执行完成" : "Execution completed");
    } catch (Exception error) {
      state.put("status", "failed");
      state.set(
          "error",
          object(
              "code", "run_failed", "message", ErrorText.programError(error, execution.locale())));
    }
    return state;
  }

  private boolean zh(Actor actor) {
    return actor.locale().startsWith("zh");
  }

  public JsonNode status(Execution execution, JsonNode handle) {
    throw new UnsupportedOperationException("Synchronous writes are never replayed");
  }
}
