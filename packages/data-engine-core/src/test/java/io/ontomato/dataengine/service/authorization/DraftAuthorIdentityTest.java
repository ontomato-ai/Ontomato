package io.ontomato.dataengine.service.authorization;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.CredentialLimit;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ObjectAccess;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.DefinitionState;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.ObjectTarget;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.OwnerFacts;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.RoleResolution;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/*
 * OSS anonymous identity: REST requests are Java's admin, a Workbench panel read is the placement principal system with
 * the Java user admin beside it. Actions, functions and metrics record Java users as authors, so a panel read's
 * deleteRefusal (which judges with the panel subject) and the delete itself (which judges the REST user) reach the same
 * conclusion on their drafts; Workbench-owned drafts keep the placement principal as their author.
 */
class DraftAuthorIdentityTest {
    private final AuthorizationService authorization;
    private final CapabilityDefinitions definitions;
    private final ActionAuthorization actions;
    private final SubjectContext rest;
    private final SubjectContext panel;

    DraftAuthorIdentityTest() {
        var subjects = mock(AuthorizationSubjects.class);
        when(subjects.resolveRoles(any(), any()))
            .thenReturn(new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false));
        authorization = new AuthorizationService(subjects, mock(AuthorizationStore.class), null, null, null);
        definitions = new CapabilityDefinitions(authorization, mock(IdentityService.class));
        actions = new ActionAuthorization(authorization, mock(AdminService.class));
        rest = authorization.resolveSubject(new VerifiedIdentity("1", "admin", CredentialLimit.UNRESTRICTED));
        panel = authorization.resolveSubject(new VerifiedIdentity("1", "system", CredentialLimit.UNRESTRICTED)).withJavaUserId("admin");
    }

    private static Function function(String author) {
        var function = new Function();
        function.setId("f1");
        function.setDomainId("1");
        function.setOperation(Function.OPERATION_READ);
        function.setPublished(false);
        function.setCreatedBy(author);
        return function;
    }

    private static MetricView metric(String author) {
        var metric = new MetricView();
        metric.setId("m1");
        metric.setDomainId("1");
        metric.setStatus(MetricView.STATUS_PENDING_REVIEW);
        metric.setCreatedBy(author);
        return metric;
    }

    private static Action action(String author) {
        var action = new Action();
        action.setId("a1");
        action.setDomainId("1");
        action.setStatus(Action.STATUS_PENDING_REVIEW);
        action.setCreatedBy(author);
        action.setCoauthorIds(List.of());
        return action;
    }

    private boolean actionEditable(SubjectContext subject, Action action) {
        try {
            actions.requireEdit(subject, action);
            return true;
        } catch (ActionAuthorization.Denied denied) {
            return false;
        }
    }

    @Test
    void javaAuthoredDraftsAreJudgedAlikeForThePanelReadAndTheDelete() {
        for (var author : List.of("admin", "someone-else")) {
            var mine = author.equals("admin");
            var functionAccess = CapabilityDefinitions.access(function(author), Verb.EDIT);
            assertEquals(mine, definitions.allows(rest, functionAccess));
            assertEquals(mine, definitions.allows(panel, functionAccess));
            var metricAccess = CapabilityDefinitions.access(metric(author), Verb.EDIT);
            assertEquals(mine, definitions.allows(rest, metricAccess));
            assertEquals(mine, definitions.allows(panel, metricAccess));
            assertEquals(mine, actionEditable(rest, action(author)));
            assertEquals(mine, actionEditable(panel, action(author)));
        }
        assertThrows(CapabilityDefinitions.Denied.class,
            () -> definitions.require(panel, CapabilityDefinitions.access(function("someone-else"), Verb.EDIT)));
    }

    @Test
    void workbenchOwnedDraftsKeepThePlacementPrincipalAsTheirAuthor() {
        var draftPanel = new ObjectTarget("1", Kind.PANEL, "placement");
        assertTrue(authorization.decide(panel, new ObjectAccess(draftPanel, Verb.USE,
            new OwnerFacts("system", DefinitionState.DRAFT))).allowed());
        assertFalse(authorization.decide(panel, new ObjectAccess(draftPanel, Verb.USE,
            new OwnerFacts("admin", DefinitionState.DRAFT))).allowed());
        var draftAgent = new ObjectTarget("1", Kind.AGENT, "agent");
        assertTrue(authorization.decide(panel, new ObjectAccess(draftAgent, Verb.EDIT,
            new OwnerFacts("system", DefinitionState.DRAFT))).allowed());
    }

    @Test
    void theJavaUserIsTheSamePersonWithTheJavaUserIdAndNothingElseChanged() {
        var java = panel.asJavaUser();
        assertEquals("admin", java.identity().userId());
        assertEquals(panel.identity().domainId(), java.identity().domainId());
        assertSame(panel.identity().limit(), java.identity().limit());
        assertSame(panel.roles(), java.roles());
        assertSame(panel.policyRefsByRole(), java.policyRefsByRole());
        assertEquals("admin", java.javaUserId());
        assertSame(rest, rest.asJavaUser());
    }
}
