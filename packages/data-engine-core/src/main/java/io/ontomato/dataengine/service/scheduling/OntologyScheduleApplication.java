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

  public String id() {
    return "ontology";
  }

  public String description(String locale) {
    return locale.startsWith("zh") ? "执行一个动作或函数" : "Execute an action or function";
  }

  public void authorize(Actor actor) {
    try {
      identity.requireActionExecutionAccess(actor.creator(), actor.domain());
    } catch (org.springframework.web.server.ResponseStatusException denied) {
      if (denied.getStatusCode().value() != 403) throw denied;
      throw new ScheduleException(
          403,
          "PERMISSION_DENIED",
          actor.locale().startsWith("zh")
              ? "你没有执行动作或函数的权限"
              : "You do not have permission to execute actions or functions");
    }
  }

  public boolean asynchronous() {
    return false;
  }

  public int deadlineMinutes(Execution execution) {
    return Math.max(1, configs.get(execution.domainId()).getReportCardPythonTimeout()) + 1;
  }

  private record Target(String actionId, Function function, String label) {}

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
      return new Target(id, action.getFunction(), label(action.getName(), id));
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
    boolean zh = actor.locale().startsWith("zh");
    var options = array();
    for (var action : actions.queryList(Action.STATUS_PUBLISHED, null, null, actor.domain())) {
      String reason =
          action.getFunction() == null || !actor.domain().equals(action.getFunction().getDomainId())
              ? "Target unavailable"
              : unsupportedReason(action.getFunction(), actor.locale());
      options.add(
          FormFields.option(
              "action:" + action.getId(),
              label(action.getName(), action.getId()) + (zh ? " · 动作" : " · Action"),
              reason,
              action.getDescription()));
    }
    for (var function : functions.queryList(Function.OPERATION_WRITE, null, actor.domain()))
      options.add(
          FormFields.option(
              "function:" + function.getId(),
              label(function.getName(), function.getId()) + (zh ? " · 函数" : " · Function"),
              unsupportedReason(function, actor.locale()),
              function.getDescription()));
    String selected = input.values().path("execution").asText("");
    boolean found = false;
    for (var option : options) if (selected.equals(option.path("value").asText())) found = true;
    if (!selected.isBlank() && !found)
      options.add(
          FormFields.option(selected, selected, zh ? "目标已不可用" : "Target unavailable", null));
    var fields = array();
    fields.add(FormFields.select("execution", zh ? "执行" : "Execute", options, true));
    String revision = "ontology-unselected-v1";
    if (!selected.isBlank()) {
      try {
        var target = target(selected, actor.domain(), actor.locale());
        revision = formRevision(target.function(), target.actionId());
        fields.addAll(
            ParameterForms.fields(
                target.function().getParameters(),
                ParameterForms.Context.SCHEDULED,
                PARAMETER_KEY,
                actor.locale()));
      } catch (ScheduleException unavailable) {
        /* The unavailable selection remains visible and disabled. */
      }
    }
    JsonNode values =
        "execution".equals(input.changedField()) ? object("execution", selected) : input.values();
    var form = (ObjectNode) ScheduleForms.form(id(), revision, fields, values);
    if (form.path("submittable").asBoolean() && !selected.isBlank()) {
      var errors =
          ParameterForms.scheduled(
                  target(selected, actor.domain(), actor.locale()).function().getParameters(),
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
    authorize(actor);
    String selected = definition.content().path("execution").asText();
    if (!selected.isBlank()) target(selected, actor.domain(), actor.locale());
    var form = form(new FormInput(definition.content(), null, null, definition.timeZone()), actor);
    var validation = ScheduleForms.validate(definition, form);
    var target =
        target(definition.content().path("execution").asText(), actor.domain(), actor.locale());
    values(
        target.function(), definition.content(), definition.timeZone(), Instant.now(), actor.locale());
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
    validate(execution.definition(), actor);
    var target =
        target(
            execution.definition().content().path("execution").asText(),
            actor.domain(),
            actor.locale());
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
    var function = MetricViewBindings.executionWriteFunction(target.function(), values);
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
      var output =
          programs.execute(
              execution.runId().toString(),
              function,
              actor.creator(),
              actor.permission(),
              ServiceConst.NOT_SANDBOX,
              actor.locale(),
              Math.max(1, configs.get(actor.domain()).getReportCardPythonTimeout()),
              actor.domain(),
              execution.runId());
      var result = (io.ontomato.dataengine.bean.PythonExecuteResult) output[1];
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
