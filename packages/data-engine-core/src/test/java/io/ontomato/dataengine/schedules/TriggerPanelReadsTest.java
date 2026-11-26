package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.RoleResolution;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class TriggerPanelReadsTest {
  private final TaskStore store = mock(TaskStore.class);
  private final IdentityService identity = mock(IdentityService.class);
  private final CapabilityDefinitions definitions = mock(CapabilityDefinitions.class);
  private final TriggerCapabilities capabilities = mock(TriggerCapabilities.class);
  private final TriggerPanelReads reads = new TriggerPanelReads(
      new PlatformTasks(store, identity, null, null, null, capabilities, definitions, null));
  private final SubjectContext subject = new SubjectContext(
      new VerifiedIdentity("tenant", "system", CredentialLimit.UNRESTRICTED),
      new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false, false),
      Map.of(), Set.of(), Set.of()).withJavaUserId("admin");

  @Test
  void countsOnlyDefinitionsThatTheVerifiedJavaActorMayRead() {
    var visible = trigger("readable");
    var hidden = trigger("hidden");
    when(store.candidates("tenant", null, null, null)).thenReturn(List.of(visible, hidden));
    when(definitions.canRead(any(), argThat(access -> access != null && access.target().id().equals("readable"))))
        .thenAnswer(call -> {
          SubjectContext actor = call.getArgument(0);
          assertEquals("admin", actor.identity().userId());
          assertSame(subject.roles(), actor.roles());
          return true;
        });

    var result = (JsonNode) reads.triggerPanelCount().handler().read(subject, Map.of());
    assertEquals(1, result.get("total").asInt());
    verifyNoInteractions(identity);
    verify(definitions, never()).subject(any());
  }

  @Test
  void masksAnotherExecutorsRunEvenForAReadableDefinition() {
    var id = UUID.randomUUID();
    var readable = trigger("readable");
    when(store.get("readable", false)).thenReturn(readable);
    when(definitions.canRead(any(), any())).thenReturn(true);
    var run = mock(TaskStore.Run.class);
    var snapshot = mock(TaskStore.Snapshot.class);
    when(store.run(id)).thenReturn(run);
    when(run.taskId()).thenReturn("readable");
    when(run.snapshot()).thenReturn(snapshot);
    when(snapshot.domainId()).thenReturn("tenant");
    when(snapshot.executorId()).thenReturn("someone-else");

    var failure = assertThrows(ScheduleException.class, () -> reads.triggerPanelRunRecord()
        .handler().read(subject, Map.of("primaryKey", "readable", "runId", id.toString())));
    assertEquals("TASK_NOT_FOUND", failure.code);
    verifyNoInteractions(identity);
  }

  @Test
  void formsReadStoredTriggersAndResolveEditAndTargetsForTheSameActor() {
    var task = trigger("editable");
    when(task.definition()).thenReturn(new TaskDefinition("Saved", "agents", object(), null,
        object("kind", "daily", "time", "09:00"), "UTC", null, null, "application", null));
    when(store.get("editable", false)).thenReturn(task);
    when(store.runViews(List.of("editable"), "admin")).thenReturn(
        List.of(new TaskStore.RunViews("editable", null, null, null, null)));
    when(capabilities.names("tenant", List.of(task))).thenReturn(new TriggerCapabilities.Names(Map.of(), Map.of()));
    when(definitions.canRead(any(), any())).thenReturn(true);
    when(definitions.decide(any(), argThat(request -> request instanceof ObjectAccess access
        && access.verb() == Verb.EDIT && access.target().id().equals("editable"))))
        .thenReturn(new Decision(false, "OBJECT_FORBIDDEN", "Edit refused"));
    var targets = object("actions", array(), "workflows", array());
    when(capabilities.targets(argThat(actor -> actor.identity().userId().equals("admin")
        && actor.identity().domainId().equals("tenant") && actor.roles() == subject.roles()))).thenReturn(targets);

    var result = (JsonNode) reads.triggerPanelForm().handler().read(subject, Map.of("primaryKey", "editable"));
    assertEquals("agents", result.at("/task/appId").asText());
    assertEquals("Edit refused", result.at("/edit/reason").asText());
    assertSame(targets, reads.triggerPanelTargets().handler().read(subject, Map.of()));
    verifyNoInteractions(identity);
    verify(definitions, never()).subject(any());
  }

  @Test
  void incomingTriggersPutTheFailedRunFirstForOneEdgePages() {
    var earlier = trigger("earlier");
    var failed = trigger("failed");
    when(earlier.nextRunAt()).thenReturn(Instant.parse("2026-11-27T03:00:00Z"));
    when(failed.nextRunAt()).thenReturn(Instant.parse("2026-11-27T04:00:00Z"));
    for (var task : List.of(earlier, failed)) {
      var id = task.id();
      when(task.definition()).thenReturn(new TaskDefinition(id, null, object(), null,
          object("kind", "daily", "time", "09:00"), "UTC", null, null, "workflow", "wf-1"));
    }
    when(store.ontologyIncoming("tenant", "workflow", "wf-1")).thenReturn(List.of(earlier, failed));
    when(definitions.canRead(any(), any())).thenReturn(true);
    when(store.lastRunStatuses(List.of("earlier", "failed")))
        .thenReturn(Map.of("earlier", "completed", "failed", "failed"));

    JsonNode rows = JSON.valueToTree(reads.ontologyIncomingWorkflowTriggers().handler().read(subject, Map.of(
        "className", "platform:Workflow", "primaryKey", "wf-1",
        "from", "platform:Trigger", "to", "platform:Workflow", "direction", "incoming")));
    assertEquals("failed", rows.at("/0/id").asText());
    assertEquals("earlier", rows.at("/1/id").asText());
  }

  private static Trigger trigger(String id) {
    var task = mock(Trigger.class);
    when(task.id()).thenReturn(id);
    when(task.domain()).thenReturn("tenant");
    when(task.creator()).thenReturn("admin");
    when(task.coauthors()).thenReturn(List.of());
    when(task.status()).thenReturn(Trigger.PUBLISHED);
    return task;
  }
}
