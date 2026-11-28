package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static io.ontomato.dataengine.service.WorkbenchServiceAuthentication.HEADER;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.PresetAgentPolicies;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class PublishedAgentPresetsControllerTest {
    @Test
    void existingRpcBodySeedsMemberUseAndDelegatesAdministratorPolicies() throws Exception {
        String id = UUID.randomUUID().toString();
        var store = mock(AuthorizationStore.class);
        var roles = mock(PresetAgentPolicies.RolePolicies.class);
        when(store.domainPolicy("domain")).thenReturn(new PolicyRef("members", "default", PolicyKind.OBJECT));
        var mvc = MockMvcBuilders.standaloneSetup(new PublishedAgentPresetsController(
                new PresetAgentPolicies(store, roles), new WorkbenchServiceAuthentication("service")))
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        String body = """
                {"domainId":"domain", "ids":["%s"]}
                """.formatted(id);
        mvc.perform(post(PublishedAgentPresetsController.PATH).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        verifyNoInteractions(store, roles);

        mvc.perform(post(PublishedAgentPresetsController.PATH).header(HEADER, "service")
                .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isNoContent());

        verify(store).domainPolicy("domain");
        verify(store).grantObject(new ObjectGrant("default", new ObjectTarget("domain", Kind.AGENT, id), Verb.USE, null));
        verifyNoMoreInteractions(store);
        verify(roles).initialize("domain", List.of(id), true);
    }
}
