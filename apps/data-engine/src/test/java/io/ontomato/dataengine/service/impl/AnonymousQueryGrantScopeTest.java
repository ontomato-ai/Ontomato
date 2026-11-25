package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.controller.QueryGrantFilter;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.agent.AgentExecutionAccess;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.identity.UserCredentials;
import jakarta.servlet.FilterChain;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class AnonymousQueryGrantScopeTest {
  @Test void anonymousEditionChecksGrantOperationsDomainAndClassScope() throws Exception {
    var identity = new AnonymousIdentityService();
    var executions = new AgentExecutionAccess(new AnonymousScheduleIdentity(identity), mock(UserCredentials.class));
    var jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(contains("id=? AND run_id=?"), eq(Integer.class),
        anyString(), anyString(), anyString(), anyLong())).thenReturn(1);
    var grants = new QueryGrantService(jdbc, "test-key", new WorkbenchServiceAuthentication("internal"));
    var filter = new QueryGrantFilter(grants, executions, identity);

    var allowed = request(grants, "1", "/ontology/query/execute-dsl");
    var response = new MockHttpServletResponse();
    var chain = mock(FilterChain.class);
    filter.doFilter(allowed, response, chain);
    verify(chain).doFilter(allowed, response);
    assertTrue(QueryGrantService.limit(allowed).permits(new AuthorizationService.Data(List.of("Order"))));
    assertFalse(QueryGrantService.limit(allowed).permits(new AuthorizationService.Data(List.of("Ledger"))));

    for (var denied : List.of(request(grants, "other", "/ontology/query/execute-dsl"),
        request(grants, "1", "/platform/authorization/object"))) {
      response = new MockHttpServletResponse();
      chain = mock(FilterChain.class);
      filter.doFilter(denied, response, chain);
      assertEquals(403, response.getStatus());
      assertNull(denied.getAttribute(QueryGrantService.ATTRIBUTE));
      verifyNoInteractions(chain);
    }
  }

  private static MockHttpServletRequest request(QueryGrantService grants, String domain, String path) {
    var token = grants.issue("admin", domain, "retrieval-exploration", "run",
        System.currentTimeMillis() + 60_000, List.of("Order"), null);
    var request = new MockHttpServletRequest("POST", path);
    request.addHeader("tk", token);
    request.addHeader("X-Ontomato-Run-Id", "run");
    return request;
  }
}
