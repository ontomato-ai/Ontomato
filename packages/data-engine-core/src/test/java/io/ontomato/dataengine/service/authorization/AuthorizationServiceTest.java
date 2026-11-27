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
    void draftAuthorshipComparesTheJavaUserIdNotThePlacementPrincipal() {
        var placement = authorization.resolveSubject(new VerifiedIdentity("domain", "user", CredentialLimit.UNRESTRICTED))
                .withJavaUserId("java-user");
        var own = new OwnerFacts("java-user", DefinitionState.DRAFT);
        assertTrue(authorization.decide(placement, new ObjectAccess(action, Verb.EDIT, own)).allowed());
        var placementOwned = new OwnerFacts("user", DefinitionState.DRAFT);
        var denied = authorization.decide(placement, new ObjectAccess(action, Verb.EDIT, placementOwned));
        assertFalse(denied.allowed());
        assertEquals("PRIVATE_DRAFT", denied.code());
    }

    @Test
    void managementReadsAndChangesAreIndependentAndDomainAdminsUseTheCatalog() {
        var actor = new VerifiedIdentity("domain", "user", CredentialLimit.UNRESTRICTED);
        var admin = authorization.resolveSubject(actor);
        assertTrue(authorization.decide(admin, new Management(AuthorizationPolicies.READ)).allowed());
        assertTrue(authorization.decide(admin, new Management(AuthorizationPolicies.CHANGE)).allowed());

        when(subjects.resolveRoles("domain", "user")).thenReturn(
                new RoleResolution(Set.of("role"), Set.of("role"), List.of(), Set.of(), Map.of(), false));
        when(store.policies("domain", Set.of("role"))).thenReturn(
                List.of(new PolicyRef("role", "operations", PolicyKind.MANAGEMENT)));
        when(store.managementOperations("domain", Set.of("operations"))).thenReturn(Set.of(AuthorizationPolicies.READ));

        var reader = authorization.resolveSubject(actor);
        assertTrue(authorization.decide(reader, new Management(AuthorizationPolicies.READ)).allowed());
        assertFalse(authorization.decide(reader, new Management(AuthorizationPolicies.CHANGE)).allowed());
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
                new Action(action, new WorkflowStep("review", 2, 1, "run", null, null), ExecutionTarget.LIVE, published)).decision().allowed());
    }

    @Test
    void scopeAlternativesKeepEachGrantPairedWithTheRootsOfItsMatchingRole() {
        var roles = Set.of("direct", "assigned", "without-root");
        when(subjects.resolveRoles("domain", "user")).thenReturn(new RoleResolution(
                roles, Set.of("direct"), List.of(), Set.of("membership"),
                Map.of("assigned", Set.of("position"), "direct", Set.of("organization-grant")), false));
        when(store.policies("domain", roles)).thenReturn(roles.stream()
                .map(role -> new PolicyRef(role, "policy", PolicyKind.OBJECT)).toList());
        when(subjects.organizationCodes("domain", Set.of("membership", "organization-grant"), GrantScope.Kind.self_descendants))
                .thenReturn(List.of("under-direct"));
        when(subjects.organizationCodes("domain", Set.of("position"), GrantScope.Kind.self_descendants))
                .thenReturn(List.of("under-position"));
        when(store.objectGrants(action, Verb.EXECUTE, Set.of("policy"))).thenReturn(List.of(
                new ObjectGrant("policy", action, Verb.EXECUTE,
                        new GrantScope(GrantScope.Kind.self_descendants, "Ticket", "organization")),
                new ObjectGrant("policy", action, Verb.EXECUTE,
                        new GrantScope(GrantScope.Kind.assigned_to_self, "Other", "assignee"))));

        var ctx = authorization.resolveSubject(new VerifiedIdentity("domain", "user", CredentialLimit.UNRESTRICTED));
        var admission = authorization.decideAction(ctx,
                new Action(action, new Standalone(), ExecutionTarget.LIVE, published)).admission();
        assertEquals(Set.of(
                new CapabilityGrantLookup.Match("Ticket", "organization", List.of("under-direct")),
                new CapabilityGrantLookup.Match("Ticket", "organization", List.of("under-position")),
                new CapabilityGrantLookup.Match("Other", "assignee", List.of("user"))), Set.copyOf(admission.matches()));
        var condition = admission.restrict("Ticket", com.alibaba.fastjson2.JSONObject.of("field", "id", "operator", "=", "value", "T1"));
        assertTrue(condition.toJSONString().contains("under-direct"));
        assertTrue(condition.toJSONString().contains("under-position"));
        assertFalse(condition.toJSONString().contains("assignee"));
        verify(subjects, never()).organizationCodes(eq("domain"), eq(Set.of()), any());
    }

    @Test
    void publishedRangesKeepEditionFactsAndTheSameVerbSpecificAuthorAndPolicyAdmission() {
        var ctx = authorization.resolveSubject(new VerifiedIdentity("domain", "user", CredentialLimit.UNRESTRICTED));
        var use = new ObjectTarget("domain", Kind.PROJECTION, "use");
        var edit = new ObjectTarget("domain", Kind.PROJECTION, "edit");
        var author = new OwnerFacts("user", DefinitionState.PUBLISHED);
        var verbs = Set.of(Verb.USE, Verb.EDIT);
        when(store.objectKeysByVerb("domain", Kind.PROJECTION, verbs, Set.of("policy")))
                .thenReturn(Map.of(Verb.USE, Set.of(use.id()), Verb.EDIT, Set.of(edit.id())));
        when(store.objectGrants(use, Verb.USE, Set.of("policy")))
                .thenReturn(List.of(new ObjectGrant("policy", use, Verb.USE, null)));
        when(store.objectGrants(edit, Verb.EDIT, Set.of("policy")))
                .thenReturn(List.of(new ObjectGrant("policy", edit, Verb.EDIT, null)));

        var ranges = authorization.readObjectRanges(ctx, Kind.PROJECTION, verbs);
        assertEquals(new ObjectVisibilityRange(true, "user", Set.of("use"), false), ranges.get(Verb.USE));
        assertEquals(new ObjectVisibilityRange(false, "user", Set.of("edit"), false), ranges.get(Verb.EDIT));
        verify(store).objectKeysByVerb("domain", Kind.PROJECTION, verbs, Set.of("policy"));
        verify(store, never()).objectGrants(any(), any(), any());
        assertTrue(authorization.decide(ctx, new ObjectAccess(use, Verb.USE, published)).allowed());
        assertFalse(authorization.decide(ctx, new ObjectAccess(edit, Verb.USE, published)).allowed());
        assertTrue(authorization.decide(ctx, new ObjectAccess(edit, Verb.EDIT, published)).allowed());
        assertTrue(authorization.decide(ctx, new ObjectAccess(edit, Verb.USE, author)).allowed());
        assertFalse(authorization.decide(ctx, new ObjectAccess(new ObjectTarget("domain", Kind.PROJECTION,
                "builtin-product-id-is-not-owner-proof"), Verb.USE, published)).allowed());
        assertFalse(authorization.decide(ctx, new ObjectAccess(new ObjectTarget("another", Kind.PROJECTION,
                use.id()), Verb.USE, author)).allowed());
    }

    @Test
    void aSingleObjectCredentialDoesNotAuthorizeAnyPublishedRange() {
        var target = new ObjectTarget("domain", Kind.PANEL, "panel");
        var point = new ObjectAccess(target, Verb.USE, new OwnerFacts("user", DefinitionState.PUBLISHED));
        var ctx = authorization.resolveSubject(new VerifiedIdentity("domain", "user", point::equals));

        assertTrue(authorization.decide(ctx, point).allowed());
        assertEquals(Map.of(Verb.USE, new ObjectVisibilityRange(false, null, Set.of(), false)),
                authorization.readObjectRanges(ctx, Kind.PANEL, Set.of(Verb.USE)));
        verify(store, never()).objectKeysByVerb(any(), any(), any(), any());
    }

    @Test
    void agentsResolveEachVerbFromObjectGrantsAndEditionEntitlements() {
        var ctx = authorization.resolveSubject(new VerifiedIdentity("domain", "user", CredentialLimit.UNRESTRICTED));
        var agent = new ObjectTarget("domain", Kind.AGENT, "agent");
        var access = new ObjectAccess(agent, Verb.USE, published);
        assertFalse(authorization.decide(ctx, access).allowed());
        when(store.objectGrants(agent, Verb.USE, Set.of("policy")))
                .thenReturn(List.of(new ObjectGrant("policy", agent, Verb.USE, null)));
        assertTrue(authorization.decide(ctx, access).allowed());
        var view = new ObjectAccess(agent, Verb.VIEW, published);
        assertFalse(authorization.decide(ctx, view).allowed());
        when(subjects.domainWideObjectEntitlement(Kind.AGENT, Verb.VIEW)).thenReturn(true);
        assertTrue(authorization.decide(ctx, view).allowed());
        assertEquals(Map.of(Verb.VIEW, new ObjectVisibilityRange(false, "user", Set.of(), true)),
                authorization.readObjectRanges(ctx, Kind.AGENT, Set.of(Verb.VIEW)));
        verify(store, never()).objectKeysByVerb(any(), any(), any(), any());
    }
}
