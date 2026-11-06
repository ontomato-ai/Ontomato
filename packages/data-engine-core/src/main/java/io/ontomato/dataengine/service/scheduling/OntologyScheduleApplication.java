package io.ontomato.dataengine.service.scheduling;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.config.ServiceConst;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.schedules.*;
import io.ontomato.dataengine.service.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class OntologyScheduleApplication implements ScheduleApplication {
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
    identity.requireActionExecutionAccess(actor.creator(), actor.domain());
  }

  public boolean asynchronous() {
    return false;
  }

  public int deadlineMinutes(Execution execution) {
    return Math.max(1, configs.get(execution.domainId()).getReportCardPythonTimeout()) + 1;
  }

  private record Target(String actionId, Function function, String label) {}

  private Target target(String value, String domain) {
    int split = value.indexOf(':');
    if (split < 1) throw unavailable();
    String kind = value.substring(0, split), id = value.substring(split + 1);
    if (kind.equals("action")) {
      var action = actions.queryById(id);
      if (action == null
          || !domain.equals(action.getDomainId())
          || !Action.STATUS_PUBLISHED.equals(action.getStatus())
          || action.getFunction() == null
          || !domain.equals(action.getFunction().getDomainId())
          || ScheduleParameters.unsupported(action.getFunction()) != null) throw unavailable();
      return new Target(id, action.getFunction(), label(action.getName(), id));
    }
    if (!kind.equals("function")) throw unavailable();
    var function = functions.queryById(id);
    if (function == null
        || !domain.equals(function.getDomainId())
        || ScheduleParameters.unsupported(function) != null) throw unavailable();
    return new Target(null, function, label(function.getName(), id));
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
              : ScheduleParameters.unsupported(action.getFunction());
      options.add(
          ScheduleForms.option(
              "action:" + action.getId(),
              label(action.getName(), action.getId()) + (zh ? " · 动作" : " · Action"),
              reason,
              action.getDescription()));
    }
    for (var function : functions.queryList(Function.OPERATION_WRITE, null, actor.domain()))
      options.add(
          ScheduleForms.option(
              "function:" + function.getId(),
              label(function.getName(), function.getId()) + (zh ? " · 函数" : " · Function"),
              ScheduleParameters.unsupported(function),
              function.getDescription()));
    String selected = input.values().path("execution").asText("");
    boolean found = false;
    for (var option : options) if (selected.equals(option.path("value").asText())) found = true;
    if (!selected.isBlank() && !found)
      options.add(
          ScheduleForms.option(selected, selected, zh ? "目标已不可用" : "Target unavailable", null));
    var fields = array();
    fields.add(ScheduleForms.select("execution", zh ? "执行" : "Execute", options, true));
    String revision = "ontology-unselected-v1";
    if (!selected.isBlank()) {
      try {
        var target = target(selected, actor.domain());
        revision = formRevision(target.function(), target.actionId());
        for (var parameter : target.function().getParameters()) {
          boolean time = Parameter.TYPE_TIME.equals(parameter.getType());
          boolean lines = parameter.getType().endsWith("_ARRAY");
          String help =
              time
                  ? (zh
                      ? "留空使用实际开始时刻；日期与日期时间按任务时区解释，也可填写 RFC3339"
                      : "Leave blank for the actual start time; local dates use the task time zone;"
                          + " RFC3339 is also accepted")
                  : lines
                      ? (zh ? "每行一项，空行忽略" : "One item per line; blank lines are ignored")
                      : parameter.getDescription();
          fields.add(
              ScheduleForms.text(
                  "parameter:" + parameter.getName(), parameter.getName(), !time, lines, help));
        }
      } catch (ScheduleException unavailable) {
        /* The unavailable selection remains visible and disabled. */
      }
    }
    JsonNode values =
        "execution".equals(input.changedField()) ? object("execution", selected) : input.values();
    var form = (ObjectNode) ScheduleForms.form(id(), revision, fields, values);
    if (form.path("submittable").asBoolean() && !selected.isBlank()) {
      try {
        ScheduleParameters.values(
            target(selected, actor.domain()).function(),
            form.path("values"),
            input.timeZone(),
            Instant.now());
      } catch (ScheduleException invalid) {
        var errors = array();
        var source = JSON.valueToTree(invalid.details.get("fields"));
        for (var item : source) {
          var error = (ObjectNode) item.deepCopy();
          error.put("field", error.path("field").asText().replaceFirst("^/content/", "/values/"));
          errors.add(error);
        }
        form.set("errors", errors);
        form.put("submittable", false);
      }
    }
    return form;
  }

  public Validation validate(TaskDefinition definition, Actor actor) {
    authorize(actor);
    var form = form(new FormInput(definition.content(), null, null, definition.timeZone()), actor);
    var validation = ScheduleForms.validate(definition, form);
    var target = target(definition.content().path("execution").asText(), actor.domain());
    ScheduleParameters.values(
        target.function(), definition.content(), definition.timeZone(), Instant.now());
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
        target(execution.definition().content().path("execution").asText(), actor.domain());
    if (!execution
        .definition()
        .formRevision()
        .equals(formRevision(target.function(), target.actionId())))
      throw new ScheduleException(
          409, "FORM_CHANGED", "The execution definition changed before admission");
    Instant started = Instant.now();
    var values =
        ScheduleParameters.values(
            target.function(),
            execution.definition().content(),
            execution.definition().timeZone(),
            started);
    var function = MetricViewBindings.executionFunction(target.function(), values);
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
      state.set("error", object("code", "run_failed", "message", "Program execution failed"));
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
