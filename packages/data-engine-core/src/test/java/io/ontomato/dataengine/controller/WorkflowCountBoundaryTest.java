package io.ontomato.dataengine.controller;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.CapabilityGrantQuery;
import io.ontomato.dataengine.service.PlatformAccessQuery;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.WorkflowService;
import io.ontomato.dataengine.util.SystemUtils;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class WorkflowCountBoundaryTest {
    private final WorkflowService workflows = mock(WorkflowService.class);
    private final SubjectDirectory subjects = mock(SubjectDirectory.class);
    private final PlatformAccessQuery access = mock(PlatformAccessQuery.class);
    private final CapabilityGrantQuery grants = mock(CapabilityGrantQuery.class);
    private final ActionService actions = mock(ActionService.class);
    private final WorkflowDao workflowDao = mock(WorkflowDao.class);
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(controller())
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();

    @Test
    void countRequestsUseTheCurrentDomainAndDoNotReadDefinitionsOrDirectories() throws Exception {
        when(workflows.count("wf", "ACTIVE", "domain")).thenReturn(1L);
        when(subjects.countInDomain("domain")).thenReturn(4L);
        when(access.countRolesInDomain("domain")).thenReturn(5L);
        when(grants.countRolesInDomain("domain")).thenReturn(new CapabilityGrantQuery.RoleCounts(3, 2));

        try (var system = mockStatic(SystemUtils.class)) {
            system.when(SystemUtils::getCurUser).thenReturn(new QueryAccessService.GrantUser("member", "domain"));
            count("/workflow/query", """
                {"countOnly":true,"id":"wf","status":" ACTIVE ","purpose":"execution","domainId":"other"}""", 1);
            String request = """
                {"countOnly":true,"domainId":"other"}""";
            count("/workflow/subjects", request, 4);
            count("/workflow/platform-access", request, 5);
            count("/workflow/grants", request, 3).andExpect(jsonPath("$.data.outsideDirectory").value(2));
        }

        verify(workflows).count("wf", "ACTIVE", "domain");
        verify(subjects).countInDomain("domain");
        verify(access).countRolesInDomain("domain");
        verify(grants).countRolesInDomain("domain");
        verifyNoMoreInteractions(workflows, subjects, access, grants);
        verifyNoInteractions(actions, workflowDao);
    }

    private ResultActions count(String path, String request, int total) throws Exception {
        return mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(request))
            .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true))
            .andExpect(jsonPath("$.data.total").value(total));
    }

    private WorkflowController controller() {
        var controller = new WorkflowController();
        ReflectionTestUtils.setField(controller, "workflowService", workflows);
        ReflectionTestUtils.setField(controller, "subjects", subjects);
        ReflectionTestUtils.setField(controller, "platformAccess", access);
        ReflectionTestUtils.setField(controller, "grants", grants);
        ReflectionTestUtils.setField(controller, "actions", actions);
        ReflectionTestUtils.setField(controller, "workflowDao", workflowDao);
        return controller;
    }
}
