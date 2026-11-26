package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.applications.ApplicationPanelUse;
import io.ontomato.dataengine.applications.DefaultAgentTarget;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.ActionTarget;
import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.config.BaseControllerAdvice;
import io.ontomato.dataengine.config.ManagementEndpointConfig;
import io.ontomato.dataengine.controller.AuthorizationPolicyGovernanceController;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.schedules.TaskStore;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Decision;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.handler.MappedInterceptor;

class AuthorizationPolicyGovernanceControllerTest {
    private static final String PREFIX = "/authorization/policies/";
    private static final ObjectTarget ENTRY = new ObjectTarget("domain", Kind.ENTRY, "app/main");
    private static final ObjectTarget ACTION = new ObjectTarget("domain", Kind.ACTION, "approve");
    private static final GrantScope SELF = new GrantScope(GrantScope.Kind.assigned_to_self, "Order", "assignee");

    private final IdentityService identity = mock(IdentityService.class);
    private final AuthorizationSubjects subjects = mock(AuthorizationSubjects.class);
    private final AuthorizationStore store = mock(AuthorizationStore.class);
    private final ApplicationCatalog catalog = mock(ApplicationCatalog.class);
    private final WorkflowDao workflows = mock(WorkflowDao.class);
    private final TaskStore triggers = mock(TaskStore.class);
    private final ActionDao actions = mock(ActionDao.class);
    private final AdminService admin = mock(AdminService.class);
    private final User user = mock(User.class);
    private MockMvc http;

    @BeforeEach
    void setUp() {
        var operations = new ManagementOperations(List.of(new AuthorizationPolicies.Operations()));
        var grants = mock(CapabilityGrantLookup.class);
        var authorization = new AuthorizationService(subjects, store, operations, grants, mock(DataPermissionLookup.class));
        var policies = new AuthorizationPolicies(store, operations, authorization, actions, admin);
        var inspector = new AuthorizationAccessInspector(authorization, store, subjects, policies, workflows, grants, actions);
        var controller = new AuthorizationPolicyGovernanceController(new WorkbenchServiceAuthentication("workbench"),
                identity, authorization, policies, inspector, catalog, subjects, store, actions, workflows, triggers);
        var beans = new DefaultListableBeanFactory();
        beans.registerSingleton("access", new ManagementRequestAccess(identity, authorization, operations));
        var registry = new InterceptorRegistry() {
            HandlerInterceptor[] interceptors() {
                return getInterceptors().stream().map(value -> ((MappedInterceptor) value).getInterceptor())
                        .toArray(HandlerInterceptor[]::new);
            }
        };
        new ManagementEndpointConfig(beans.getBeanProvider(ManagementRequestAccess.class)).addInterceptors(registry);
        http = MockMvcBuilders.standaloneSetup(controller).addInterceptors(registry.interceptors())
                .setControllerAdvice(new BaseControllerAdvice()).build();

        when(identity.getCurrentUser()).thenReturn(user);
        when(user.getId()).thenReturn("login-id");
        when(user.getDomainId()).thenReturn("domain");
        when(user.isEnable()).thenReturn(true);
        when(identity.workbenchSubjectId(user)).thenReturn("operator");
        permissions(false, false);
    }

    @Test
    void requiresWorkbenchAndNormalActiveDomainUserEvenForGraph() throws Exception {
        http.perform(post(PREFIX + "graph-facts")).andExpect(status().isForbidden());
        http.perform(rpc("graph-facts", "{}").requestAttr(QueryGrantService.ATTRIBUTE, new Object()))
                .andExpect(status().isUnauthorized());
        when(user.getDomainId()).thenReturn("");
        http.perform(rpc("graph-facts", "{}")).andExpect(status().isUnauthorized());
        verifyNoInteractions(store, subjects, catalog, actions, workflows, triggers);
    }

    @Test
    void browsingTheEntryCatalogRequiresManagementReadWithoutAPolicyId() throws Exception {
        http.perform(rpc("entry-roots", "{}")).andExpect(status().isForbidden());
        verifyNoInteractions(catalog, actions, workflows, triggers);
    }

