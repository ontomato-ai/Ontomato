package io.ontomato.dataengine.schedules;

import static org.junit.jupiter.api.Assertions.*;

import java.util.UUID;
import org.junit.jupiter.api.Test;

class TaskStoreHostSessionTest {
  @Test
  void admissionAndRecoveryUseAStableSeparateSession() {
    UUID run = UUID.fromString("30000000-0000-4000-8000-000000000002");
    assertNotEquals(run, TaskStore.session(run));
    assertEquals(TaskStore.session(run), TaskStore.session(run));
    assertNotEquals(TaskStore.session(run), TaskStore.session(UUID.randomUUID()));
  }
}
