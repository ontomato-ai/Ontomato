package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowDirectoryEntry;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.CapabilityGrantQuery;
import io.ontomato.dataengine.service.PlatformAccessQuery;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.WorkflowService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.util.SystemUtils;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;

class WorkflowCountBoundaryTest {
    private final WorkflowService workflows = mock(WorkflowService.class);
    private final SubjectDirectory subjects = mock(SubjectDirectory.class);
    private final PlatformAccessQuery access = mock(PlatformAccessQuery.class);
    private final CapabilityGrantQuery grants = mock(CapabilityGrantQuery.class);
    private final ActionService actions = mock(ActionService.class);
    private final WorkflowDao workflowDao = mock(WorkflowDao.class);
    private final ManagementRequestAccess management = mock(ManagementRequestAccess.class);
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(controller())
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();

    @Test
    void countRequestsUseTheCurrentDomainAndDoNotReadDefinitionsOrDirectories() throws Exception {
        when(workflows.count("wf", "ACTIVE", "domain")).thenReturn(1L);
        when(subjects.countInDomain("domain")).thenReturn(4L);
        when(access.countRolesInDomain("domain")).thenReturn(5L);
        when(grants.countRolesInDomain("domain")).thenReturn(new CapabilityGrantQuery.RoleCounts(3, 2));
        var user = new QueryAccessService.GrantUser("member", "domain");
        when(management.require("workflow.grants.read")).thenReturn(user);

        try (var system = mockStatic(SystemUtils.class)) {
            system.when(SystemUtils::getCurUser).thenReturn(user);
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
        var grantRead = inOrder(management, grants);
        grantRead.verify(management).require("workflow.grants.read");
        grantRead.verify(grants).countRolesInDomain("domain");
        verifyNoMoreInteractions(workflows, subjects, access, grants);
        verifyNoInteractions(actions, workflowDao);
    }

    @Test
    void instanceDirectoryUsesTheVerifiedDomainWithoutReadingActionsOrGrantDetails() {
        var workflow = new Workflow();
        workflow.setId("wf-7");
        workflow.setName("Approval");
        workflow.setStatus("ACTIVE");
        workflow.setVersion(7);
        when(workflows.queryList(null, "domain")).thenReturn(List.of(workflow));
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());

        assertEquals(List.of(Map.of("id", "wf-7", "name", "Approval", "status", "ACTIVE", "version", 7)),
                controller().workflowInstanceDirectory().handler().read(subject, Map.of("domainId", "outside")));
        verifyNoInteractions(actions, subjects, grants, workflowDao);
    }

    @Test
    void stepNeighborGrantsAndWorkflowCenterKeepSeparateOwnerAdmission() {
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        var controller = controller();
        var params = Map.<String, Object>of("className", "platform:Role", "primaryKey", "role-1",
                "from", "platform:Role", "to", "platform:Workflow", "direction", "outgoing", "domainId", "outside");
        var edge = controller.ontologyWorkflowStepLinks().handler();
        var center = controller.ontologyWorkflowCenter().handler();
        var workflow = new WorkflowDirectoryEntry("wf-1", "Approval", "ACTIVE", 3);
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, WorkflowController.READ);
        assertThrows(ResponseStatusException.class, () -> edge.read(subject, params));
        verifyNoInteractions(grants, workflows);
        when(workflows.directoryEntries("domain", Set.of("wf-1"))).thenReturn(List.of(workflow));
        assertEquals(List.of(workflow), center.read(subject, Map.of("primaryKey", "wf-1", "domainId", "outside")));
        verify(workflows).directoryEntries("domain", Set.of("wf-1"));

