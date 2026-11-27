package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationAccessInspector.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.CapabilityGrantLookup.Admission;
import io.ontomato.dataengine.service.CapabilityGrantLookup.Match;
import io.ontomato.dataengine.service.DataPermissionLookup;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class AuthorizationAccessInspectorTest {
    private final AuthorizationSubjects subjects = mock(AuthorizationSubjects.class);
    private final AuthorizationStore store = mock(AuthorizationStore.class);
    private final WorkflowDao workflows = mock(WorkflowDao.class);
    private final ActionDao actions = mock(ActionDao.class);
    private final CapabilityGrantLookup workflowGrants = mock(CapabilityGrantLookup.class);
    private final ManagementOperations operations = new ManagementOperations(List.of(new AuthorizationPolicies.Operations()));
    private final AuthorizationService authorization = new AuthorizationService(subjects, store, operations,
            workflowGrants, mock(DataPermissionLookup.class));
    private final AuthorizationPolicies policies = new AuthorizationPolicies(store, operations, authorization, actions, null);
    private final AuthorizationAccessInspector inspector =
            new AuthorizationAccessInspector(authorization, store, subjects, policies, workflows, workflowGrants, actions);
    private static final ObjectTarget ENTRY = new ObjectTarget("domain", Kind.ENTRY, "app/use");
    private static final ObjectTarget ACTION = new ObjectTarget("domain", Kind.ACTION, "approve");

    @BeforeEach
    void setUp() {
        when(subjects.resolveRoles("domain", "subject")).thenReturn(roles(Set.of("approver", "reviewer", "viewer"), false));
        when(store.policies("domain", Set.of("approver", "reviewer", "viewer"))).thenReturn(List.of(
                new PolicyRef("approver", "shared", PolicyKind.OBJECT),
                new PolicyRef("reviewer", "shared", PolicyKind.OBJECT),
                new PolicyRef("viewer", "shared", PolicyKind.MANAGEMENT)));
    }

    @Test
    void managementReadIsRequiredBeforeReadingSubjectOrCatalogs() {
        var error = assertThrows(ResponseStatusException.class,
                () -> inspector.inspectAccess(caller(false), request(List.of(), null)));
        assertEquals(HttpStatus.FORBIDDEN, error.getStatusCode());
        verify(subjects, never()).resolveRoles("domain", "subject");
        verify(store, never()).objectGrants(any(), any(), any());
        verify(store, never()).policyRoleIds(any(), any());
        verifyNoInteractions(workflows, actions, workflowGrants);
    }

    @Test
    void explainsEntryOwnershipDistributionAndPoliciesUsingInspectedSubject() {
        var panel = new ObjectTarget("domain", Kind.PANEL, "dashboard");
        var draft = new ObjectTarget("domain", Kind.AGENT, "draft");
        var create = new ObjectTarget("domain", Kind.METRIC, "");
        when(subjects.entryEntitlement(ENTRY)).thenReturn(true);
        when(store.objectGrants(ENTRY, Verb.ENTER, Set.of("shared"))).thenReturn(List.of(grant(ENTRY, Verb.ENTER, null)));
        when(subjects.objectEntitlement("subject", panel, Verb.USE)).thenReturn(true);
        when(store.objectGrants(panel, Verb.USE, Set.of("shared"))).thenReturn(List.of(grant(panel, Verb.USE, null)));
        when(store.objectGrants(draft, Verb.VIEW, Set.of("shared"))).thenReturn(List.of(grant(draft, Verb.VIEW, null)));
        when(store.objectGrants(create, Verb.CREATE, Set.of("shared"))).thenReturn(List.of(grant(create, Verb.CREATE, null)));
        when(store.policyRoleIds("domain", "selected")).thenReturn(Set.of("reviewer", "other"));

        var result = inspector.inspectAccess(caller(true), request(List.of(
                new InspectItem(Kind.PANEL, "dashboard", Verb.USE, new OwnerFacts("subject", DefinitionState.PUBLISHED), false),
                new InspectItem(Kind.AGENT, "draft", Verb.VIEW, new OwnerFacts("other", DefinitionState.DRAFT), false),
                new InspectItem(Kind.METRIC, null, Verb.CREATE, null, false),
                new InspectItem(Kind.PROJECTION, "missing-grant", Verb.USE, null, false)), null));

        var policy = Source.policy("shared", List.of("approver", "reviewer"), null);
        assertTrue(result.entry().allowed());
        assertEquals(List.of(Source.distribution("entry_entitlement"), policy), result.entry().sources());
        assertEquals(List.of(Source.ownership("subject"), Source.distribution("object_entitlement"), policy),
                result.items().get(0).sources());
        assertFalse(result.items().get(1).allowed());
        assertEquals("PRIVATE_DRAFT", result.items().get(1).code());
        assertTrue(result.items().get(1).sources().isEmpty());
        assertTrue(result.items().get(2).allowed());
        assertEquals(List.of(policy), result.items().get(2).sources());
        assertFalse(result.items().get(3).allowed());
        assertEquals(Set.of("reviewer", "other"), result.targetPolicyRoleIds());
        assertEquals(Set.of("approver", "reviewer", "viewer"), result.subjectRoleIds());
    }

    @Test
    void onlyOwnerConfirmedFixedProductsUseTheReleaseRule() {
        var id = "builtin-product-dashboard";
        var result = inspector.inspectAccess(caller(true), request(List.of(
                new InspectItem(Kind.PANEL, id, Verb.USE, null, true),
                new InspectItem(Kind.PANEL, id, Verb.USE, null, false),
                new InspectItem(Kind.PANEL, id, Verb.EDIT, null, true)), null));

        assertTrue(result.items().get(0).allowed());
        assertEquals(List.of(Source.distribution("object_entitlement")), result.items().get(0).sources());
        assertFalse(result.items().get(1).allowed());
        assertFalse(result.items().get(2).allowed());
        verify(store).objectGrants(new ObjectTarget("domain", Kind.PANEL, id), Verb.USE, Set.of("shared"));
        verify(store, never()).objectGrants(new ObjectTarget("domain", Kind.PANEL, id), Verb.EDIT, Set.of("shared"));
    }

    @Test
    void combinesEffectiveScopesAndChecksEachTargetAgainstItsClassAndValues() {
        var action = action("domain", Action.STATUS_PUBLISHED);
        when(actions.queryById("approve")).thenReturn(new Object[]{action, null});
        var self = new GrantScope(GrantScope.Kind.assigned_to_self, "Order", "assignee");
        var noRoots = new GrantScope(GrantScope.Kind.self_subtree, "Order", "team");
        when(store.objectGrants(ACTION, Verb.EXECUTE, Set.of("shared")))
                .thenReturn(List.of(grant(ACTION, Verb.EXECUTE, self), grant(ACTION, Verb.EXECUTE, noRoots)));
        var stepScope = new Match("Order", "initiator", List.of("workflow-user"));
        when(workflows.queryList(Workflow.STATUS_ACTIVE, "domain")).thenReturn(List.of(
                workflow("live", 3, step(1, "approve"), step(2, "approve"), step(3, "other"), null),
                workflow("unversioned", null, step(1, "approve"))));
        when(workflowGrants.stepAdmissions("subject", "domain", "live", 3))
                .thenReturn(Map.of(2, new Admission(false, List.of(stepScope)), 3, Admission.ALL));

        var summary = inspectAction(null);
        assertTrue(summary.allowed());
        assertEquals(Set.of(self, new GrantScope(GrantScope.Kind.initiated_by_self, "Order", "initiator")),
                Set.copyOf(summary.effectiveScopes()));
        assertEquals(List.of(Source.policy("shared", List.of("approver", "reviewer"), self),
                Source.workflowStep(new WorkflowStepAction("approve", "live", "Review", 3, 2, "Approval"))),
                summary.sources());

        var checked = inspectAction(List.of(
                target("1", "Order", Map.of("assignee", "subject")),
                target("2", "Order", Map.of("initiator", List.of("other", "workflow-user"))),
                target("3", "Order", Map.of("assignee", "other")),
                target("4", "OtherClass", Map.of("assignee", "subject")),
                target("5", "Order", Map.of("assignee", "other", "initiator", "other"))));
        assertTrue(checked.allowed());
        assertNull(checked.effectiveScopes());
        assertEquals(List.of(true, true, false, false, false),
                checked.targetDecisions().stream().map(ActionTargetResult::allowed).toList());
        assertEquals("ACTION_SCOPE_UNVERIFIABLE", checked.targetDecisions().get(2).code());
        assertEquals("ACTION_TARGET_OUT_OF_SCOPE", checked.targetDecisions().get(3).code());
        assertEquals("ACTION_TARGET_OUT_OF_SCOPE", checked.targetDecisions().get(4).code());
    }

    @Test
    void admitsWorkflowOnlyAndDistributionOnlyWhileKeepingSourcesSeparate() {
        when(actions.queryById("approve")).thenReturn(new Object[]{
                action("domain", Action.STATUS_PUBLISHED), null});
        when(workflows.queryList(Workflow.STATUS_ACTIVE, "domain")).thenReturn(List.of(workflow("live", 2, step(1, "approve"))));
        when(workflowGrants.stepAdmissions("subject", "domain", "live", 2)).thenReturn(Map.of(1, Admission.ALL));
        var target = List.of(target("1", "Order", null));
        var workflow = inspectAction(target);
        assertTrue(workflow.targetDecisions().getFirst().allowed());
        assertEquals(List.of("workflow_step"), workflow.sources().stream().map(Source::type).toList());

        when(workflowGrants.stepAdmissions("subject", "domain", "live", 2)).thenReturn(Map.of());
        when(subjects.unrestrictedStandaloneActions()).thenReturn(true);
        var distribution = inspectAction(target);
        assertTrue(distribution.targetDecisions().getFirst().allowed());
        assertEquals(List.of(Source.distribution("unrestricted_standalone_actions")), distribution.sources());
    }

    @Test
    void aWorkflowGrantCannotExposeAnotherAuthorsDraftOrAnotherDomainsAction() {
        when(workflows.queryList(Workflow.STATUS_ACTIVE, "domain")).thenReturn(List.of(workflow("live", 1, step(1, "approve"))));
        when(workflowGrants.stepAdmissions("subject", "domain", "live", 1)).thenReturn(Map.of(1, Admission.ALL));
        when(actions.queryById("approve")).thenReturn(new Object[]{
                action("domain", Action.STATUS_PENDING_REVIEW), null});
        var draft = inspectAction(null);
        assertFalse(draft.allowed());
        assertEquals("PRIVATE_DRAFT", draft.code());
        assertTrue(draft.sources().isEmpty());

        when(actions.queryById("approve")).thenReturn(new Object[]{
                action("other", Action.STATUS_PUBLISHED), null});
        var foreign = inspectAction(null);
        assertFalse(foreign.allowed());
        assertTrue(foreign.sources().isEmpty());
        verifyNoInteractions(workflowGrants);
    }

    private ItemResult inspectAction(List<ActionTargetInput> targets) {
        return inspector.inspectAccess(caller(true), request(
                List.of(new InspectItem(Kind.ACTION, "approve", Verb.EXECUTE,
                        new OwnerFacts("subject", DefinitionState.PUBLISHED), false)), targets)).items().getFirst();
    }

    private static InspectRequest request(List<InspectItem> items, List<ActionTargetInput> targets) {
        return new InspectRequest("subject", "app/use", "selected", items, targets);
    }

    private static SubjectContext caller(boolean admin) {
        return new SubjectContext(new VerifiedIdentity("domain", "caller", CredentialLimit.UNRESTRICTED),
                roles(Set.of(), admin), Map.of(), Set.of(), Set.of());
    }

    private static RoleResolution roles(Set<String> ids, boolean admin) {
        return new RoleResolution(ids, ids, List.of(), Set.of(), Map.of(), admin);
    }

    private static ObjectGrant grant(ObjectTarget target, Verb verb, GrantScope scope) {
        return new ObjectGrant("shared", target, verb, scope);
    }

    private static ActionTargetInput target(String id, String kind, Map<String, Object> fields) {
        return new ActionTargetInput("approve", kind, id, fields);
    }

    private static Action action(String domain, String status) {
        var action = new Action();
        action.setId("approve");
        action.setDomainId(domain);
        action.setStatus(status);
        action.setCreatedBy("other");
        return action;
    }

    private static Workflow workflow(String id, Integer version, WorkflowStep... steps) {
        var workflow = new Workflow();
        workflow.setId(id);
        workflow.setName("Review");
        workflow.setVersion(version);
        workflow.setSteps(Arrays.asList(steps));
        return workflow;
    }

    private static WorkflowStep step(int no, String actionId) {
        var step = new WorkflowStep();
        step.setStepNo(no);
        step.setActionId(actionId);
        step.setName("Approval");
        step.setScope(GrantScope.Kind.initiated_by_self);
        return step;
    }
}
