package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.ExecutionTarget;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AuthorizationServiceTest {
    private final AuthorizationSubjects subjects = mock(AuthorizationSubjects.class);
    private final AuthorizationStore store = mock(AuthorizationStore.class);
    private final CapabilityGrantLookup workflow = mock(CapabilityGrantLookup.class);
    private final AuthorizationService authorization = new AuthorizationService(subjects, store,
            new ManagementOperations(List.of(new AuthorizationPolicies.Operations())), workflow, mock(DataPermissionLookup.class));
    private final ObjectTarget action = new ObjectTarget("domain", Kind.ACTION, "approve");
    private final OwnerFacts published = new OwnerFacts("someone-else", DefinitionState.PUBLISHED);

    @BeforeEach
    void roles() {
        when(subjects.resolveRoles("domain", "user")).thenReturn(
                new RoleResolution(Set.of("role"), Set.of("role"), List.of(), Set.of(), Map.of(), true));
        when(store.policies("domain", Set.of("role"))).thenReturn(List.of(new PolicyRef("role", "policy", PolicyKind.OBJECT)));
    }

    @Test
    void authorsCanEditAndTestButNeedAnExplicitLiveGrant() {
        var ctx = authorization.resolveSubject(new VerifiedIdentity("domain", "user", CredentialLimit.UNRESTRICTED));
        var author = new OwnerFacts("original-author", DefinitionState.PUBLISHED, List.of("user"));
        assertTrue(authorization.decide(ctx, new ObjectAccess(action, Verb.EDIT, author)).allowed());
        assertFalse(authorization.decideAction(ctx, new Action(action, new Standalone(), ExecutionTarget.LIVE, author)).decision().allowed());
        var sandbox = new ExecutionTarget("context", "sandbox", List.of("Ticket"), 1000L);
        assertTrue(authorization.decideAction(ctx, new Action(action, new Standalone(), sandbox, author)).decision().allowed());
        var restricted = authorization.resolveSubject(new VerifiedIdentity("domain", "user", request -> !(request instanceof Action)));
        assertFalse(authorization.decideAction(restricted, new Action(action, new Standalone(), sandbox, author)).decision().allowed());
    }

    @Test
    void policiesDoNotOpenAnotherAuthorsDraftOrMakeTheUserAWorkflowActor() {
        var ctx = authorization.resolveSubject(new VerifiedIdentity("domain", "user", CredentialLimit.UNRESTRICTED));
        var scope = new GrantScope(GrantScope.Kind.assigned_to_self, "Ticket", "assignee");
        when(store.objectGrants(action, Verb.EXECUTE, Set.of("policy")))
                .thenReturn(List.of(new ObjectGrant("policy", action, Verb.EXECUTE, scope)));

        var standalone = authorization.decideAction(ctx, new Action(action, new Standalone(), ExecutionTarget.LIVE, published));
        assertTrue(standalone.decision().allowed());
        assertEquals(List.of(new CapabilityGrantLookup.Match("Ticket", "assignee", List.of("user"))),
                standalone.admission().matches());
        var draft = new OwnerFacts("someone-else", DefinitionState.DRAFT);
        assertFalse(authorization.decideAction(ctx, new Action(action, new Standalone(), ExecutionTarget.LIVE, draft)).decision().allowed());

        when(workflow.stepAdmissions("user", "domain", "review", 2)).thenReturn(Map.of());
        assertFalse(authorization.decideAction(ctx,
                new Action(action, new WorkflowStep("review", 2, 1), ExecutionTarget.LIVE, published)).decision().allowed());
    }
}
