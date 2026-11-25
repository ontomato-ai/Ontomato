package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.controller.QueryGrantFilter;
import io.ontomato.dataengine.service.agent.AgentExecutionAccess;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class QueryGrantScopeTest {
  private static final String QUERY = "/ontology/query/execute-dsl";
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final QueryGrantService grants = new QueryGrantService(jdbc, "test-key", new WorkbenchServiceAuthentication("internal"));
  private final long deadline = System.currentTimeMillis() + 60_000;

  @BeforeEach void activeGrants() {
    when(jdbc.queryForObject(contains("id=? AND run_id=?"), eq(Integer.class),
        anyString(), anyString(), anyString(), anyLong())).thenReturn(1);
    when(jdbc.queryForObject(contains("WHERE id=? AND domain_id=?"), eq(Integer.class),
        anyString(), anyString(), anyLong())).thenReturn(1);
  }

  @Test void requestMustMatchStableOperationMethodAndBoundResource() {
    String token = grants.issue("user", "domain", "retrieval-exploration", "run", deadline,
        List.of("Order"), null, JSONObject.of("retrievalId", "retrieval"));
    var path = "/ontology/retrievals/retrieval/runs/run/outputs/receipt/content";
    assertDoesNotThrow(() -> grants.verifyRequest(token, "run", "GET", path));
    rejected(HttpStatus.FORBIDDEN, () -> grants.verifyRequest(token, "run", "GET", path.replace("/retrieval/", "/other/")));
    rejected(HttpStatus.FORBIDDEN, () -> grants.verifyRequest(token, "run", "POST", path));
    rejected(HttpStatus.FORBIDDEN, () -> grants.verifyRequest(token, "run", "POST", "/ontology/query/future-operation"));
    rejected(HttpStatus.UNAUTHORIZED, () -> grants.verifyRequest(token, "another-run", "POST", QUERY));
  }

  @Test void previouslyIssuedGrantDoesNotSurviveTheFormatCutover() throws Exception {
    var old = JSONObject.of("iss", "ontology", "aud", "ontology-query", "runId", "run",
        "userId", "user", "domainId", "domain", "jti", "existing", "expiresAt", deadline,
        "purpose", "user-read", "classNames", List.of("Order"));
    var encoder = Base64.getUrlEncoder().withoutPadding();
    var payload = encoder.encodeToString(JSON.toJSONBytes(old));
    var mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec("test-key".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    var signature = encoder.encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
    rejected(HttpStatus.UNAUTHORIZED, () -> grants.verify("oq." + payload + "." + signature, "run"));
    verifyNoInteractions(jdbc);
  }

  @Test void childIntersectsClassesAndExpiryAndDiesWhenItsParentIsRevoked() {
    var parent = grants.issue("user", "domain", "retrieval-exploration", "parent", deadline,
        List.of("Order"), null);
    var reference = new PythonAuthority.ParentGrant(parent, "parent", deadline + 60_000);
    var authority = PythonAuthority.read("user", "domain").withParent(reference).withClasses(List.of("Order", "Ledger"));
    String token = grants.issueExecution(authority, "child", deadline + 60_000);
    var claims = grants.verifyRequest(token, "child", "POST", QUERY);
    assertEquals(List.of("Order"), claims.getList("classNames", String.class));
    assertEquals(deadline, claims.getLongValue("expiresAt"));
    assertTrue(claims.getBooleanValue("requiresQueryAccess"));
    rejected(HttpStatus.FORBIDDEN, () -> grants.issueExecution(authority.withClasses(List.of("Ledger")), "child", deadline));
    rejected(HttpStatus.FORBIDDEN, () -> grants.issueExecution(PythonAuthority.read("user", "other").withParent(reference), "child", deadline));
    rejected(HttpStatus.FORBIDDEN, () -> grants.issueExecution(PythonAuthority.write("user", "domain", "sandbox").withParent(reference), "child", deadline));

    String id = grants.verify(parent, "parent").getString("jti");
    when(jdbc.queryForObject(contains("WHERE id=? AND domain_id=?"), eq(Integer.class),
        eq(id), eq("domain"), anyLong())).thenReturn(0);
    rejected(HttpStatus.UNAUTHORIZED, () -> grants.verifyRequest(token, "child", "POST", QUERY));
  }

  @Test void sandboxAuthoringParentIsInternalAndCannotDelegateToLiveOrAnotherSandbox() {
    var contexts = mock(DataSandboxService.class);
    ReflectionTestUtils.setField(grants, "contexts", contexts);
    var target = new ExecutionTarget("context", "context-sandbox", List.of("Order"), deadline);
    when(contexts.require("context", "user", "domain")).thenReturn(target);
    var authority = PythonAuthority.write("user", "domain", "context-sandbox").withTarget(target)
        .withAuthorSandbox("author-sandbox");
    var parent = grants.issueAuthoringParent(authority, "parent", deadline);
    var reference = new PythonAuthority.ParentGrant(parent, "parent", deadline);
    rejected(HttpStatus.FORBIDDEN, () -> grants.verifyRequest(parent, "parent", "POST", QUERY));
    rejected(HttpStatus.FORBIDDEN, () -> grants.issueExecution(
        authority.withAuthorSandbox("different-sandbox").withParent(reference), "child", deadline));
    rejected(HttpStatus.FORBIDDEN, () -> grants.issueExecution(
        PythonAuthority.read("user", "domain").withParent(reference), "child", deadline));
    var token = grants.issueExecution(authority.withParent(reference), "child", deadline);
    for (String path : List.of(QUERY, "/writeFunctionOperation/insert")) {
      var scoped = QueryGrantService.target(grants.verifyRequest(token, "child", "POST", path));
      assertEquals(ExecutionTarget.Mode.SANDBOX, scoped.mode());
      assertEquals("author-sandbox", scoped.sandboxId());
    }
  }

  @Test void sandboxGenerationKeepsTheSampleBindingAndRejectsLiveOnlyOperations() {
    var contexts = mock(DataSandboxService.class);
    ReflectionTestUtils.setField(grants, "contexts", contexts);
    var target = new ExecutionTarget("context", "sample", List.of("Order"), deadline);
    when(contexts.require("context", "initiator", "domain")).thenReturn(target);
    var user = new QueryAccessService.GrantUser("executor", "domain");
    var access = new QueryAccessService.Access(user, null, null, null, deadline, List.of("Order"), target);
    var token = grants.issueForTarget("ontology-generation", "run", deadline + 60_000, access,
        JSONObject.of("initiatorUserId", "initiator", "executionUserId", "executor"));
    var scoped = QueryGrantService.target(grants.verifyRequest(token, "run", "POST", QUERY));
    assertEquals("sample", scoped.sandboxId());
    assertEquals(deadline, scoped.expiresAt());
    rejected(HttpStatus.FORBIDDEN, () -> grants.verifyRequest(token, "run", "POST", "/ontology/query/metrics/execute"));
    rejected(HttpStatus.FORBIDDEN, () -> grants.verifyRequest(token, "run", "POST", "/ontology/ai/generation/run/query"));
  }

  @Test void filterRechecksCurrentSubjectAndQueryPermissionAndExposesOnlyDataScope() throws Exception {
    var executions = mock(AgentExecutionAccess.class);
    var identity = mock(IdentityService.class);
    var filter = new QueryGrantFilter(grants, executions, identity);
    var token = grants.issue("user", "domain", "retrieval-exploration", "run", deadline, List.of("Order"), null);
    var request = request(token);
    var chain = mock(jakarta.servlet.FilterChain.class);
    var response = new MockHttpServletResponse();
    filter.doFilter(request, response, chain);
    verify(chain).doFilter(request, response);
    verify(executions).requireMember("domain", "user");
    verify(identity).requireQueryAccess("user", "domain");
    var limit = QueryGrantService.limit(request);
    assertTrue(limit.permits(new AuthorizationService.Data(List.of("Order"))));
    assertFalse(limit.permits(new AuthorizationService.Data(List.of("Ledger"))));
    assertFalse(limit.permits(new AuthorizationService.Management("administration.example")));

    doThrow(new AgentHttpException(403, "EXECUTION_USER_INVALID", "Member removed"))
        .when(executions).requireMember("domain", "user");
    assertBlocked(filter, request(token));
    doAnswer(call -> null).when(executions).requireMember("domain", "user");
    doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "Query permission revoked")).when(identity).requireQueryAccess("user", "domain");
    assertBlocked(filter, request(token));

    var override = request(token);
    override.addHeader(DataSandboxService.HEADER, "{}");
    assertBlocked(filter, override);
  }

  private static MockHttpServletRequest request(String token) {
    var request = new MockHttpServletRequest("POST", QUERY);
    request.addHeader("tk", token);
    request.addHeader("X-Ontomato-Run-Id", "run");
    return request;
  }

  private static void assertBlocked(QueryGrantFilter filter, MockHttpServletRequest request) throws Exception {
    var response = new MockHttpServletResponse();
    var chain = mock(jakarta.servlet.FilterChain.class);
    filter.doFilter(request, response, chain);
    assertEquals(403, response.getStatus());
    assertNull(request.getAttribute(QueryGrantService.ATTRIBUTE));
    verifyNoInteractions(chain);
  }

  private static void rejected(HttpStatus status, org.junit.jupiter.api.function.Executable call) {
    assertEquals(status, assertThrows(ResponseStatusException.class, call).getStatusCode());
  }
}
