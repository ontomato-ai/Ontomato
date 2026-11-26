package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.WorkflowService;
import io.ontomato.dataengine.service.authorization.ActionAuthorization;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.sys.bean.UserDetail;
import java.net.http.HttpRequest;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Flow;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class TriggerExecutionTest {
  private final ActionService actions = mock(ActionService.class);
  private final TriggerCapabilities capabilities = new TriggerCapabilities(actions, mock(ActionAuthorization.class),
      mock(WorkflowService.class), mock(CapabilityDefinitions.class), "http://praxis:18600/");

  @Test void workflowUsesExecutorCredentialAndPreservesPraxisRequesterRules() {
    var def = new TaskDefinition("Review", null, object("requester", "requesting-member", "inputs", object("step", object("key", 1))),
        null, object(), "UTC", null, null, "workflow", "review-case");
    var actor = actor("actual-executor", "executor-login");
    var scheduledAt = Instant.parse("2026-11-26T10:00:00Z");
    var request = capabilities.praxisRunRequest(execution(def, actor, "schedule", scheduledAt), actor);
    assertEquals("http://praxis:18600/runs", request.uri().toString());
    assertEquals("domain", request.headers().firstValue("x-ontomato-domain-id").orElseThrow());
    assertEquals("Bearer owner-key", request.headers().firstValue("authorization").orElseThrow());
    var scheduled = parse(requestBody(request));
    assertEquals("requesting-member", scheduled.path("requester").asText());
    assertEquals("review-case", scheduled.path("workflowId").asText());
    assertEquals("trigger:trigger-text-id", scheduled.path("triggerRef").asText());
    assertEquals(1, scheduled.at("/inputs/step/key").asInt());
    var clicker = actor("a-clicker", "clicker-login");
    var manual = capabilities.praxisRunRequest(execution(def, clicker, "manual", null), clicker);
    assertEquals("clicker-login", parse(requestBody(manual)).path("requester").asText());
  }

  @Test void bindsOneActualStartTimeToEveryDynamicDateWithoutChangingStaticParameters() throws Exception {
    var action = new Action();
    action.setDomainId("domain");
    action.setStatus(Action.STATUS_PUBLISHED);
    var function = new Function();
    function.setParameters(List.of(date("first"), date("second")));
    action.setFunction(function);
    when(actions.queryById("post")).thenReturn(action);
    var output = new PythonExecuteResult();
    output.setResult("published");
    when(actions.executeScheduled(eq(action), any(), eq("en"), any(), isNull(), eq(60), any())).thenReturn(output);
    var def = new TaskDefinition("Posting", null, object("parameters", object("category", "debit"), "runStartParameters", List.of("first", "second")),
        null, object(), "UTC", null, null, "action", "post");
    var actor = actor("actual-executor", "executor-login");
    var execution = execution(def, actor, "schedule", Instant.parse("2026-11-26T10:00:00Z"));
    var result = capabilities.start(execution, actor);
    var sent = ArgumentCaptor.forClass(JSONObject.class);
    verify(actions).executeScheduled(eq(action), sent.capture(), eq("en"), same(actor.user()), isNull(), eq(60), eq(execution.runId()));
    assertEquals("debit", sent.getValue().getString("category"));
    String started = result.at("/executionDetails/executionAt").asText();
    assertEquals(started, sent.getValue().getString("first"));
    assertEquals(started, sent.getValue().getString("second"));
    assertNotEquals(execution.scheduledAt(), Instant.parse(started));
    assertEquals("completed", result.path("status").asText());
    assertEquals("published", result.path("result").asText());
  }

  @Test void malformedDynamicFieldsAreRefusedBeforeSaving() {
    var input = object("title", "Test", "targetKind", "action", "targetId", "action", "notifyEmail", null,
        "frequency", object("kind", "daily", "time", "09:00"),
        "content", object("parameters", object("at", "already-bound"), "runStartParameters", List.of("at")));
    assertThrows(ScheduleException.class, () -> TaskDefinition.input(input, "UTC", false));
  }

  @Test void monthlySlotsPastTheMonthEndRunOnItsLastDay() {
    var def = new TaskDefinition("Monthly", null, object("parameters", object()), null,
        object("kind", "monthly", "day", 31, "time", "09:00"), "Asia/Shanghai", null, null, "action", "post");
    var now = Instant.parse("2026-02-01T00:00:00Z");
    assertEquals(Instant.parse("2026-02-28T01:00:00Z"), def.next(now, now));
  }

  private static Parameter date(String name) {
    var parameter = new Parameter();
    parameter.setName(name);
    parameter.setType(Parameter.TYPE_TIME);
    return parameter;
  }

  private static ScheduleApplication.Actor actor(String id, String login) {
    var user = new UserDetail();
    user.setId(id);
    user.setLoginCode(login);
    user.setDomainId("domain");
    return new ScheduleApplication.Actor(user, null, null, "owner-key", "en");
  }

  private static ScheduleApplication.Execution execution(TaskDefinition def, ScheduleApplication.Actor actor, String trigger, Instant slot) {
    return new ScheduleApplication.Execution("trigger-text-id", UUID.randomUUID(), actor.domain(), actor.user().getId(),
        def, "en", trigger, slot, Instant.now());
  }

  private static String requestBody(HttpRequest request) {
    var body = new CompletableFuture<String>();
    var bytes = new java.io.ByteArrayOutputStream();
    request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<>() {
      @Override public void onSubscribe(Flow.Subscription sub) { sub.request(Long.MAX_VALUE); }
      @Override public void onNext(ByteBuffer buffer) { byte[] data = new byte[buffer.remaining()]; buffer.get(data); bytes.writeBytes(data); }
      @Override public void onError(Throwable error) { body.completeExceptionally(error); }
      @Override public void onComplete() { body.complete(bytes.toString(StandardCharsets.UTF_8)); }
    });
    return body.join();
  }
}
