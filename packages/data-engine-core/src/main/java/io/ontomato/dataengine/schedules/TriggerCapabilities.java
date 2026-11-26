package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;
import static io.ontomato.dataengine.service.authorization.CapabilityDefinitions.access;

import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.WorkflowService;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Starts native capability targets through their owning execution services. */
@Component
class TriggerCapabilities {
  private final ActionService actions;
  private final ActionAuthorization actionAccess;
  private final WorkflowService workflows;
  private final CapabilityDefinitions definitions;
  private final URI praxisRuns;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

  TriggerCapabilities(ActionService actions, ActionAuthorization actionAccess, WorkflowService workflows,
      CapabilityDefinitions definitions, @Value("${ONTOPRAXIS_BASE_URL:http://127.0.0.1:18600}") String praxis) {
    this.actions = actions;
    this.actionAccess = actionAccess;
    this.workflows = workflows;
    this.definitions = definitions;
    this.praxisRuns = URI.create(praxis.replaceAll("/+$", "") + "/runs");
  }

  private static ScheduleException missing() {
    return new ScheduleException(422, "TARGET_UNAVAILABLE", "The trigger target is missing or not published");
  }

  private static ScheduleException denied() {
    return new ScheduleException(403, "PERMISSION_DENIED", "The member cannot use the trigger target");
  }

  Action action(TaskDefinition definition, String domain) {
    var action = actions.queryById(definition.targetId());
    if (action == null || !domain.equals(action.getDomainId()) || !Action.STATUS_PUBLISHED.equals(action.getStatus()))
      throw missing();
    for (var name : definition.content().path("runStartParameters")) {
      if (action.getFunction().getParameters().stream().noneMatch(parameter ->
          name.asText().equals(parameter.getName()) && Parameter.TYPE_TIME.equals(parameter.getType())))
        throw new ScheduleException(422, "TARGET_UNAVAILABLE", "Not a scalar date parameter: " + name.asText());
    }
    return action;
  }

  private Workflow workflow(TaskDefinition definition, String domain) {
    var workflow = workflows.queryActiveById(definition.targetId(), domain);
    if (workflow == null) throw missing();
    return workflow;
  }

  void verifyTarget(TaskDefinition definition, String domain) {
    switch (definition.targetKind()) {
      case "action" -> action(definition, domain);
      case "workflow" -> workflow(definition, domain);
      default -> throw new IllegalArgumentException("Not a native trigger target");
    }
  }

  void authorize(TaskDefinition definition, User user) {
    var subject = definitions.subject(user);
    if ("action".equals(definition.targetKind())) {
      if (!actionAccess.standalone(subject, action(definition, user.getDomainId()), ExecutionTarget.LIVE).admitted())
        throw denied();
    } else if (!definitions.allows(subject, access(workflow(definition, user.getDomainId()), Verb.USE))) {
      throw denied();
    }
  }

  JsonNode targets(User user) {
    var subject = definitions.subject(user);
    String domain = user.getDomainId();
    return object("actions", actions.queryList(Action.STATUS_PUBLISHED, null, null, domain).stream()
        .filter(action -> actionAccess.standalone(subject, action, ExecutionTarget.LIVE).admitted())
        .map(action -> object("id", action.getId(), "name", action.getName(), "description", action.getDescription())).toList(),
        "workflows", workflows.queryList(Workflow.STATUS_ACTIVE, domain).stream()
        .filter(workflow -> definitions.allows(subject, access(workflow, Verb.USE)))
        .map(workflow -> object("id", workflow.getId(), "name", workflow.getName(), "description", workflow.getDescription())).toList());
  }

  record Names(Map<String, String> actions, Map<String, String> workflows) {
    String forTarget(TaskDefinition definition) {
      return switch (definition.targetKind()) {
        case "action" -> actions.get(definition.targetId());
        case "workflow" -> workflows.get(definition.targetId());
        default -> null;
      };
    }
  }

  Names names(String domain, List<Trigger> list) {
    var actionNames = new HashMap<String, String>();
    var workflowNames = new HashMap<String, String>();
    if (list.stream().anyMatch(row -> "action".equals(row.definition().targetKind())))
      actions.queryList(null, null, null, domain).forEach(action -> actionNames.put(action.getId(), action.getName()));
    if (list.stream().anyMatch(row -> "workflow".equals(row.definition().targetKind())))
      workflows.queryList(null, domain).forEach(workflow -> workflowNames.put(workflow.getId(), workflow.getName()));
    return new Names(actionNames, workflowNames);
  }

  JsonNode start(ScheduleApplication.Execution execution, ScheduleApplication.Actor actor) throws Exception {
    var definition = execution.definition();
    if ("action".equals(definition.targetKind())) {
      var action = action(definition, execution.domainId());
      var started = java.time.Instant.now().toString();
      var parameters = com.alibaba.fastjson2.JSON.parseObject(definition.content().get("parameters").toString());
      definition.content().path("runStartParameters").forEach(name -> parameters.put(name.asText(), started));
      var output = actions.executeScheduled(action, parameters, execution.locale(), actor.user(), actor.permission(), 60, execution.runId());
      boolean failed = output.getError() != null && !output.getError().isBlank();
      var state = failed ? failed("run_failed", output.getError()) : ScheduleForms.execution("completed");
      state.put("result", output.getResult());
      state.set("spendTime", ScheduleJson.JSON.valueToTree(output.getSpendTime()));
      state.set("executionDetails", object("parameters", parameters, "executionAt", started, "executionId", execution.runId()));
      return state;
    }
    authorize(definition, actor.user());
    var response = http.send(praxisRunRequest(execution, actor), HttpResponse.BodyHandlers.ofString());
    var body = parse(response.body());
    if (response.statusCode() == 401)
      throw new ScheduleException(401, "UNAUTHENTICATED", text(body, "error"));
    if (response.statusCode() >= 300) return failed("start_failed", text(body, "error"));
    String runId = text(body, "id");
    var completed = ScheduleForms.execution("completed");
    completed.set("executionDetails", object("workflowRunId", runId));
    return completed;
  }

  HttpRequest praxisRunRequest(ScheduleApplication.Execution execution, ScheduleApplication.Actor actor) {
    var definition = execution.definition();
    var content = definition.content();
    String requester = "manual".equals(execution.trigger()) ? actor.user().getLoginCode()
        : content.path("requester").asText(actor.user().getLoginCode());
    if (requester.isBlank()) requester = actor.user().getLoginCode();
    var body = object("workflowId", definition.targetId(), "requester", requester,
        "triggerRef", "trigger:" + execution.taskId(), "triggerKey", execution.taskId() + ":" +
            (execution.scheduledAt() == null ? execution.runId().toString() : execution.scheduledAt().getEpochSecond()),
        "inputs", content.get("inputs"));
    if (content.path("goalText").isTextual()) body.set("goalText", content.get("goalText"));
    return HttpRequest.newBuilder(praxisRuns).header("content-type", "application/json")
        .header("x-ontomato-domain-id", execution.domainId()).header("authorization", "Bearer " + actor.apiKey())
        .timeout(Duration.ofSeconds(60)).POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
  }

  private static com.fasterxml.jackson.databind.node.ObjectNode failed(String code, String message) {
    var state = ScheduleForms.execution("failed");
    state.set("error", object("code", code, "message", message));
    return state;
  }
}
