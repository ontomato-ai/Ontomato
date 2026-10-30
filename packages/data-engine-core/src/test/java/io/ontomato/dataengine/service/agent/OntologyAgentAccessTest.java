package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;

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
}
