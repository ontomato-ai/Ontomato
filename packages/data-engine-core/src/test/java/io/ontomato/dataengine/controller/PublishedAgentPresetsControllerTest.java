package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static io.ontomato.dataengine.service.WorkbenchServiceAuthentication.HEADER;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.ProductGrants.Grant;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.PresetAgentPolicies;
import io.ontomato.dataengine.service.authorization.PresetAgentPolicies.AgentGrant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PublishedAgentPresetsControllerTest {
    @Test
    void servicePublishesFreshDefaultsAndCopiesOnlyRecordedLegacyAudiences() throws Exception {
        String fresh = UUID.randomUUID().toString();
        String shared = UUID.randomUUID().toString();
        String withdrawn = UUID.randomUUID().toString();
        String unknown = UUID.randomUUID().toString();
        var store = mock(AuthorizationStore.class);
        var legacy = mock(ProductGrantService.class);
        var roles = mock(PresetAgentPolicies.RolePolicies.class);
        when(store.domainPolicy("domain")).thenReturn(new PolicyRef("members", "default", PolicyKind.OBJECT));
        when(legacy.legacyPresetGrants("domain", shared)).thenReturn(List.of(
                new Grant("domain", "*", "use"), new Grant("role", "editors", "edit")));
        when(legacy.legacyPresetGrants("domain", withdrawn)).thenReturn(List.of(
                new Grant("role", "editors", "view"), new Grant("principal", "author", "edit")));
        var mvc = MockMvcBuilders.standaloneSetup(new PublishedAgentPresetsController(
                new PresetAgentPolicies(store, legacy, roles), new WorkbenchServiceAuthentication("service")))
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        String body = """
                {"domainId":"domain", "ids":["%s","%s","%s","%s"], "createdIds":["%s"]}
                """.formatted(fresh, shared, withdrawn, unknown, fresh);
        mvc.perform(post(PublishedAgentPresetsController.PATH).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        verifyNoInteractions(store, legacy, roles);

        mvc.perform(post(PublishedAgentPresetsController.PATH).header(HEADER, "service")
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isNoContent());

        verify(store).domainPolicy("domain");
        verify(store).grantObject(new ObjectGrant("default", new ObjectTarget("domain", Kind.AGENT, fresh), Verb.USE, null));
        verify(store).grantObject(new ObjectGrant("default", new ObjectTarget("domain", Kind.AGENT, shared), Verb.USE, null));
        verifyNoMoreInteractions(store);
        verify(roles).initialize("domain", PresetAgentPolicies.Source.WORKBENCH, List.of(fresh),
                Map.of("editors", List.of(new AgentGrant(shared, Verb.EDIT), new AgentGrant(withdrawn, Verb.VIEW))));
        verify(legacy, never()).legacyPresetGrants("domain", fresh);
    }
}