    @Test
    void returnsDomainEntryRootsAndPublishedActionAndWorkflowFacts() throws Exception {
        permissions(true, false);
        when(catalog.entriesInDomain("domain")).thenCallRealMethod();
        var agents = JSONObject.of("id", "agents",
                "entry", JSONObject.of("renderer", "agents", "entryKey", "agents", "home", "/agents/chat"),
                "pageSkills", List.of(),
                "panelUses", List.of(new ApplicationPanelUse("settings", "settings", "agent-settings",
                        "/agents/settings", null, Map.of("en", "Settings"))));
        when(catalog.all()).thenReturn(List.of(
                application("app", "domain", "root", "frame", "agent"),
                application("shared", null, "same", "same", null),
                application("foreign", "other", "other-panel", "other-frame", "other-agent"), agents));
        when(subjects.entryEntitlement(ENTRY)).thenReturn(true);
        when(store.policyObjectGrants("domain", "selected")).thenReturn(List.of(grant(ENTRY, Verb.ENTER, null)));
        when(store.policyRoleIds("domain", "selected")).thenReturn(Set.of("reviewer"));
        when(actions.queryList(null, null, null, "domain")).thenReturn(List.of(
                new Object[]{action("approve", Action.STATUS_PUBLISHED), null},
                new Object[]{action("draft", Action.STATUS_PENDING_REVIEW), null}));
        var step = new WorkflowStep();
        step.setActionId("approve");
        step.setStepNo(2);
        step.setName("Approve");
        var workflow = workflow("live");
        workflow.setName("Review");
        workflow.setVersion(4);
        workflow.setSteps(List.of(step));
        when(workflows.queryList(Workflow.STATUS_ACTIVE, "domain")).thenReturn(List.of(workflow));

        http.perform(rpc("entry-roots", "{\"policyId\":\"selected\",\"entryIds\":[\"app/main\",\"foreign/main\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[*].entryId", containsInAnyOrder("app/main")))
                .andExpect(jsonPath("$.entries[0].appId").value("app"))
                .andExpect(jsonPath("$.entries[0].useId").value("main"))
                .andExpect(jsonPath("$.entries[0].panelIds[0]").value("root"))
                .andExpect(jsonPath("$.entries[0].panelIds[1]").value("frame"))
                .andExpect(jsonPath("$.entries[0].agentIds[0]").value("agent"))
                .andExpect(jsonPath("$.entries[0].entryEntitlement").value(true))
                .andExpect(jsonPath("$.existingGrants[0].policyId").value("selected"))
                .andExpect(jsonPath("$.existingGrants[0].verb").value("ENTER"))
                .andExpect(jsonPath("$.targetPolicyRoleIds[0]").value("reviewer"))
                .andExpect(jsonPath("$.publishedActions[*].id", containsInAnyOrder("approve")))
                .andExpect(jsonPath("$.publishedActions[0].targetClass").value("Order"))
                .andExpect(jsonPath("$.publishedActions[0].targetKeyField").value("orderId"))
                .andExpect(jsonPath("$.workflowStepActions[0].workflowId").value("live"))
                .andExpect(jsonPath("$.workflowStepActions[0].version").value(4))
                .andExpect(jsonPath("$.workflowStepActions[0].stepNo").value(2))
                .andExpect(jsonPath("$.workflowStepActions[0].actionId").value("approve"));
        http.perform(rpc("entry-roots", "{\"entryIds\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries[*].entryId", containsInAnyOrder("app/main", "shared/main", "agents/settings", "agents/agents")))
                .andExpect(jsonPath("$.entries[1].panelIds", containsInAnyOrder("same")))
                .andExpect(jsonPath("$.existingGrants").isEmpty())
                .andExpect(jsonPath("$.targetPolicyRoleIds").isEmpty());
    }

