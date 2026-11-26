package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.controller.ObjectAuthorizationController.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.config.BaseControllerAdvice;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.controller.ObjectAuthorizationController;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ObjectAuthorizationControllerTest {
    private static final String TARGET = """
            {"domainId":"domain","kind":"AGENT","id":"agent"}
            """;
    private static final String AUTHOR = """
            {"ownerId":"user","state":"DRAFT"}
            """;
    private static final String OTHER = """
            {"ownerId":"other","state":"PUBLISHED"}
            """;
    private static final ObjectTarget AGENT = new ObjectTarget("domain", Kind.AGENT, "agent");

    private final IdentityService identity = mock(IdentityService.class);
    private final AuthorizationSubjects subjects = mock(AuthorizationSubjects.class);
    private final AuthorizationStore store = mock(AuthorizationStore.class);
    private final User user = mock(User.class);
    private MockMvc http;

    @BeforeEach
    void setUp() {
        var operations = new ManagementOperations(List.of(new AuthorizationPolicies.Operations()));
        var authorization = new AuthorizationService(subjects, store, operations,
                mock(CapabilityGrantLookup.class), mock(DataPermissionLookup.class));
        var policies = new AuthorizationPolicies(store, operations, authorization, null, null);
        http = MockMvcBuilders.standaloneSetup(new ObjectAuthorizationController(
                new WorkbenchServiceAuthentication("workbench"), identity, authorization, policies))
                .setControllerAdvice(new BaseControllerAdvice()).build();
        when(identity.getCurrentUser()).thenReturn(user);
        when(identity.workbenchSubjectId(user)).thenReturn("user");
        when(user.isEnable()).thenReturn(true);
        when(user.getId()).thenReturn("user");
        when(user.getDomainId()).thenReturn("domain");
        roles(false);
    }

    @Test
    void requiresWorkbenchAndOrdinaryActiveUser() throws Exception {
        http.perform(post(DECIDE_BATCH).contentType(MediaType.APPLICATION_JSON).content("{\"requests\":[]}"))
                .andExpect(status().isForbidden());
        http.perform(rpc(DECIDE_BATCH, "{\"requests\":[]}").requestAttr(QueryGrantService.ATTRIBUTE, Map.of("userId", "user")))
                .andExpect(status().isUnauthorized());
        when(user.isEnable()).thenReturn(false);
        http.perform(rpc(DECIDE_BATCH, "{\"requests\":[]}")).andExpect(status().isUnauthorized());
        when(identity.getCurrentUser()).thenReturn(null);
        http.perform(rpc(FIRST_PUBLICATION, publication(AUTHOR, "{\"kind\":\"domain\"}")))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(subjects, store);
    }

    @Test
    void collectionRangesUseTheSameWorkbenchAndUserBoundary() throws Exception {
        var input = """
                {"kind":"PANEL","verbs":["USE","EDIT"]}
                """;
        http.perform(post(READ_RANGES).contentType(MediaType.APPLICATION_JSON).content(input))
                .andExpect(status().isForbidden());
        http.perform(rpc(READ_RANGES, input).requestAttr(QueryGrantService.ATTRIBUTE, Map.of("userId", "user")))
                .andExpect(status().isUnauthorized());
        http.perform(rpc(READ_RANGES, input.replace("EDIT", "VIEW"))).andExpect(status().isBadRequest());
        http.perform(rpc(READ_RANGES, input.replace("PANEL", "METRIC"))).andExpect(status().isBadRequest());
        verifyNoInteractions(subjects, store);

        when(store.objectKeysByVerb("domain", Kind.PANEL, Set.of(Verb.USE, Verb.EDIT), Set.of()))
                .thenReturn(Map.of(Verb.EDIT, Set.of("editable")));
        http.perform(rpc(READ_RANGES, input)).andExpect(status().isOk())
                .andExpect(jsonPath("$.ranges.USE.fixed").value(true))
                .andExpect(jsonPath("$.ranges.USE.authorId").value("user"))
                .andExpect(jsonPath("$.ranges.USE.objectIds").isEmpty())
                .andExpect(jsonPath("$.ranges.USE.all").value(false))
                .andExpect(jsonPath("$.ranges.EDIT.fixed").value(false))
                .andExpect(jsonPath("$.ranges.EDIT.objectIds[0]").value("editable"));
        verify(subjects).resolveRoles("domain", "user");
        verify(store).objectKeysByVerb("domain", Kind.PANEL, Set.of(Verb.USE, Verb.EDIT), Set.of());
        verify(store, never()).objectGrants(any(), any(), any());
    }

    @Test
    void resolvesOnceAndIgnoresClaimedUserId() throws Exception {
        when(subjects.objectEntitlement("user", new ObjectTarget("domain", Kind.AGENT, ""), Verb.CREATE)).thenReturn(true);
        http.perform(rpc(DECIDE_BATCH, """
                {"userId":"other","requests":[{"target":%s,"verb":"VIEW","ownerFacts":%s},
                 {"create":"AGENT"},{"target":%s,"verb":"EDIT","ownerFacts":%s}]}
                """.formatted(TARGET, OTHER, TARGET, AUTHOR)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decisions[0].code").value("OBJECT_FORBIDDEN"))
                .andExpect(jsonPath("$.decisions[1].allowed").value(true))
                .andExpect(jsonPath("$.decisions[2].allowed").value(true));
        verify(subjects).resolveRoles("domain", "user");
    }

    @Test
    void rejectsCrossDomainAndMalformedFactsBeforeResolvingPermissions() throws Exception {
        http.perform(rpc(DECIDE_BATCH, """
                {"requests":[{"create":"AGENT"},{"target":%s,"verb":"VIEW","ownerFacts":%s}]}
                """.formatted(TARGET.replace(":\"domain\"", ":\"foreign\""), OTHER))).andExpect(status().isForbidden());
        http.perform(rpc(DECIDE_BATCH, """
                {"requests":[{"target":%s,"verb":"VIEW","ownerFacts":{"ownerId":"user"}}]}
                """.formatted(TARGET))).andExpect(status().isBadRequest());
        http.perform(rpc(DECIDE_BATCH, """
                {"requests":[{"create":"AGENT","target":%s}]}
                """.formatted(TARGET))).andExpect(status().isBadRequest());
        verifyNoInteractions(subjects, store);
    }

    @Test
    void firstPublicationGrantsDomainUseAndRejectsReplayOrNonEditor() throws Exception {
        when(store.domainPolicy("domain")).thenReturn(new PolicyRef("member", "default", PolicyKind.OBJECT));
        var access = "{\"kind\":\"domain\"}";
        http.perform(rpc(FIRST_PUBLICATION, publication(AUTHOR, access))).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("granted"));
        http.perform(rpc(FIRST_PUBLICATION, publication(AUTHOR.replace("DRAFT", "PUBLISHED"), access)))
                .andExpect(status().isBadRequest());
        http.perform(rpc(FIRST_PUBLICATION, publication(AUTHOR.replace("\"user\"", "\"other\""), access)))
                .andExpect(status().isForbidden());
        verify(store).grantObject(new ObjectGrant("default", AGENT, Verb.USE, null));
        verify(store, never()).addPendingGrant(any());
    }

    @Test
    void explicitPolicyPublicationRoutesEditorToPendingAndManagerToGrant() throws Exception {
        var access = "{\"kind\":\"policy\",\"policyId\":\"chosen\"}";
        var grant = new ObjectGrant("chosen", AGENT, Verb.USE, null);
        http.perform(rpc(FIRST_PUBLICATION, publication(AUTHOR, access))).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"));
        verify(store).addPendingGrant(new PendingGrant(0, "first-publication", "agent", "user", null, grant));
        verify(store, never()).grantObject(any());
        roles(true);
        http.perform(rpc(FIRST_PUBLICATION, publication(AUTHOR, access))).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("granted"));
        verify(store).grantObject(grant);
    }

    @Test
    void settingsReadPolicyGrantsAndWritesRequireBothManagementAndEdit() throws Exception {
        var set = """
                {"target":%s,"ownerFacts":%s,"policyId":"chosen","level":"VIEW"}
                """.formatted(TARGET, AUTHOR);
        http.perform(rpc(AGENT_LEVEL, set)).andExpect(status().isForbidden());
        roles(true);
        http.perform(rpc(AGENT_LEVEL, set.replace(AUTHOR, OTHER))).andExpect(status().isForbidden());
        http.perform(rpc(AGENT_LEVEL, set.replace(",\"level\":\"VIEW\"", ""))).andExpect(status().isBadRequest());
        verify(store, never()).replaceAgentLevel(any(), any(), any());
        http.perform(rpc(AGENT_LEVEL, set)).andExpect(status().isNoContent());
        verify(store).replaceAgentLevel("chosen", AGENT, Verb.VIEW);
        http.perform(rpc(AGENT_LEVEL, set.replace("\"VIEW\"", "null"))).andExpect(status().isNoContent());
        verify(store).replaceAgentLevel("chosen", AGENT, null);

        var domainGrant = new ObjectGrant("default", AGENT, Verb.USE, null);
        when(store.domainPolicy("domain")).thenReturn(new PolicyRef("member", "default", PolicyKind.OBJECT));
        when(store.objectGrants(AGENT, Verb.USE, Set.of("default"))).thenReturn(List.of(domainGrant));
        when(store.agentPolicyGrants(AGENT)).thenReturn(List.of(new AgentPolicyGrant("default", "Members", Verb.USE),
                new AgentPolicyGrant("chosen", "Operators", Verb.VIEW)));
        http.perform(rpc(AGENT_ACCESS, """
                {"target":%s,"ownerFacts":%s}
                """.formatted(TARGET, AUTHOR))).andExpect(status().isOk())
                .andExpect(jsonPath("$.shared").value(true))
                .andExpect(jsonPath("$.grants[0].policyId").value("chosen"))
                .andExpect(jsonPath("$.grants[0].name").value("Operators"))
                .andExpect(jsonPath("$.grants[0].level").value("VIEW"))
                .andExpect(jsonPath("$.grants[1]").doesNotExist());
        http.perform(rpc(DOMAIN_USE, """
                {"target":%s,"ownerFacts":%s,"shared":false}
                """.formatted(TARGET, AUTHOR))).andExpect(status().isNoContent());
        verify(store).revokeObject(domainGrant);
    }

    @Test
    void catalogueRecordsOmitSharingWithoutEditAndRetainThePanelManagementException() {
        var operations = new ManagementOperations(List.of(new AuthorizationPolicies.Operations()));
        var authorization = new AuthorizationService(subjects, store, operations,
                mock(CapabilityGrantLookup.class), mock(DataPermissionLookup.class));
        var policies = new AuthorizationPolicies(store, operations, authorization, null, null);
        var subject = authorization.resolveSubject(new AuthorizationService.VerifiedIdentity(
                "domain", "user", AuthorizationService.CredentialLimit.UNRESTRICTED));
        var panel = new ObjectTarget("domain", Kind.PANEL, "panel");
        var projection = new ObjectTarget("domain", Kind.PROJECTION, "projection");
        var otherAuthor = new OwnerFacts("other", DefinitionState.PUBLISHED);
        when(subjects.objectEntitlement("user", panel, Verb.USE)).thenReturn(true);
        assertEquals(new AuthorizationPolicies.ProductRecordAccess(false, null),
                policies.productRecordAccess(subject, panel, otherAuthor, true));
        assertThrows(ResponseStatusException.class, () -> policies.productAccess(subject, panel, otherAuthor));
        verify(store, never()).domainPolicy(anyString());

        when(subjects.objectEntitlement("user", panel, Verb.USE)).thenReturn(false);
        when(subjects.objectEntitlement("user", panel, Verb.EDIT)).thenReturn(true);
        when(store.domainPolicy("domain")).thenReturn(new PolicyRef("member", "default", PolicyKind.OBJECT));
        when(store.objectGrants(panel, Verb.USE, Set.of("default")))
                .thenReturn(List.of(new ObjectGrant("default", panel, Verb.USE, null)));
        assertEquals(new AuthorizationPolicies.ProductRecordAccess(true, true),
                policies.productRecordAccess(subject, panel, otherAuthor, true));
        verify(store, never()).objectGrantViews(any());

        when(subjects.objectEntitlement("user", projection, Verb.EDIT)).thenReturn(true);
        assertThrows(ResponseStatusException.class, () -> policies.productRecordAccess(subject, projection, otherAuthor, true));
    }

    @Test
    void skillEditorAccessUsesAgentCreateForDraftAndEditForAnExistingTarget() throws Exception {
        when(subjects.objectEntitlement("user", new ObjectTarget("domain", Kind.AGENT, ""), Verb.CREATE)).thenReturn(true);
        http.perform(rpc(SKILL_EDITOR_ACCESS, "{\"agentTarget\":\"draft\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.allowed").value(true));

        http.perform(rpc(SKILL_EDITOR_ACCESS, """
                {"agentTarget":"agent","target":%s,"ownerFacts":%s}
                """.formatted(TARGET, AUTHOR)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.allowed").value(true));
        http.perform(rpc(SKILL_EDITOR_ACCESS, """
                {"agentTarget":"agent","target":%s,"ownerFacts":%s}
                """.formatted(TARGET, OTHER)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.allowed").value(false))
                .andExpect(jsonPath("$.code").value("OBJECT_FORBIDDEN"));
    }

    @Test
    void registeredSkillEditorAccessReusesTheAdmittedSubjectAndChecksTheRealAgent() {
        var authorization = mock(AuthorizationService.class);
        var verified = new AuthorizationService.VerifiedIdentity("domain", "user", AuthorizationService.CredentialLimit.UNRESTRICTED);
        var subject = new AuthorizationService.SubjectContext(verified, null, Map.of(), Set.of(), Set.of());
        var controller = new ObjectAuthorizationController(null, identity, authorization, null);
        WorkbenchPanelRead read = ReflectionTestUtils.invokeMethod(controller, "skillEditorAccessRead", new ObjectMapper());
        var create = new AuthorizationService.Create(Kind.AGENT);
        var edit = new AuthorizationService.ObjectAccess(AGENT, Verb.EDIT, new OwnerFacts("owner", DefinitionState.PUBLISHED));
        var allowed = new AuthorizationService.Decision(true, null, null);
        var denied = new AuthorizationService.Decision(false, "OBJECT_FORBIDDEN", "Agent edit denied");
        when(authorization.decide(subject, create)).thenReturn(allowed);
        when(authorization.decide(subject, edit)).thenReturn(denied);

        assertSame(allowed, read.handler().read(subject, Map.of("agentTarget", "draft")));
        assertSame(denied, read.handler().read(subject, Map.of("agentTarget", "agent",
            "target", Map.of("domainId", "domain", "kind", "AGENT", "id", "agent"),
            "ownerFacts", Map.of("ownerId", "owner", "state", "PUBLISHED"))));
        verify(authorization).decide(subject, create);
        verify(authorization).decide(subject, edit);
        verifyNoMoreInteractions(authorization);
        verifyNoInteractions(identity);
    }

    @Test
    void skillEditorAccessRejectsMismatchedOrMalformedTargetsBeforePermissionResolution() throws Exception {
        http.perform(rpc(SKILL_EDITOR_ACCESS, "{\"agentTarget\":\"draft\",\"target\":%s}".formatted(TARGET)))
                .andExpect(status().isBadRequest());
        http.perform(rpc(SKILL_EDITOR_ACCESS, """
                {"agentTarget":"other","target":%s,"ownerFacts":%s}
                """.formatted(TARGET, AUTHOR)))
                .andExpect(status().isBadRequest());
        http.perform(rpc(SKILL_EDITOR_ACCESS, """
                {"agentTarget":"agent","target":%s,"ownerFacts":%s}
                """.formatted(TARGET.replace(":\"domain\"", ":\"foreign\""), AUTHOR)))
                .andExpect(status().isForbidden());
        verifyNoInteractions(subjects, store);
    }

    private void roles(boolean manager) {
        when(subjects.resolveRoles("domain", "user")).thenReturn(
                new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), manager, false));
    }

    private static String publication(String facts, String access) {
        return """
                {"target":%s,"ownerFacts":%s,"access":%s}
                """.formatted(TARGET, facts, access);
    }

    private static MockHttpServletRequestBuilder rpc(String path, String input) {
        return post(path).header(WorkbenchServiceAuthentication.HEADER, "workbench")
                .contentType(MediaType.APPLICATION_JSON).content(input);
    }
}
