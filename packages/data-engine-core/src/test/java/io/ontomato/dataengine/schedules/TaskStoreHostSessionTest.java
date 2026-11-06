package io.ontomato.dataengine.schedules;

import static org.junit.jupiter.api.Assertions.*;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class TaskStoreHostSessionTest {
  private TaskStore.Run run(UUID id, UUID sessionId) {
    return new TaskStore.Run(
        id, UUID.randomUUID(), null, sessionId, "schedule", "running", null, null, null, null, null);
  }

  @Test
  void sessionAndRunUseSeparateRuntimeAdmissionKeys() {
    UUID id = UUID.randomUUID();
    UUID session = TaskStore.hostSession(run(id, null));
    assertNotEquals(id, session);
    assertNotEquals(session, TaskStore.hostSession(run(UUID.randomUUID(), null)));
  }

  @Test
  void settlementFindsTheSameSessionAfterALostAdmissionResponse() {
    UUID id = UUID.randomUUID();
    UUID dispatched = TaskStore.hostSession(run(id, null));
    assertEquals(dispatched, TaskStore.hostSession(run(id, null)));
    assertEquals(dispatched, TaskStore.hostSession(run(id, dispatched)));
  }

  @Test
  void existingAndImportedSessionLinksArePreserved() {
    UUID id = UUID.randomUUID(), session = UUID.randomUUID();
    assertEquals(session, TaskStore.hostSession(run(id, session)));
    assertEquals(id, TaskStore.hostSession(run(id, id)));
  }
}
