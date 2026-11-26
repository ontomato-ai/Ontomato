package io.ontomato.dataengine.controller;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.OrganizationDirectory;
import io.ontomato.dataengine.service.PermissionPolicyDirectory;
import io.ontomato.dataengine.service.QueryAccessService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class GovernanceDirectoryControllerTest {
    @Test void countRequestsReturnOnlyCountsForTheAuthenticatedDomain() throws Exception {
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("member", "domain"));
        var organization = mock(OrganizationDirectory.class);
        when(organization.countInDomain("domain")).thenReturn(new OrganizationDirectory.Counts(2, 3, 7));
        var policies = mock(PermissionPolicyDirectory.class);
        when(policies.countInDomain("domain")).thenReturn(11L);
        var mvc = MockMvcBuilders.standaloneSetup(new GovernanceDirectoryController(identity, organization, policies))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        String request = """
            {"countOnly":true,"domainId":"other"}""";

        mvc.perform(post("/platform/governance/organization").contentType(MediaType.APPLICATION_JSON).content(request))
            .andExpect(status().isOk()).andExpect(jsonPath("$.units").value(2)).andExpect(jsonPath("$.positions").value(3))
            .andExpect(jsonPath("$.grants").value(7)).andExpect(jsonPath("$.memberships").doesNotExist());
        mvc.perform(post("/platform/governance/policies").contentType(MediaType.APPLICATION_JSON).content(request))
            .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(11)).andExpect(jsonPath("$.policies").doesNotExist());
        verify(organization).countInDomain("domain");
        verify(policies).countInDomain("domain");
        verifyNoMoreInteractions(organization, policies);
    }

    @Test void eachEndpointReadsOnlyItsOwnDirectoryInTheCurrentDomain() throws Exception {
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("member", "domain"));
        var organization = mock(OrganizationDirectory.class);
        when(organization.snapshot("domain")).thenReturn(new OrganizationDirectory.Snapshot(
            List.of(new OrganizationDirectory.Unit("root", "Root", "R", "0")), List.of(), List.of(), List.of(), List.of()));
        var policies = mock(PermissionPolicyDirectory.class);
        when(policies.listPolicies("domain")).thenReturn(List.of(new PermissionPolicyDirectory.Policy("post", "Post", 2, false, "0")));
        when(policies.listRolePolicies("domain")).thenReturn(List.of(new PermissionPolicyDirectory.RolePolicy("role", "post")));
        when(policies.listPolicyDataPermissions("domain")).thenReturn(List.of(new PermissionPolicyDirectory.PolicyDataPermission("post", "Orders")));
        var mvc = MockMvcBuilders.standaloneSetup(new GovernanceDirectoryController(identity, organization, policies))
            .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();

        mvc.perform(post("/platform/governance/organization").contentType(MediaType.APPLICATION_JSON)
            .content("{\"domainId\":\"other\"}")).andExpect(status().isOk()).andExpect(jsonPath("$.units[0].id").value("root"));
        verify(organization).snapshot("domain");
        verifyNoInteractions(policies);
        mvc.perform(post("/platform/governance/policies")).andExpect(status().isOk())
            .andExpect(jsonPath("$.policies[0].id").value("post"));
        verify(policies).listPolicies("domain");
        verifyNoMoreInteractions(policies);
        mvc.perform(post("/platform/governance/role-policies")).andExpect(status().isOk())
            .andExpect(jsonPath("$.rolePolicies[0].roleId").value("role"));
        verify(policies).listRolePolicies("domain");
        verifyNoMoreInteractions(policies);
        mvc.perform(post("/platform/governance/policy-data-permissions")).andExpect(status().isOk())
            .andExpect(jsonPath("$.policyDataPermissions[0].className").value("Orders"));
        verify(policies).listPolicyDataPermissions("domain");
        verifyNoMoreInteractions(organization, policies);
    }
}
