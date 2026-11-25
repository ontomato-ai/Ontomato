package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class BuildTestWorkspaceCleanupTest {
    @Test
    void closesOnlyTheSuppliedDomainAndWorkspaceThroughServiceAuthentication() throws Exception {
        var service = mock(DataSandboxService.class);
        var auth = new WorkbenchServiceAuthentication("workbench-test-key");
        var mvc = MockMvcBuilders.standaloneSetup(new BuildTestController(service, auth)).build();
        var id = "11111111-1111-4111-8111-111111111111";
        var path = "/ontology/build-tests/internal/workspaces/" + id;

        mvc.perform(delete(path).param("domainId", "school")).andExpect(status().isForbidden());
        verifyNoInteractions(service);

        mvc.perform(delete(path).param("domainId", "school")
                .header(WorkbenchServiceAuthentication.HEADER, "workbench-test-key"))
            .andExpect(status().isNoContent());
        verify(service).closeWorkspace("school", id);
    }
}
