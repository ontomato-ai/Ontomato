package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.ActionTarget;
import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.DataPermissionLookup;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class AuthorizationPoliciesTest {
    private static final String DOMAIN = "d1";
    private static final String POLICY = "p1";

    private final AuthorizationSubjects subjects = mock(AuthorizationSubjects.class);
    private final AuthorizationStore store = mock(AuthorizationStore.class);
    private final ActionDao actions = mock(ActionDao.class);
    private final AdminService admin = mock(AdminService.class);
    private final ManagementOperations operations = new ManagementOperations(List.of(
            new AuthorizationPolicies.Operations(),
            () -> List.of(new ManagementOperations.Operation("mcp.services.list", "List MCP services", ManagementOperations.Access.READ))));
    private final AuthorizationService authorization = new AuthorizationService(
            subjects, store, operations, mock(CapabilityGrantLookup.class), mock(DataPermissionLookup.class));
    private final AuthorizationPolicies policies = new AuthorizationPolicies(store, operations, authorization, actions, admin);

    private SubjectContext adminCtx;
    private SubjectContext readOnlyCtx;

    @BeforeEach
    void setUp() {
        var identity = new VerifiedIdentity(DOMAIN, "admin", CredentialLimit.UNRESTRICTED);
        when(subjects.resolveRoles(DOMAIN, "admin")).thenReturn(
                new RoleResolution(Set.of("admin-role"), Set.of("admin-role"), List.of(), Set.of(), Map.of(), true));
        when(store.policies(DOMAIN, Set.of("admin-role"))).thenReturn(List.of());
        adminCtx = authorization.resolveSubject(identity);

        var viewerIdentity = new VerifiedIdentity(DOMAIN, "viewer", CredentialLimit.UNRESTRICTED);
        when(subjects.resolveRoles(DOMAIN, "viewer")).thenReturn(
                new RoleResolution(Set.of("viewer-role"), Set.of("viewer-role"), List.of(), Set.of(), Map.of(), false));
        when(store.policies(DOMAIN, Set.of("viewer-role"))).thenReturn(
                List.of(new PolicyRef("viewer-role", "mgmt-read", PolicyKind.MANAGEMENT)));
        when(store.managementOperations(DOMAIN, Set.of("mgmt-read"))).thenReturn(Set.of(AuthorizationPolicies.READ));
        readOnlyCtx = authorization.resolveSubject(viewerIdentity);
    }

    @Test
    void listsCatalogAndReplacesManagementOperationsAtomically() {
        assertEquals(
                List.of(AuthorizationPolicies.CHANGE, AuthorizationPolicies.READ, "mcp.services.list"),
                policies.managementCatalog().stream().map(ManagementOperations.Operation::id).toList());

        when(store.managementOperations(DOMAIN, Set.of(POLICY)))
                .thenReturn(Set.of(AuthorizationPolicies.READ, "mcp.services.list"));

        assertEquals(Set.of(AuthorizationPolicies.READ, "mcp.services.list"),
                policies.listManagementOperations(readOnlyCtx, POLICY));

        policies.replaceManagementOperations(adminCtx, POLICY, Set.of(AuthorizationPolicies.READ, AuthorizationPolicies.CHANGE));
        verify(store).revokeManagement(DOMAIN, POLICY, "mcp.services.list");
        verify(store).grantManagement(DOMAIN, POLICY, AuthorizationPolicies.CHANGE);
        verify(store, never()).revokeManagement(DOMAIN, POLICY, AuthorizationPolicies.READ);
        verify(store, never()).grantManagement(DOMAIN, POLICY, AuthorizationPolicies.READ);

        assertThrows(IllegalArgumentException.class,
                () -> policies.replaceManagementOperations(adminCtx, POLICY, Set.of("unknown.op")));

        var forbidden = assertThrows(ResponseStatusException.class,
                () -> policies.replaceManagementOperations(readOnlyCtx, POLICY, Set.of(AuthorizationPolicies.READ)));
        assertEquals(HttpStatus.FORBIDDEN, forbidden.getStatusCode());
    }

    @Test
    void replacesObjectGrantsValidatingActionScopesAndClassLevelCreate() {
        var ticketAction = new Action();
        ticketAction.setId("approve");
        ticketAction.setDomainId(DOMAIN);
        ticketAction.setStatus(Action.STATUS_PUBLISHED);
        ticketAction.setTarget(new ActionTarget("Ticket", "id"));
        when(actions.queryById("approve")).thenReturn(new Object[] { ticketAction });
        when(admin.getJSONRule(DOMAIN)).thenReturn(Map.of("classDef", List.of(
                Map.of("className", "Ticket", "attrs", List.of(Map.of("name", "assignee", "enable", true))))));

        var oldEntry = new ObjectGrant(POLICY, new ObjectTarget(DOMAIN, Kind.ENTRY, "app-a/old"), Verb.ENTER, null);
        var keptAgentUse = new ObjectGrant(POLICY, new ObjectTarget(DOMAIN, Kind.AGENT, "agent-1"), Verb.USE, null);
        when(store.policyObjectGrants(DOMAIN, POLICY)).thenReturn(List.of(oldEntry, keptAgentUse));

        var newEntry = new ObjectGrant(POLICY, new ObjectTarget(DOMAIN, Kind.ENTRY, "app-a/new"), Verb.ENTER, null);
        var agentView = new ObjectGrant(POLICY, new ObjectTarget(DOMAIN, Kind.AGENT, "agent-1"), Verb.VIEW, null);
        var createAgent = new ObjectGrant(POLICY, new ObjectTarget(DOMAIN, Kind.AGENT, ""), Verb.CREATE, null);
        var scopedAction = new ObjectGrant(POLICY, new ObjectTarget(DOMAIN, Kind.ACTION, "approve"), Verb.EXECUTE,
                new GrantScope(GrantScope.Kind.assigned_to_self, "Ticket", "assignee"));

        policies.replaceObjectGrants(adminCtx, POLICY, List.of(keptAgentUse, newEntry, agentView, createAgent, scopedAction));

        verify(store).revokeObject(oldEntry);
        verify(store, never()).revokeObject(keptAgentUse);
        verify(store, never()).grantObject(keptAgentUse);
        verify(store).grantObject(newEntry);
        verify(store).grantObject(agentView);
        verify(store).grantObject(createAgent);
        verify(store).grantObject(scopedAction);
    }

    @Test
    void rejectsCrossDomainGrantsAndInvalidScopes() {
        var crossDomain = new ObjectGrant(POLICY, new ObjectTarget("other", Kind.ENTRY, "app/e1"), Verb.ENTER, null);
        var ex = assertThrows(ResponseStatusException.class,
                () -> policies.replaceObjectGrants(adminCtx, POLICY, List.of(crossDomain)));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatusCode());

        var noTargetAction = new Action();
        noTargetAction.setId("sync");
        noTargetAction.setDomainId(DOMAIN);
        noTargetAction.setStatus(Action.STATUS_PUBLISHED);
        when(actions.queryById("sync")).thenReturn(new Object[] { noTargetAction });
        when(admin.getJSONRule(DOMAIN)).thenReturn(Map.of("classDef", List.of()));

        var badScope = new ObjectGrant(POLICY, new ObjectTarget(DOMAIN, Kind.ACTION, "sync"), Verb.EXECUTE,
                new GrantScope(GrantScope.Kind.assigned_to_self, "Ticket", "assignee"));
        assertThrows(IllegalArgumentException.class,
                () -> policies.replaceObjectGrants(adminCtx, POLICY, List.of(badScope)));
    }

    @Test
    void grantsEntriesAndAcceptedObjectsAtomically() {
        var entry = new ObjectTarget(DOMAIN, Kind.ENTRY, "app-a/approval");
        var panelGrant = new ObjectGrant(POLICY, new ObjectTarget(DOMAIN, Kind.PANEL, "panel-1"), Verb.USE, null);

        policies.grantEntries(adminCtx, POLICY, List.of(entry), List.of(panelGrant));

        verify(store).grantObject(new ObjectGrant(POLICY, entry, Verb.ENTER, null));
        verify(store).grantObject(panelGrant);
    }
}
