package io.ontomato.dataengine.service.authorization;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.config.BaseControllerAdvice;
import io.ontomato.dataengine.controller.WorkbenchManagementController;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.PolicyKind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.PolicyRef;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.RoleResolution;
import io.ontomato.dataengine.service.sys.bean.UserDetail;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class WorkbenchManagementControllerTest {
    private static final String SERVICE_TOKEN = "test-workbench-credential";
    private final IdentityService identity = mock(IdentityService.class);
    private MockMvc mvc;

    @BeforeEach
    void createBoundary() throws Exception {
        var subjects = mock(AuthorizationSubjects.class);
        var policies = mock(AuthorizationStore.class);
        var mapper = new ObjectMapper();
        var operations = new ManagementOperations(List.of(new WorkbenchManagementOperations(mapper)));
        when(subjects.resolveRoles("domain-a", "canonical-user-a")).thenReturn(
            new RoleResolution(Set.of("reader"), Set.of("reader"), List.of(), Set.of(), Map.of(), false, false));
        when(policies.policies("domain-a", Set.of("reader"))).thenReturn(
            List.of(new PolicyRef("reader", "mcp-reader", PolicyKind.MANAGEMENT)));
        when(policies.managementOperations("domain-a", Set.of("mcp-reader"))).thenReturn(Set.of("mcp.services.read"));
        var authorization = new AuthorizationService(subjects, policies, operations, null, null);
        var controller = new WorkbenchManagementController(new WorkbenchServiceAuthentication(SERVICE_TOKEN),
            operations, new ManagementRequestAccess(identity, authorization, operations));
        mvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new BaseControllerAdvice())
            .setMessageConverters(new MappingJackson2HttpMessageConverter(mapper))
            .build();
    }

    @Test
    void requiresBothServiceAndUserAndChecksTheExactOperation() throws Exception {
        mvc.perform(request("\"mcp.services.read\"", "domain-a").header(WorkbenchServiceAuthentication.HEADER, SERVICE_TOKEN))
            .andExpect(status().isUnauthorized());
        signIn();
        mvc.perform(request("\"mcp.services.read\"", "domain-a")).andExpect(status().isForbidden());
        mvc.perform(trusted("\"mcp.services.read\"", "domain-a")).andExpect(status().isNoContent());
        mvc.perform(trusted("\"mcp.services.change\"", "domain-a")).andExpect(status().isForbidden());
        mvc.perform(trusted("\"mcp.services.read\"", "domain-b")).andExpect(status().isForbidden());
        mvc.perform(trusted("\"mcp.services.read\"", "domain-a").requestAttr(QueryGrantService.ATTRIBUTE, true))
            .andExpect(status().isForbidden());
    }

    @Test
    void rejectsUnknownAndMalformedOperationValues() throws Exception {
        signIn();
        for (String operation : List.of("19", "\"19\"", "{}", "[]", "null", "\"\"")) {
            mvc.perform(trusted(operation, "domain-a")).andExpect(status().isBadRequest());
        }
    }

    private void signIn() {
        var user = new UserDetail();
        user.setEnable(true);
        user.setId("user-a");
        user.setDomainId("domain-a");
        when(identity.getCurrentUser()).thenReturn(user);
        when(identity.workbenchSubjectId(user)).thenReturn("canonical-user-a");
    }

    private static MockHttpServletRequestBuilder request(String operation, String domain) {
        return post(WorkbenchManagementController.PATH).contentType(MediaType.APPLICATION_JSON)
            .content("{\"operationId\":" + operation + ",\"domainId\":\"" + domain + "\"}");
    }

    private static MockHttpServletRequestBuilder trusted(String operation, String domain) {
        return request(operation, domain).header(WorkbenchServiceAuthentication.HEADER, SERVICE_TOKEN);
    }
}
