package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.SimpleUser;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Verifies that background generation (such as async action explanation after {@code /action/save})
 * captures the initiating HTTP credential on the servlet thread and passes it into channel admission
 * when executing on a virtual thread where {@link RequestContextHolder} is empty.
 */
class OntologyGenerationBackgroundContextTest {
  private final Owner owner = new Owner("user-1", "domain-1");

  @AfterEach
  void cleanupRequestContext() {
    RequestContextHolder.resetRequestAttributes();
  }

  private Fixture fixture(String tokenHeader, String apiKeyHeader, String callerHeader) throws Exception {
    var jdbc = mock(JdbcTemplate.class);
    var identities = mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class);
    var identity = mock(IdentityService.class);
    var retrieverAccess = mock(RetrieverAccess.class);
    when(identity.getCurrentUser()).thenReturn(new SimpleUser(owner.userId(), "u", "u", true, owner.domainId()));
    long credentialExpiry = Instant.now().plusSeconds(3600).toEpochMilli();
    when(identity.getCurrentCredentialExpiresAt()).thenReturn(credentialExpiry);
    if (callerHeader != null) {
      when(jdbc.queryForList(contains("FROM ontology_retrieval_callers"), eq(java.util.UUID.fromString(callerHeader))))
          .thenReturn(List.of(Map.of("user_id", owner.userId(), "domain_id", owner.domainId())));
    }
    var callers = new AgentCaller(jdbc, identities, identity, retrieverAccess);

    var store = mock(OntologyAgentStore.class);
    when(store.transaction(any())).thenAnswer(call -> call.<java.util.function.Supplier<?>>getArgument(0).get());
    String runDeadline = Instant.now().plusSeconds(180).toString();
    when(store.run(anyString(), anyString(), eq(owner)))
        .thenReturn(JSONObject.of("deadline", runDeadline, "cancel_requested", false));

    var runtime = mock(AgentRuntimeClient.class);
    when(runtime.waitStopped(eq(owner.domainId()), anyString(), anyLong()))
        .thenReturn(JSONObject.of("status", "stopped"));
    when(runtime.run(eq(owner.domainId()), anyString()))
        .thenReturn(JSONObject.of("run", JSONObject.of("stopReason", "stop")));
    when(runtime.json(eq(owner.domainId()), anyString(), contains("/artifacts?"), eq("GET"), isNull(), isNull()))
        .thenAnswer(call -> JSONObject.of("artifacts", List.of(
            JSONObject.of("id", "art-1", "runId", call.getArgument(1), "sessionId", "s"))));

    var channel = mock(AgentChannelRuns.class);
    var sentContext = new AtomicReference<OntologyAgentAccess.Context>();
    var sentSourceRun = new AtomicReference<String>();
    when(channel.send(anyString(), anyString(), anyString(), any(), any(), any(), nullable(String.class), eq(false)))
        .thenAnswer(call -> {
          sentContext.set(call.getArgument(5));
          sentSourceRun.set(call.getArgument(6));
          throw new RuntimeException("stop-after-admission-check");
        });

    var permissions = mock(DataPermissionLookup.class);
    var perm = new UserDataPermission();
    perm.setFullData(true);
    when(permissions.getDataPermission(owner.userId(), owner.domainId())).thenReturn(perm);

    var sessions = mock(SessionRegistryService.class);
    when(sessions.getNodeId()).thenReturn("node-1");

    var factory = new DefaultListableBeanFactory();
    factory.registerSingleton("callers", callers);
    factory.registerSingleton("channel", channel);

    var generation = new OntologyGenerationService(
        store,
        runtime,
        mock(OntologyAgentDefinitions.class),
        mock(QueryGrantService.class),
        sessions,
        mock(GenerationOperations.class),
        mock(RuntimeCodeClient.class),
        permissions,
        factory.getBeanProvider(AgentCaller.class),
        factory.getBeanProvider(AgentChannelRuns.class));

    var request = new MockHttpServletRequest();
    if (tokenHeader != null) request.addHeader("tk", tokenHeader);
    if (apiKeyHeader != null) request.addHeader("X-API-Key", apiKeyHeader);
    if (callerHeader != null) request.addHeader("X-Ontomato-Retrieval-Caller-Id", callerHeader);
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

    return new Fixture(generation, sentContext, sentSourceRun);
  }

  private record Fixture(
      OntologyGenerationService generation,
      AtomicReference<OntologyAgentAccess.Context> sentContext,
      AtomicReference<String> sentSourceRun) {}

  @Test
  void propagatesCapturedTokenIntoBackgroundVirtualThread() throws Exception {
    var fx = fixture("browser-tk-123", null, null);
    OntologyAgentAccess.Context captured = fx.generation.captureContext(owner, "zh-CN");
    assertNotNull(captured);
    assertEquals("browser-tk-123", captured.token());
    assertNull(captured.apiKey());
    assertNull(captured.callerId());

    // Leave the servlet thread completely before running background explanation.
    RequestContextHolder.resetRequestAttributes();
    var done = new CompletableFuture<Void>();
    Thread.startVirtualThread(() -> {
      try {
        assertNull(RequestContextHolder.getRequestAttributes());
        OntologyGenerationService.asContext(captured, () -> {
          fx.generation.generate("explain", "biz-1", "prompt", "zh-CN", owner.domainId(), "code");
          return null;
        });
      } catch (RuntimeException expected) {
        if (!"stop-after-admission-check".equals(expected.getMessage())) {
          done.completeExceptionally(expected);
          return;
        }
      }
      done.complete(null);
    });
    done.get(5, TimeUnit.SECONDS);

    assertNotNull(fx.sentContext.get());
    assertEquals("browser-tk-123", fx.sentContext.get().token());
    assertNull(fx.sentContext.get().callerId());
    assertNull(fx.sentSourceRun.get());
  }

  @Test
  void propagatesCapturedApiKeyAndDropsTransientCallerReference() throws Exception {
    String callerId = "11111111-1111-1111-1111-111111111111";
    var fx = fixture(null, "agent-api-key-999", callerId);
    OntologyAgentAccess.Context captured = fx.generation.captureContext(owner, "en");
    assertNotNull(captured);
    assertEquals("agent-api-key-999", captured.apiKey());
    assertNull(captured.callerId());

    RequestContextHolder.resetRequestAttributes();
    var done = new CompletableFuture<Void>();
    Thread.startVirtualThread(() -> {
      try {
        OntologyGenerationService.asContext(captured, () -> {
          fx.generation.generate("explain", "biz-2", "prompt", "en", owner.domainId(), "code");
          return null;
        });
      } catch (RuntimeException expected) {
        if (!"stop-after-admission-check".equals(expected.getMessage())) {
          done.completeExceptionally(expected);
          return;
        }
      }
      done.complete(null);
    });
    done.get(5, TimeUnit.SECONDS);

    assertNotNull(fx.sentContext.get());
    assertEquals("agent-api-key-999", fx.sentContext.get().apiKey());
    assertNull(fx.sentContext.get().callerId());
  }
}
