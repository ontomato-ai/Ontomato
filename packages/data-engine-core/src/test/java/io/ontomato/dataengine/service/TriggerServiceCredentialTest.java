package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.schedules.ScheduleIdentity;
import io.ontomato.dataengine.schedules.TaskCredentials;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * An internal API key is one slot per domain member, and the platform's scheduled tasks keep the
 * value they run with. A trigger that issued its own key would revoke theirs, so a workflow trigger
 * presents the same stored background credential instead.
 */
class TriggerServiceCredentialTest {

  private final ScheduleIdentity identity = mock(ScheduleIdentity.class);
  private final TaskCredentials credentials = mock(TaskCredentials.class);
  private final TriggerService service = new TriggerService();

  TriggerServiceCredentialTest() {
    ReflectionTestUtils.setField(service, "identity", identity);
    ReflectionTestUtils.setField(service, "credentials", credentials);
  }

  private static Trigger workflowTrigger() {
    var trigger = new Trigger();
    trigger.setId("t1");
    trigger.setDomainId("d1");
    trigger.setCreatedBy("u1");
    trigger.setEffectKind(Trigger.EFFECT_WORKFLOW);
    trigger.setEffect(JSONObject.of("workflowId", "w1", "requester", "u1"));
    return trigger;
  }

  @Test
  void workflowTriggerUsesTheStoredCredentialAndNeverIssuesAKey() {
    when(credentials.forOwner("d1", "u1")).thenReturn("stored-key");

    service.fire(workflowTrigger(), Instant.parse("2026-11-17T00:00:00Z"), "zh-CN");

    verify(credentials).forOwner("d1", "u1");
    verify(identity, never()).issueKey(any());
  }

  @Test
  void missingCredentialFailsTheFiringWithoutIssuingAKey() {
    when(credentials.forOwner("d1", "u1")).thenThrow(new TaskCredentials.Invalid());

    var result = service.fire(workflowTrigger(), Instant.parse("2026-11-17T00:00:00Z"), "zh-CN");

    assertEquals("failed", result.getString("status"));
    verify(identity, never()).issueKey(any());
  }
}
