package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

class OntologyRetrievalAdmissionTest {
    @Test void directAdmissionChecksTheExecutionUserBeforeCreatingASession() {
        var store = mock(OntologyAgentStore.class);
        var retrieverAccess = mock(RetrieverAccess.class);
        var subject = mock(SubjectContext.class);
        when(retrieverAccess.subject(new OntologyAgentStore.Owner("executor", "domain"))).thenReturn(subject);
        doThrow(new AgentHttpException(403, "OBJECT_FORBIDDEN", "Denied"))
            .when(retrieverAccess).require(subject, Verb.USE);
        var service = new OntologyRetrievalService(store, null, null, null, null, null, null, null, null, null, null, null, retrieverAccess);
        var user = new QueryAccessService.GrantUser("executor", "domain");
        var access = new QueryAccessService.Access(user, null, null, null, null);
        var context = new OntologyAgentAccess.Context(new OntologyAgentStore.Owner("initiator", "domain"),
            access, null, null, "en", null, null, "executor");

        assertEquals(403, assertThrows(AgentHttpException.class,
            () -> service.begin("run", new JSONObject(), context)).status());
        verifyNoInteractions(store);
    }
    @Test void retrievalAdmissionDoesNotGrantTheExecutorQueryAccess() {
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("executor", "domain"));
        var queries = new QueryAccessService(identity, mock(DataPermissionLookup.class), mock(QueryGrantService.class));
        var request = new MockHttpServletRequest();

        assertEquals("executor", queries.forRetrievalAdmission(request).user().getId());
        verify(identity, never()).requireQueryAccess();

        request.setAttribute(QueryGrantService.ATTRIBUTE,
            JSONObject.of("purpose", "retrieval-exploration", "userId", "executor", "domainId", "domain"));
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(identity).requireQueryAccess("executor", "domain");
        assertEquals(HttpStatus.FORBIDDEN,
            assertThrows(ResponseStatusException.class, () -> queries.access(request)).getStatusCode());
    }
}