    @Test
    void registeredTriggerTargetsUseTheCurrentCredentialDomain() throws Exception {
        var targets = """
                {"targets":[{"kind":"TRIGGER","key":"registered"},{"kind":"TRIGGER","key":"foreign"}]}
                """;
        var request = post(PREFIX + "registered-targets/check").contentType(MediaType.APPLICATION_JSON)
                .header("X-Domain-Id", "other-domain").content(targets);
        http.perform(request).andExpect(status().isForbidden());
        verifyNoInteractions(triggers);

        permissions(true, false);
        when(triggers.registeredIds("domain", Set.of("registered", "foreign"))).thenReturn(Set.of("registered"));
        http.perform(request)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].kind").value("TRIGGER"))
                .andExpect(jsonPath("$.data[0].key").value("registered"));
    }

    @Test
    void checksSnapshotGrantsWithoutTreatingSnapshotDefinitionsAsRegisteredTargets() throws Exception {
        var grant = JSONObject.of("policyId", "selected", "kind", "ACTION", "key", "snapshot-approve",
                "verb", "EXECUTE", "scope", JSONObject.of("kind", "assigned_to_self", "className", "Order", "field", "assignee"));
        var action = JSONObject.of("id", "snapshot-approve", "status", Action.STATUS_PUBLISHED,
                "target", JSONObject.of("className", "Order", "keyParameter", "orderId").toJSONString());
        var selected = JSONObject.of("id", "selected", "type", PolicyTypes.OBJECT);
        var management = JSONObject.of("policyId", "management", "operationId", AuthorizationPolicies.READ);
        var snapshot = JSONObject.of("grants", List.of(grant), "actions", List.of(action),
                "policies", List.of(selected, JSONObject.of("id", "management", "type", PolicyTypes.MANAGEMENT),
                        JSONObject.of("id", "data", "type", PolicyTypes.BUSINESS_DATA)),
                "policyLinks", List.of(JSONObject.of("policyId", "selected", "type", PolicyTypes.OBJECT)),
                "managementGrants", List.of(management), "businessDataPolicyIds", List.of("data"),
                "ontologyRule", JSONObject.of("classDef", List.of(JSONObject.of("className", "Order",
                        "attrs", List.of(JSONObject.of("name", "assignee", "enable", true))))).toJSONString());
        var input = JSONObject.of("targets", List.of(
                JSONObject.of("kind", "ENTRY", "key", "app/main"),
                JSONObject.of("kind", "APPLICATION", "key", "foreign")), "snapshot", snapshot);
        http.perform(post(PREFIX + "registered-targets/check").contentType(MediaType.APPLICATION_JSON).content(input.toJSONString()))
                .andExpect(status().isForbidden());
        permissions(true, false);
        when(catalog.registeredEntryIds("domain", Set.of("app/main"))).thenReturn(Set.of("app/main"));
        http.perform(post(PREFIX + "registered-targets/check").contentType(MediaType.APPLICATION_JSON)
                        .header("X-Domain-Id", "other-domain").content(input.toJSONString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1))
                .andExpect(jsonPath("$.data[0].kind").value("ENTRY"))
                .andExpect(jsonPath("$.data[0].key").value("app/main"));
        verify(catalog).registeredEntryIds("domain", Set.of("app/main"));
        verify(catalog).registeredApplicationIds("domain", Set.of("foreign"));

        snapshot.put("businessDataPolicyIds", List.of("selected"));
        http.perform(post(PREFIX + "registered-targets/check").contentType(MediaType.APPLICATION_JSON).content(input.toJSONString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("Snapshot policy selected requires policy type " + PolicyTypes.BUSINESS_DATA)));
        snapshot.put("businessDataPolicyIds", List.of("data"));
        management.put("policyId", "data");
        http.perform(post(PREFIX + "registered-targets/check").contentType(MediaType.APPLICATION_JSON).content(input.toJSONString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("Snapshot policy data requires policy type " + PolicyTypes.MANAGEMENT)));
        management.put("policyId", "management");
        grant.put("policyId", "data");
        http.perform(post(PREFIX + "registered-targets/check").contentType(MediaType.APPLICATION_JSON).content(input.toJSONString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("Snapshot policy data requires policy type " + PolicyTypes.OBJECT)));
        grant.put("policyId", "selected");
        snapshot.put("policyLinks", List.of(JSONObject.of("policyId", "selected", "type", PolicyTypes.BUSINESS_DATA)));
        http.perform(post(PREFIX + "registered-targets/check").contentType(MediaType.APPLICATION_JSON).content(input.toJSONString()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("Snapshot policy selected requires policy type " + PolicyTypes.BUSINESS_DATA)));
        snapshot.put("policyLinks", List.of(JSONObject.of("policyId", "selected", "type", PolicyTypes.OBJECT)));

        for (var kind : List.of("PANEL", "SKILL")) {
            snapshot.put("grants", List.of(JSONObject.of("policyId", "selected", "kind", kind,
                    "key", "unapproved", "verb", "VIEW")));
            http.perform(post(PREFIX + "registered-targets/check").contentType(MediaType.APPLICATION_JSON).content(input.toJSONString()))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message", containsString("policy selected, " + kind + ", key unapproved")));
        }
        snapshot.put("grants", List.of(grant));
        for (var scope : List.of(JSONObject.of("kind", "made_up"),
                JSONObject.of("kind", "all", "field", "assignee"),
                JSONObject.of("kind", "assigned_to_self", "className", "Order", "field", 5),
                JSONObject.of("kind", "assigned_to_self", "className", "Order", "field", "unknown"))) {
            grant.put("scope", scope);
            http.perform(post(PREFIX + "registered-targets/check").contentType(MediaType.APPLICATION_JSON).content(input.toJSONString()))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message", containsString("policy selected, ACTION, key snapshot-approve")));
        }
        verifyNoMoreInteractions(catalog);
        verifyNoInteractions(actions, admin);
        verify(store, never()).grantObject(any());
    }

    @Test
    void bindsBothGrantScopeShapesAndLeavesInvalidRequestsWithoutSideEffects() throws Exception {
        when(actions.queryById("approve")).thenReturn(new Object[]{action("approve", Action.STATUS_PUBLISHED), null});
        when(actions.queryById("approve-all")).thenReturn(new Object[]{action("approve-all", Action.STATUS_PUBLISHED), null});
        when(admin.getJSONRule("domain")).thenReturn(Map.of("classDef",
                List.of(Map.of("className", "Order", "attrs", List.of(Map.of("name", "assignee"))))));
        var body = """
                {"policyId":"selected","entryIds":["app/main","app/main"],"acceptedObjects":[
                  {"kind":"ACTION","id":"approve","verb":"EXECUTE",
                   "scope":{"kind":"assigned_to_self","className":"Order","field":"assignee"}},
                  {"kind":"ACTION","id":"approve-all","verb":"EXECUTE","scope":{"kind":"all"}}]}
                """;
        http.perform(rpc("entries:grant", body)).andExpect(status().isForbidden());
        permissions(true, true);
        http.perform(rpc("entries:grant", body.replace(",\"field\":\"assignee\"", "")))
                .andExpect(status().isBadRequest());
        verify(store, never()).grantObject(any());

        http.perform(rpc("entries:grant", body)).andExpect(status().isOk())
                .andExpect(jsonPath("$.grantedEntryCount").value(1))
                .andExpect(jsonPath("$.grantedObjectCount").value(2));
        verify(store).grantObject(grant(ENTRY, Verb.ENTER, null));
        verify(store).grantObject(grant(ACTION, Verb.EXECUTE, SELF));
        verify(store).grantObject(grant(new ObjectTarget("domain", Kind.ACTION, "approve-all"), Verb.EXECUTE, GrantScope.ALL));
    }

    @Test
    void listsPendingForReadersAndRequiresChangeToConfirmOrIgnore() throws Exception {
        permissions(true, false);
        var pending = new PendingGrant(7, "publication", "change", "author", ENTRY, grant(ACTION, Verb.EXECUTE, null));
        var agent = new ObjectTarget("domain", Kind.AGENT, "agent");
        var firstPublication = new PendingGrant(8, "first-publication", "agent", "author", null, grant(agent, Verb.USE, null));
        when(store.pendingGrants("domain", "selected")).thenReturn(List.of(pending, firstPublication));
        when(store.policyRoleIds("domain", "selected")).thenReturn(Set.of("reviewer"));
        when(store.pendingGrant("domain", "selected", 7)).thenReturn(pending);
        when(actions.queryById("approve")).thenReturn(new Object[]{action("approve", Action.STATUS_PUBLISHED), null});
        when(admin.getJSONRule("domain")).thenReturn(Map.of("classDef",
                List.of(Map.of("className", "Order", "attrs", List.of(Map.of("name", "assignee"))))));

        http.perform(rpc("pending:list", "{\"policyId\":\"selected\"}")).andExpect(status().isOk())
                .andExpect(jsonPath("$.canManage").value(false))
                .andExpect(jsonPath("$.targetPolicyRoleIds[0]").value("reviewer"))
                .andExpect(jsonPath("$.items[0].entryId").value("app/main"))
                .andExpect(jsonPath("$.items[0].targetId").value("approve"))
                .andExpect(jsonPath("$.items[0].source").value("publication"))
                .andExpect(jsonPath("$.items[1].entryId").value(nullValue()));

        var resolutions = """
                {"policyId":"selected","resolutions":[
                 {"id":7,"confirm":true,"scope":{"kind":"assigned_to_self","className":"Order","field":"assignee"}},
                 {"id":8,"confirm":false}]}
                """;
        http.perform(rpc("pending:resolve", resolutions)).andExpect(status().isForbidden());
        permissions(true, true);
        http.perform(rpc("pending:resolve", resolutions.replace(",\"confirm\":false", "")))
                .andExpect(status().isBadRequest());
        verify(store, never()).resolvePendingGrant(any(), any(), anyLong(), anyBoolean(), any());

        http.perform(rpc("pending:resolve", resolutions)).andExpect(status().isOk())
                .andExpect(jsonPath("$.resolvedCount").value(2));
        verify(store).resolvePendingGrant("domain", "selected", 7, true, SELF);
        verify(store).resolvePendingGrant("domain", "selected", 8, false, null);
    }

    @Test
    void accessInspectionUsesAuthenticatedDomainAndBindsActionTargets() throws Exception {
        permissions(true, false);
        when(subjects.resolveRoles("domain", "inspected")).thenReturn(roles(Set.of("reviewer")));
        when(store.policies("domain", Set.of("reviewer"))).thenReturn(List.of(new PolicyRef("reviewer", "selected", PolicyKind.OBJECT)));
        when(store.objectGrants(ACTION, Verb.EXECUTE, Set.of("selected"))).thenReturn(List.of(grant(ACTION, Verb.EXECUTE, SELF)));
        when(actions.queryById("approve")).thenReturn(new Object[]{action("approve", Action.STATUS_PUBLISHED), null});
        http.perform(rpc("access:inspect", """
                {"subjectId":"inspected","entryId":"app/main","items":[{"kind":"ACTION","id":"approve","verb":"EXECUTE"}],
                 "optionalActionTargets":[{"actionId":"approve","className":"Order","objectId":"row",
                   "fields":{"assignee":["another","inspected"]}}]}
                """)).andExpect(status().isOk())
                .andExpect(jsonPath("$.subjectId").value("inspected"))
                .andExpect(jsonPath("$.entry.kind").value("ENTRY"))
                .andExpect(jsonPath("$.entry.id").value("app/main"))
                .andExpect(jsonPath("$.entry.verb").value("ENTER"))
                .andExpect(jsonPath("$.entry.allowed").value(false))
                .andExpect(jsonPath("$.items[0].allowed").value(true))
                .andExpect(jsonPath("$.items[0].sources[0].type").value("policy"))
                .andExpect(jsonPath("$.items[0].sources[0].roleIds[0]").value("reviewer"))
                .andExpect(jsonPath("$.items[0].sources[0].scope.kind").value("assigned_to_self"))
                .andExpect(jsonPath("$.items[0].targetDecisions[0].objectId").value("row"))
                .andExpect(jsonPath("$.items[0].targetDecisions[0].allowed").value(true))
                .andExpect(jsonPath("$.subjectRoleIds[0]").value("reviewer"));
    }

    @Test
    void ordinaryDomainMembersCanReadOnlyTheirDomainGraphFacts() throws Exception {
        var entryAuthorization = mock(AuthorizationService.class);
        ReflectionTestUtils.setField(catalog, "authorization", entryAuthorization);
        when(entryAuthorization.resolveSubject(any())).thenReturn(mock(AuthorizationService.SubjectContext.class));
        when(entryAuthorization.decide(any(), any())).thenReturn(Decision.denied("FORBIDDEN", "Access denied"));
        when(entryAuthorization.decide(any(), eq(new AuthorizationService.Entry(ENTRY)))).thenReturn(Decision.ALLOWED);
        var app = application("app", "domain", "panel", "frame", null);
        app.put("panelUses", List.of(
                new ApplicationPanelUse("main", "landing", "panel", "/applications/app", null, null),
                new ApplicationPanelUse("private", "private", "panel", "/applications/app/private", null, Map.of("en", "Private"))));
        when(catalog.all()).thenReturn(List.of(app, application("foreign", "other", "panel", "frame", null)));
        when(catalog.entriesInDomain("domain")).thenCallRealMethod();
        when(catalog.visibleEntries(user)).thenCallRealMethod();

        when(store.domainObjectGrants("domain")).thenReturn(List.of(
                grant(ACTION, Verb.EXECUTE, SELF),
                grant(new ObjectTarget("domain", Kind.WORKFLOW, "one"), Verb.EDIT, null),
                grant(new ObjectTarget("domain", Kind.WORKFLOW, ""), Verb.CREATE, null),
                grant(ENTRY, Verb.ENTER, null)));
        when(store.domainRolePolicies("domain")).thenReturn(List.of(new PolicyRef("reviewer", "selected", PolicyKind.OBJECT)));
        when(store.domainPolicy("domain")).thenReturn(new PolicyRef("member", "default", PolicyKind.OBJECT));
        var result = http.perform(post(PREFIX + "graph-facts").header(WorkbenchServiceAuthentication.HEADER, "workbench"));
        result.andExpect(status().isOk())
                .andExpect(jsonPath("$.policyGrants[0].targetKind").value("ACTION"))
                .andExpect(jsonPath("$.policyGrants[0].targetKey").value("approve"))
                .andExpect(jsonPath("$.policyGrants[0].scope.field").value("assignee"))
                .andExpect(jsonPath("$.policyGrants[1].targetKey").value("one"))
                .andExpect(jsonPath("$.policyGrants[1].verb").value("EDIT"))
                .andExpect(jsonPath("$.policyGrants[2].targetKey").value(""))
                .andExpect(jsonPath("$.policyGrants[2].verb").value("CREATE"))
                .andExpect(jsonPath("$.policyGrants[3].targetKey").value("app/main"))
                .andExpect(jsonPath("$.policyGrants[3].verb").value("ENTER"))
                .andExpect(jsonPath("$.rolePolicies[0].roleId").value("reviewer"))
                .andExpect(jsonPath("$.entries.length()").value(1))
                .andExpect(jsonPath("$.entries[0].id").value("app/main"))
                .andExpect(jsonPath("$.entries[0].applicationId").value("app"))
                .andExpect(jsonPath("$.entries[0].pageKey").value("landing"))
                .andExpect(jsonPath("$.entries[0].names").isMap())
                .andExpect(jsonPath("$.entries[0].names").isEmpty());
        verifyNoInteractions(subjects);
        verify(store).domainObjectGrants("domain");
        verifyNoInteractions(workflows);
    }

    private void permissions(boolean read, boolean change) {
        when(subjects.resolveRoles("domain", "operator")).thenReturn(roles(Set.of()));
        when(subjects.managementEntitlement(AuthorizationPolicies.READ)).thenReturn(read);
        when(subjects.managementEntitlement(AuthorizationPolicies.CHANGE)).thenReturn(change);
    }

    private static RoleResolution roles(Set<String> ids) {
        return new RoleResolution(ids, ids, List.of(), Set.of(), Map.of(), false);
    }

    private static ObjectGrant grant(ObjectTarget target, Verb verb, GrantScope scope) {
        return new ObjectGrant("selected", target, verb, scope);
    }

    private static Action action(String id, String status) {
        var action = new Action();
        action.setId(id);
        action.setName(id);
        action.setDomainId("domain");
        action.setStatus(status);
        action.setTarget(new ActionTarget("Order", "orderId"));
        return action;
    }

    private static Workflow workflow(String id) {
        var workflow = new Workflow();
        workflow.setId(id);
        return workflow;
    }

    private static JSONObject application(String id, String domain, String panel, String frame, String agentId) {
        var agent = agentId == null ? null : new DefaultAgentTarget("id", agentId, null);
        var use = new ApplicationPanelUse("main", panel, panel, "/applications/" + id, agent, Map.of("en", "Dashboard"));
        return JSONObject.of("id", id, "domainId", domain, "kind", "panel-app", "entry", JSONObject.of("renderer", "panels", "path", "/applications/" + id),
                "panelSettings", JSONObject.of("framePanelId", frame), "panelUses", List.of(use));
    }

    private static MockHttpServletRequestBuilder rpc(String path, String body) {
        return post(PREFIX + path).header(WorkbenchServiceAuthentication.HEADER, "workbench")
                .contentType(MediaType.APPLICATION_JSON).content(body);
    }
}
