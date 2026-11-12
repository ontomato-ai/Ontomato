package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner;
import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.*;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

class OntologyGenerationCleanupTest {
  private static final String SESSION = "11111111-1111-1111-1111-111111111111";
  private static final String RUN = "22222222-2222-2222-2222-222222222222";
  private static final String SANDBOX = "a" + RUN.replace("-", "");
  private static final Owner OWNER = new Owner("fixture-user", "fixture-domain");

  private FakeStore store;
  private AgentRuntimeClient runtime;
  private QueryGrantService grants;
  private SessionRegistryService sessions;
  private GenerationOperations operations;
  private RuntimeCodeClient code;
  private OntologyGenerationService generation;
  private Logger cleanupLogger;
  private ListAppender<ILoggingEvent> warnings;

  @BeforeEach
  void setUp() {
    store = new FakeStore();
    runtime = mock(AgentRuntimeClient.class);
    grants = mock(QueryGrantService.class);
    sessions = mock(SessionRegistryService.class);
    operations = mock(GenerationOperations.class);
    code = mock(RuntimeCodeClient.class);
    when(sessions.getNodeId()).thenReturn("fixture-node");
    generation =
        new OntologyGenerationService(
            store,
            runtime,
            mock(OntologyAgentDefinitions.class),
            grants,
            sessions,
            operations,
            code,
            mock(DataPermissionLookup.class));
    cleanupLogger = (Logger) LoggerFactory.getLogger(OntologyGenerationService.class);
    warnings = new ListAppender<>();
    warnings.start();
    cleanupLogger.addAppender(warnings);
  }

  @AfterEach
  void tearDown() {
    cleanupLogger.detachAppender(warnings);
    warnings.stop();
  }

  @Test
  void absentResourcesDoNotBlockCleanup() throws Exception {
    store.tests.add(JSONObject.of("execution_id", UUID.randomUUID().toString()));
    doThrow(AgentHttpException.missing()).when(code).closeIntent(anyString(), anyString());
    doThrow(
            new IllegalStateException(
                "Cannot remove generation sandbox", AgentHttpException.missing()))
        .when(operations)
        .dropSandbox(SANDBOX, OWNER.domainId());
    when(runtime.json(any(), anyString(), contains("/cancel"), eq("POST"), any(), any()))
        .thenThrow(AgentHttpException.missing());

    generation.close(SESSION, RUN, OWNER);

    assertTrue(store.cancelConfirmed);
    assertNull(store.source);
    assertNull(store.testData);
    assertNull(store.sandboxId);
    assertTrue(store.closed);
    verify(operations).dropSandbox(SANDBOX, OWNER.domainId());
    verify(runtime)
        .json(eq(OWNER.domainId()), eq(RUN), contains("/cancel"), eq("POST"), any(), isNull());
    verify(code).closeIntent(eq(OWNER.domainId()), anyString());
    assertEquals(0, cleanupWarnings());
  }

  @Test
  void repeatedCleanupLeavesTheSameState() throws Exception {
    store.tests.add(JSONObject.of("execution_id", UUID.randomUUID().toString()));
    doThrow(AgentHttpException.missing()).when(code).closeIntent(anyString(), anyString());
    when(runtime.json(any(), anyString(), contains("/cancel"), eq("POST"), any(), any()))
        .thenThrow(AgentHttpException.missing());

    generation.close(SESSION, RUN, OWNER);
    generation.close(SESSION, RUN, OWNER);

    assertTrue(store.cancelConfirmed);
    assertNull(store.source);
    assertNull(store.testData);
    assertNull(store.sandboxId);
    verify(operations, times(1)).dropSandbox(SANDBOX, OWNER.domainId());
    verify(runtime, times(2))
        .json(eq(OWNER.domainId()), eq(RUN), contains("/cancel"), eq("POST"), any(), isNull());
    verify(code, times(2)).closeIntent(eq(OWNER.domainId()), anyString());
    assertEquals(0, cleanupWarnings());
  }

