package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class OntologyAgentAccessTest {
  /** The header names a caller that may not exist yet (its own creation) or is already closed (evidence reads). */
  @Test
  void currentDoesNotRequireTheCallerToExist() {
    var queries = mock(QueryAccessService.class);
    var store = mock(OntologyAgentStore.class);
    var request = mock(HttpServletRequest.class);
    String caller = "6f1f4c43-3c33-4f5d-9a79-3f8d3f6d1a11";
    when(request.getHeader("X-Ontomato-Retrieval-Caller-Id")).thenReturn(caller);
    when(queries.access(request)).thenReturn(new QueryAccessService.Access(
        new QueryAccessService.GrantUser("user", "domain"), new UserDataPermission(), null, null, null));

    var context = new OntologyAgentAccess(queries, mock(IdentityService.class), mock(QueryGrantService.class), store)
        .current(request);

    assertEquals(caller, context.callerId());
    verifyNoInteractions(store);
  }

  /** A stream outlives the request thread, so the read rule is captured there and only ownership is per frame. */
  @Test
  void sessionReadsAppliesQueryPermissionAndKeepsStorageFailures() {
    var queries = mock(QueryAccessService.class);
    var identity = mock(IdentityService.class);
    var store = mock(OntologyAgentStore.class);
    var request = mock(HttpServletRequest.class);
    var user = new QueryAccessService.GrantUser("user", "domain");
    var owner = new OntologyAgentStore.Owner("user", "domain");
    when(identity.getCurrentUser()).thenReturn(user);
    when(store.session("governed", owner))
        .thenReturn(JSONObject.of("agent_id", "56a15178-ae22-4e6f-9974-ababeb42a676"));
    when(store.session("retrieval", owner))
        .thenReturn(JSONObject.of("agent_id", OntologyAgentStore.RETRIEVER));
    when(store.session("foreign", owner)).thenThrow(AgentHttpException.missing());
    when(store.session("broken", owner)).thenThrow(new IllegalStateException("storage"));
    var access =
        new OntologyAgentAccess(queries, identity, mock(QueryGrantService.class), store);

    var allowed = access.sessionReads(request);
    // The decision (and the verified owner) is fixed when the connection opens.
    assertFalse(allowed.readable("governed"));
    assertTrue(allowed.readable("retrieval"));
    assertFalse(allowed.readable("foreign"));
    assertThrows(IllegalStateException.class, () -> allowed.readable("broken"));

    doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(identity).requireQueryAccess();
    var denied = access.sessionReads(request);
    assertFalse(denied.readable("governed"));
    assertFalse(denied.readable("retrieval"));

    doThrow(new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR))
        .when(identity).requireQueryAccess();
    assertThrows(ResponseStatusException.class, () -> access.sessionReads(request));
  }

  @Test void executorCredentialAndCallerIdCannotRestoreAnotherUsersOwnershipWithoutServiceAuthentication() {
    var queries=mock(QueryAccessService.class);var store=mock(OntologyAgentStore.class);
    var user=new QueryAccessService.GrantUser("V","domain");var permission=new UserDataPermission();permission.setFullData(true);
    var request=new org.springframework.mock.web.MockHttpServletRequest();
    String caller="6f1f4c43-3c33-4f5d-9a79-3f8d3f6d1a11";request.addHeader("X-Ontomato-Retrieval-Caller-Id",caller);
    when(queries.access(request)).thenReturn(new QueryAccessService.Access(user,permission,null,null,null));
    when(store.serviceCaller(caller,"domain")).thenReturn(JSONObject.of("user_id","U","domain_id","domain","closed",false,"deadline",java.time.Instant.now().plusSeconds(60).toString(),"input",JSONObject.of("executionUserId","V","classNames",java.util.List.of("Orders"))));
    var grants=new QueryGrantService(mock(org.springframework.jdbc.core.JdbcTemplate.class),"signing",new io.ontomato.dataengine.service.WorkbenchServiceAuthentication("host-service"));
    var access=new OntologyAgentAccess(queries,mock(IdentityService.class),grants,store);
    var narrowed=access.scopedQuery(queries.access(request),caller);
    assertEquals("V",narrowed.initiatorUserId());
    assertThrows(ResponseStatusException.class,()->access.executionContext(request));
    request.addHeader("X-Ontomato-Query-Service-Token","host-service");
    var restored=access.executionContext(request);
    assertEquals("U",restored.owner().userId());assertEquals("V",restored.access().user().getId());
    assertEquals(java.util.List.of("Orders"),restored.access().classNames());
  }
}
