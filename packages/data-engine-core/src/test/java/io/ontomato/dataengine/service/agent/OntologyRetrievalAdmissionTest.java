package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.*;
import org.junit.jupiter.api.Test;

class OntologyRetrievalAdmissionTest {
    @Test void directAdmissionChecksTheExecutionUserBeforeCreatingASession() {
        var store = mock(OntologyAgentStore.class);
        var grants = mock(ProductGrantService.class);
        var service = new OntologyRetrievalService(store, null, null, null, null, null, null, null, null, null, null, null, grants);
        var user = new QueryAccessService.GrantUser("executor", "domain");
        var access = new QueryAccessService.Access(user, null, null, null, null);
        var context = new OntologyAgentAccess.Context(new OntologyAgentStore.Owner("initiator", "domain"),
            access, null, null, "en", null, null, "executor");

        assertEquals(403, assertThrows(AgentHttpException.class,
            () -> service.begin("run", new JSONObject(), context)).status());
        verify(grants).allowedFor("domain", "executor", OntologyAgentStore.RETRIEVER, "use");
        verifyNoInteractions(store);
    }
}
