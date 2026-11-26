package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import io.ontomato.dataengine.core.bean.SimpleUser;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.server.ResponseStatusException;

class PanelResourcesTest {
    private static final String URL = "http://workbench/internal/product-panels/validate-references";
    private final RestClient.Builder builder = RestClient.builder().baseUrl("http://workbench")
        .defaultHeader("X-Ontomato-Query-Service-Token", "fixture-service");
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final IdentityService identity = mock(IdentityService.class);
    private final PanelResources panels = new PanelResources(builder.build(), identity);

    @AfterEach void resetRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test void forwardsSessionOrApiKeyAndReturnsTheOwnerRefusal() {
        var user = new SimpleUser("registrant", "login", "Name", true, "domain");
        when(identity.getCurrentUser()).thenReturn(user);
        when(identity.workbenchSubjectId(user)).thenReturn("registrant");
        for (var name : List.of("tk", "X-API-Key")) {
            var request = request();
            request.addHeader(name, "fixture-credential");
            request.addHeader("X-Ontomato-Application-Registrant", "spoofed");
            request.addHeader("X-Ontomato-Agent-Execution", "fixture-scope");
            server.expect(requestTo(URL))
                .andExpect(header("X-Ontomato-Query-Service-Token", "fixture-service"))
                .andExpect(header("X-Ontomato-Application-Registrant", "registrant"))
                .andExpect(header(name, "fixture-credential"))
                .andExpect(header("X-Ontomato-Agent-Execution", "fixture-scope"))
                .andExpect(header("Accept-Language", "en"))
                .andExpect(jsonPath("$.framePanelId").value("frame"))
                .andExpect(jsonPath("$.userId").doesNotExist())
                .andRespond(withStatus(HttpStatus.FORBIDDEN).contentType(MediaType.APPLICATION_JSON)
                    .body("{\"error\":{\"code\":\"OBJECT_FORBIDDEN\",\"message\":\"Frame USE denied\"}}"));
            var refusal = assertThrows(ResponseStatusException.class, () ->
                panels.requireUsableRegistration("domain", "frame", List.of(), null, null, null, Locale.ENGLISH));
            assertEquals(HttpStatus.FORBIDDEN, refusal.getStatusCode());
            assertTrue(refusal.getReason().contains("Frame USE denied"));
            server.verify();
            server.reset();
        }
    }

    @Test void anonymousRegistrationAndIconValidationNeedNoUserCredential() {
        request();
        var user = new SimpleUser("admin", "admin", "admin", true, "1");
        when(identity.getCurrentUser()).thenReturn(user);
        when(identity.workbenchSubjectId(user)).thenReturn("system");
        server.expect(requestTo(URL))
            .andExpect(header("X-Ontomato-Application-Registrant", "system"))
            .andExpect(headerDoesNotExist("tk"))
            .andRespond(withNoContent());
        server.expect(requestTo(URL))
            .andExpect(headerDoesNotExist("X-Ontomato-Application-Registrant"))
            .andExpect(jsonPath("$.kind").value("icon"))
            .andExpect(jsonPath("$.icon").value("users"))
            .andRespond(withNoContent());

        panels.requireUsableRegistration("1", "frame", List.of(), null, null, null, null);
        RequestContextHolder.resetRequestAttributes();
        panels.requireCurrent("1", null, List.of(), null, null, "users", null);
        server.verify();
    }

    @Test void aScopedQueryGrantCannotBecomeARegistrationCredential() {
        var request = request();
        request.setAttribute(QueryGrantService.ATTRIBUTE, new Object());
        when(identity.getCurrentUser()).thenReturn(new SimpleUser("user", "login", "Name", true, "domain"));
        var refusal = assertThrows(ResponseStatusException.class, () ->
            panels.requireUsableRegistration("domain", "frame", List.of(), null, null, null, null));
        assertEquals(HttpStatus.FORBIDDEN, refusal.getStatusCode());
        server.verify();
    }

    private MockHttpServletRequest request() {
        var request = new MockHttpServletRequest();
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        return request;
    }
}