        clearInvocations(management, workflows);
        doNothing().when(management).require(subject, WorkflowController.READ);
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).when(management).require(subject, GovernanceDirectoryController.ROLES_READ);
        var step = new CapabilityGrantQuery.WorkflowStepLink("role-1", null, "wf-1", 2, "3", GrantScope.ALL);
        var outgoing = new CapabilityGrantQuery.WorkflowStepLinks(List.of(step), List.of(workflow));
        var incoming = new CapabilityGrantQuery.WorkflowStepLinks(List.of(step), List.of());
        when(grants.workflowStepLinks("domain", "role-1", true)).thenReturn(outgoing);
        when(grants.workflowStepLinks("domain", "wf-1", false)).thenReturn(incoming);
        assertEquals(outgoing, edge.read(subject, params));
        verify(management).require(subject, WorkflowController.READ);
        verify(grants).workflowStepLinks("domain", "role-1", true);
        verifyNoMoreInteractions(management, grants);
        assertEquals(incoming, edge.read(subject, Map.of("className", "platform:Workflow", "primaryKey", "wf-1",
                "from", "platform:Role", "to", "platform:Workflow", "direction", "incoming")));
        verifyNoInteractions(workflows, access, actions, subjects);
    }

    @Test
    void memberInstanceDirectoryRequiresMembersReadAndUsesTheVerifiedDomain() {
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        var read = controller().userInstanceDirectory();
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN)).doNothing()
                .when(management).require(subject, GovernanceDirectoryController.MEMBERS_READ);

        assertThrows(ResponseStatusException.class, () -> read.handler().read(subject, Map.of()));
        verifyNoInteractions(subjects);
        var member = new SubjectDirectory.MemberIdentity("m", "member", "Member");
        when(subjects.memberIdentitiesInDomain("domain")).thenReturn(List.of(member));
        assertEquals(List.of(member), read.handler().read(subject, Map.of("domainId", "outside")));
        verify(subjects).memberIdentitiesInDomain("domain");
        verifyNoMoreInteractions(subjects);
    }

    @Test
    void workflowInstanceProvenanceUsesTheLatestActivationPrincipalInTheVerifiedDomain() {
        var workflow = new Workflow();
        workflow.setId("wf-7");
        workflow.setName("Approval");
        workflow.setCreatedBy("creator");
        when(workflows.queryList(null, "domain")).thenReturn(List.of(workflow));
        when(workflowDao.queryLastEventPrincipal("wf-7", Workflow.EVENT_ACTIVATED)).thenReturn("reviewer");
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());

        assertEquals(List.of(new WorkflowController.WorkflowProvenance("Approval", "creator", "reviewer")),
                controller().workflowInstanceProvenance().handler().read(subject, Map.of("domainId", "outside")));
        verifyNoInteractions(actions, subjects, grants, management);
    }

    @Test
    void roleInstanceFactsReadNamesUnderTheirOwnPermissionsAndKeepHistoricalGrantRoles() {
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        when(access.rolesInDomain("domain"))
                .thenReturn(List.of(new PlatformAccessQuery.RoleAccess("current-role", "Reviewer", Set.of("unused"), true, true)));
        when(grants.grantsInDomain("domain")).thenReturn(List.of(
                new CapabilityGrantQuery.Grant("deleted-role", null, "ACTION", "action", null,
                        "workflow", "1", 1, null, false)));
        var controller = controller();
        var parameters = Map.<String, Object>of("domainId", "outside");

        assertEquals(List.of(new WorkflowController.RoleDirectoryEntry("current-role", "Reviewer")),
                controller.roleInstanceDirectory().handler().read(subject, parameters));
        assertEquals(List.of(new WorkflowController.RoleDirectoryEntry("deleted-role", null)),
                controller.roleInstanceGrantRoles().handler().read(subject, parameters));

        var order = inOrder(management, access, grants);
        order.verify(management).require(subject, GovernanceDirectoryController.ROLES_READ);
        order.verify(access).rolesInDomain("domain");
        order.verify(management).require(subject, WorkflowController.READ);
        order.verify(grants).grantsInDomain("domain");
        verifyNoMoreInteractions(access, grants);
    }

    @Test
    void refusedRoleSourceDoesNotReadTheOwnerDirectory() {
        var subject = new SubjectContext(new VerifiedIdentity("domain", "member", CredentialLimit.UNRESTRICTED),
                null, Map.of(), Set.of(), Set.of());
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN))
                .when(management).require(subject, GovernanceDirectoryController.ROLES_READ);
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN))
                .when(management).require(subject, WorkflowController.READ);
        var controller = controller();

        assertThrows(ResponseStatusException.class,
                () -> controller.roleInstanceDirectory().handler().read(subject, Map.of()));
        assertThrows(ResponseStatusException.class,
                () -> controller.roleInstanceGrantRoles().handler().read(subject, Map.of()));
        verifyNoInteractions(access, grants);
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
        ReflectionTestUtils.setField(controller, "management", management);
        return controller;
    }
}