  @Test
  void retriesBackOffAndWarnOnlyWhenTheReasonChanges() throws Exception {
    when(runtime.json(any(), anyString(), contains("/cancel"), eq("POST"), any(), any()))
        .thenThrow(new AgentHttpException(503, "DEPENDENCY_UNAVAILABLE", "Runtime unavailable"))
        .thenThrow(new AgentHttpException(503, "DEPENDENCY_UNAVAILABLE", "Runtime unavailable"))
        .thenThrow(new AgentHttpException(500, "INTERNAL", "Different failure"));

    generation.close(SESSION, RUN, OWNER);
    assertEquals(1, cleanupWarnings());
    assertFalse(store.cancelConfirmed);
    verify(runtime, times(1))
        .json(eq(OWNER.domainId()), eq(RUN), contains("/cancel"), eq("POST"), any(), isNull());

    // A failing run is not retried again inside its backoff window.
    for (int attempt = 0; attempt < 5; attempt++) generation.recover();
    assertEquals(1, cleanupWarnings());
    verify(runtime, times(1))
        .json(eq(OWNER.domainId()), eq(RUN), contains("/cancel"), eq("POST"), any(), isNull());

    // An explicit close still tries immediately; the same reason must not warn again.
    generation.close(SESSION, RUN, OWNER);
    assertEquals(1, cleanupWarnings());
    verify(runtime, times(2))
        .json(eq(OWNER.domainId()), eq(RUN), contains("/cancel"), eq("POST"), any(), isNull());

    // A changed reason is the only other time the cleanup warns.
    generation.close(SESSION, RUN, OWNER);
    assertEquals(2, cleanupWarnings());
    verify(runtime, times(3))
        .json(eq(OWNER.domainId()), eq(RUN), contains("/cancel"), eq("POST"), any(), isNull());
  }

  private long cleanupWarnings() {
    return warnings.list.stream().filter(event -> event.getLevel() == Level.WARN).count();
  }

  /**
   * A small in-memory stand-in for the store, enough to see whether cleanup reaches its final
   * confirmed state and whether repeating it changes that state.
   */
  private static final class FakeStore extends OntologyAgentStore {
    final List<JSONObject> tests = new ArrayList<>();
    boolean closed;
    boolean cancelConfirmed;
    String source = "fixture-source";
    String testData = "{}";
    String sandboxId = SANDBOX;

    FakeStore() {
      super(mock(JdbcTemplate.class), mock(PlatformTransactionManager.class));
    }

    @Override
    public <T> T transaction(Supplier<T> operation) {
      return operation.get();
    }

    @Override
    public int update(String sql, Object... values) {
      if (sql.contains("cancel_confirmed=true")) cancelConfirmed = true;
      if (sql.contains("ontology_generations SET source=NULL")) {
        source = null;
        testData = null;
        sandboxId = null;
      }
      return 1;
    }

    @Override
    public List<JSONObject> rows(String sql, Object... values) {
      if (sql.contains("JOIN ontology_agent_runs") && sql.contains("cancel_confirmed=false")) {
        if (cancelConfirmed) return List.of();
        var row = new JSONObject();
        row.put("id", RUN);
        row.put("session_id", SESSION);
        row.put("deadline", Instant.now().plusSeconds(60).toString());
        row.put("cancel_requested", false);
        row.put("external", false);
        row.put("user_id", OWNER.userId());
        row.put("domain_id", OWNER.domainId());
        return List.of(row);
      }
      if (sql.contains("ontology_generation_tests")) return tests;
      return List.of();
    }

    @Override
    public JSONObject one(String sql, Object... values) {
      var row = new JSONObject();
      if (sql.contains("ontology_generations")) {
        row.put("sandbox_id", sandboxId);
        row.put("business_id", "fixture-business");
      } else if (sql.contains("ontology_agent_runs")) {
        row.put("external", false);
      }
      return row;
    }

    @Override
    public JSONObject run(String session, String id, Owner owner) {
      var row = new JSONObject();
      row.put("external", false);
      return row;
    }

    @Override
    public void closeRun(String sessionId, String id, Owner owner) {
      closed = true;
    }
  }
}
