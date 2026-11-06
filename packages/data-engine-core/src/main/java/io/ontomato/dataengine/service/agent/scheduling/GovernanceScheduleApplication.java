package io.ontomato.dataengine.service.agent.scheduling;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.schedules.*;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.agent.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class GovernanceScheduleApplication implements ScheduleApplication {
  private final KnowledgeGovernanceService governance;
  private final OntologyAgentAccess access;
  private final AgentRuntimeClient runtime;
  private final OntologyAgentStore store;
  private final IdentityService identity;

  public String id() {
    return "governance";
  }

  public String description(String locale) {
    return locale.startsWith("zh")
        ? "按指令巡检业务知识"
        : "Inspect business knowledge with your instructions";
  }

  public void authorize(Actor actor) {
    if (!identity.hasKnowledgeGovernanceAccess(actor.creator(), actor.domain()))
      throw new ScheduleException(
          403, "PERMISSION_DENIED", "Business knowledge permission is required");
  }

  public JsonNode form(FormInput input, Actor actor) {
    var fields = array();
    fields.add(
        ScheduleForms.text(
            "instruction",
            actor.locale().startsWith("zh") ? "指令" : "Instruction",
            true,
            true,
            null));
    return ScheduleForms.form(id(), "governance-v1", fields, input.values());
  }

  public Validation validate(TaskDefinition definition, Actor actor) {
    authorize(actor);
    return ScheduleForms.validate(
        definition,
        form(new FormInput(definition.content(), null, null, definition.timeZone()), actor));
  }

  public JsonNode start(Execution execution, Actor actor) {
    validate(execution.definition(), actor);
    String session = TaskStore.session(execution.runId()).toString();
    var context = access.scheduledGovernance(actor.user(), actor.locale());
    try {
      governance.create(session, context.owner(), false);
      governance.start(
          session,
          execution.runId().toString(),
          execution.definition().content().path("instruction").asText(),
          context);
      var state = ScheduleForms.execution("running");
      state.set("handle", object("sessionId", session));
      state.set("resultLink", link(session));
      return state;
    } catch (AgentHttpException failure) {
      throw failure;
    } catch (Exception failure) {
      throw new ScheduleException(
          503, "DEPENDENCY_UNAVAILABLE", "Governance admission response unavailable");
    }
  }

  private JsonNode link(String session) {
    return object("appId", id(), "path", "/governance/chat/" + session);
  }

  public JsonNode status(Execution execution, JsonNode handle) {
    String session =
        handle != null && handle.path("sessionId").isTextual()
            ? handle.path("sessionId").asText()
            : TaskStore.session(execution.runId()).toString();
    var owner = new OntologyAgentStore.Owner(execution.creatorId(), execution.domainId());
    store.run(session, execution.runId().toString(), owner);
    try {
      var status = runtime.status(owner.domainId(), execution.runId().toString());
      boolean running = "running".equals(status.getString("status"));
      boolean completed =
          !running && java.util.List.of("stop", "length").contains(status.getString("stopReason"));
      var state = ScheduleForms.execution(running ? "running" : completed ? "completed" : "failed");
      state.set("handle", object("sessionId", session));
      state.set("resultLink", link(session));
      if (completed) {
        var reply =
            runtime.json(
                owner.domainId(),
                execution.runId().toString(),
                "/v1/runs/" + execution.runId() + "/final-reply",
                "GET",
                null,
                null);
        var text = new StringBuilder();
        if (reply != null && reply.getJSONArray("content") != null)
          for (var item : reply.getJSONArray("content")) {
            var block = com.alibaba.fastjson2.JSONObject.from(item);
            if ("text".equals(block.getString("type"))) text.append(block.getString("text"));
          }
        state.put("result", text.toString());
        var work = governance.work(session, owner).getJSONObject("work");
        state.put("resultSummary", work.getString("summary"));
      } else if (!running)
        state.set(
            "error",
            object(
                "code",
                "aborted".equals(status.getString("stopReason")) ? "cancelled" : "run_failed",
                "message",
                status.getString("errorMessage")));
      return state;
    } catch (AgentHttpException failure) {
      throw failure;
    } catch (Exception failure) {
      throw new ScheduleException(503, "DEPENDENCY_UNAVAILABLE", "Governance status unavailable");
    }
  }
}
