package io.ontomato.dataengine.controller;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.service.DomainSvc;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class InternalDomainControllerTest {
    @Test
    void domainIdsAreOnlyExposedToTheWorkbenchService() throws Exception {
        var domains = mock(DomainSvc.class);
        var controller = new InternalDomainController(domains, new WorkbenchServiceAuthentication("fixture"));
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();

        mvc.perform(get(InternalDomainController.IDS_PATH)).andExpect(status().isForbidden());
        verifyNoInteractions(domains);

        when(domains.listDomainIds()).thenReturn(List.of("domain-a", "domain-b"));
        mvc.perform(get(InternalDomainController.IDS_PATH).header(WorkbenchServiceAuthentication.HEADER, "fixture"))
                .andExpect(status().isOk())
                .andExpect(content().json("[\"domain-a\",\"domain-b\"]"));
    }
}
