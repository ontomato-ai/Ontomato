package io.ontomato.dataengine.panelreads;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.applications.ApplicationCatalog.PanelReadRegistration;
import io.ontomato.dataengine.applications.ApplicationPanelUse;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.controller.AgentExecutionController;
import io.ontomato.dataengine.controller.AuthorizationPolicyGovernanceController;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeView;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ObjectVisibilityRange;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.logging.ServiceLogFilter;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.PreviewExecution;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.MetricParameterForms;
import io.ontomato.dataengine.service.MetricViewService;
import io.ontomato.dataengine.service.OntologyQueryService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.QueryOutputService;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.SubjectValueResolver;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.service.agent.OntologyAgentAccess;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Decision;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import io.ontomato.dataengine.service.authorization.AuthorizationService.VerifiedIdentity;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Kind;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.RoleResolution;
import io.ontomato.dataengine.service.authorization.AuthorizationTypes.Verb;
import io.ontomato.dataengine.service.identity.AgentExecutionIdentity;
import io.ontomato.dataengine.service.identity.AgentExecutionSettings;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;

class WorkbenchPanelReadsTest {
    private static final String FACT = """
        {"target":{"domainId":"d","kind":"PANEL","id":"panel"},"ownerFacts":{"state":"PUBLISHED"}}
        """;
    private static final PanelReadRegistration REGISTRATION = new PanelReadRegistration("app-a",
        new ApplicationPanelUse("use", "page", "panel", "/applications/app-a", null, null,
            Map.of("selected", Map.of("literal", Map.of("key", "registered", "number", new BigDecimal("1.00")))), null),
        "frame");
    private final ApplicationCatalog applications = mock(ApplicationCatalog.class);
    private final AuthorizationService authorization = mock(AuthorizationService.class);
    private final IdentityService identity = mock(IdentityService.class);
    private final AgentExecutionIdentity executionIdentity = mock(AgentExecutionIdentity.class);
    private final DataPermissionLookup dataPermissions = mock(DataPermissionLookup.class);
    private final DataSandboxService sandboxes = mock(DataSandboxService.class);
    private final WorkbenchPanelRead.Handler customer = mock(WorkbenchPanelRead.Handler.class);
    private final WorkbenchPanelRead.CallerScopedHandler relationship = mock(WorkbenchPanelRead.CallerScopedHandler.class);
    private final WorkbenchPanelRead.CallerScopedHandler customerCreate = mock(WorkbenchPanelRead.CallerScopedHandler.class);
    private final OntologyAgentStore callers = mock(OntologyAgentStore.class);
    private static final String CALLER = "11111111-1111-4111-8111-111111111111";
    private final WorkbenchPanelRead.QueryHandler metricForm = mock(WorkbenchPanelRead.QueryHandler.class);
    private final WorkbenchPanelRead.QueryHandler metricResult = mock(WorkbenchPanelRead.QueryHandler.class);
    private final AdminService metricModel = mock(AdminService.class);
    private final MetricViewService metrics = mock(MetricViewService.class);
    private final OntologyQueryService ontology = new OntologyQueryService(metricModel, null, metrics, null);
    private final AuthorizationPolicyGovernanceController graphGrants = mock(AuthorizationPolicyGovernanceController.class);
    private final WorkbenchPanelRead.Handler graphModel = mock(WorkbenchPanelRead.Handler.class);
    private final WorkbenchPanelRead.Handler graphAction = mock(WorkbenchPanelRead.Handler.class);
    private final WorkbenchPanelRead.Handler handler = mock(WorkbenchPanelRead.Handler.class);
    private final SubjectContext subject = new SubjectContext(
        new VerifiedIdentity("d", "u", AuthorizationService.CredentialLimit.UNRESTRICTED), null, Map.of(), Set.of(), Set.of());
    private final User viewer = mock(User.class);
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private MockMvc http;

    @BeforeEach
    void setup() {
        var executor = mock(WorkbenchPanelReadExecutor.class);
        when(executor.submit(anyLong(), any())).thenAnswer(call ->
            CompletableFuture.supplyAsync(call.<Supplier<?>>getArgument(1), worker));
        when(executor.submitProductGraph(anyLong(), any())).thenAnswer(call ->
            CompletableFuture.supplyAsync(call.<Supplier<?>>getArgument(1), worker));
        when(executor.inReadTransaction(anyLong(), any())).thenAnswer(call -> call.<Supplier<?>>getArgument(1).get());
        class LoggingInterceptors extends InterceptorRegistry {
            HandlerInterceptor[] registered() {
                return getInterceptors().stream().map(HandlerInterceptor.class::cast).toArray(HandlerInterceptor[]::new);
            }
        }
        var logging = new ServiceLogFilter(identity);
        var registry = new LoggingInterceptors();
        logging.addInterceptors(registry);
        var execution = new AgentExecutionController(null, new AgentExecutionSettings(executionIdentity, null));
        WorkbenchPanelRead userOptions = ReflectionTestUtils.invokeMethod(execution, "executionUserOptions");
        WorkbenchPanelRead userResolve = ReflectionTestUtils.invokeMethod(execution, "executionUserResolve");
        var reads = new WorkbenchPanelReads(applications, authorization, executor,
            new QueryAccessService(identity, dataPermissions, null),
            new AgentExecutionScope(new OntologyAgentAccess(null, identity, null, callers)),
            dataPermissions, new ObjectMapper(), List.of(
                new WorkbenchPanelRead("example:type", "query", handler),
                new WorkbenchProductGraphRead(applications, authorization, graphGrants,
                    new WorkbenchPanelRead("platform:ObjectType", "record", graphModel),
                    new WorkbenchPanelRead("platform:Action", "record", graphAction), ontology, executor),
                userOptions, userResolve,
                WorkbenchPanelRead.liveData("customer:ObjectType", "query", customer),
                WorkbenchPanelRead.callerScopedLiveData("customer:Relationship", "neighbors", relationship),
                WorkbenchPanelRead.callerScopedMetadata("customer:ObjectType", "createForm", customerCreate),
                new WorkbenchMetricMetadata().workbenchMetricDescription(ontology),
                WorkbenchPanelRead.Query.callerScoped("platform:MetricView", "parameterForm", WorkbenchPanelRead.QueryExecution.METADATA, metricForm),
                WorkbenchPanelRead.Query.callerScoped("platform:MetricView", "result", WorkbenchPanelRead.QueryExecution.REQUEST_THREAD, metricResult)));
        http = MockMvcBuilders.standaloneSetup(new WorkbenchPanelReadsController(new WorkbenchServiceAuthentication("service"),
            identity, authorization, reads))
            .addInterceptors(registry.registered()).addFilters(logging).build();
    }

    @AfterEach
    void stopWorker() {
        worker.shutdownNow();
    }

    private void authenticated() {
        when(viewer.isEnable()).thenReturn(true);
        when(viewer.getId()).thenReturn("u");
        when(viewer.getDomainId()).thenReturn("d");
        when(identity.verifyWorkbenchPanelViewer()).thenReturn(viewer);
        when(identity.workbenchSubjectId(viewer)).thenReturn("u");
        when(authorization.resolveSubject(subject.identity())).thenReturn(subject);
    }

    private void registration() {
        java.util.function.BiFunction<String, String, PanelReadRegistration> locate = (appId, useId) -> {
            if (appId.equals("app-a") && useId.equals("use")) return REGISTRATION;
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Panel entry not found");
        };
        when(applications.panelReadRegistrations("d")).thenReturn(locate);
    }

    private static MockHttpServletRequestBuilder request(String body) {
        return post(WorkbenchPanelReadsController.PATH).header(WorkbenchServiceAuthentication.HEADER, "service")
            .contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private static String read(String source, String panel, String frame, String selected) {
        return """
            {"source":{"kind":"%s","applicationId":"app-a","useId":"use"},
            "registration":{"panelId":"%s","framePanelId":"%s","inputs":{"selected":{"literal":{"number":1,"key":"%s"}}}},
            "uses":[%s],"call":{"type":"example:type","name":"query","parameters":{"selected":"registered"}}}
            """.formatted(source, panel, frame, selected, FACT);
    }

    private static String batch(String... items) {
        return "{\"kind\":\"read\",\"viewer\":{\"userId\":\"u\",\"domainId\":\"d\"},\"reads\":[" + String.join(",", items) + "]}";
    }

    private static String relationshipRead() {
        return read("registered", "panel", "frame", "registered")
                .replace("example:type", "customer:Relationship").replace("\"query\"", "\"neighbors\"");
    }

    @Test
    void restrictedCustomerRelationshipRestoresCallerWithTheVerifiedUserAndLivePermission() throws Exception {
        authenticated();
        registration();
        when(authorization.decide(same(subject), any())).thenReturn(new Decision(true, null, null));
        var permission = new UserDataPermission();
        when(dataPermissions.getDataPermission("u", "d")).thenReturn(permission);
        var deadline = Instant.now().plusSeconds(60);
        when(callers.serviceCaller(CALLER, "d")).thenReturn(caller("u", List.of("org", "person"), deadline));
        when(relationship.read(any(), any(), any())).thenReturn("owner facts");

        http.perform(request(batch(relationshipRead())).header(AgentExecutionScope.CALLER_HEADER, CALLER))
            .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].payload").value("owner facts"));
        var target = ArgumentCaptor.forClass(io.ontomato.dataengine.service.ExecutionTarget.class);
        verify(relationship).read(eq(subject.withLiveDataPermission(permission)), any(), target.capture());
        assertEquals(List.of("org", "person"), target.getValue().classNames());
        assertEquals("u", target.getValue().executionUserId());
        assertEquals(deadline.toEpochMilli(), target.getValue().expiresAt());
        verify(identity, never()).requireQueryAccess(anyString(), anyString());
    }

    @Test
    void callerScopeDistinguishesAnExplicitEmptyListFromInvalidStoredRecords() throws Exception {
        authenticated();
        registration();
        when(authorization.decide(same(subject), any())).thenReturn(new Decision(true, null, null));
        when(dataPermissions.getDataPermission("u", "d")).thenReturn(new UserDataPermission());
        var deadline = Instant.now().plusSeconds(60);
        var closed = caller("u", List.of("org"), deadline);
        closed.put("closed", true);
        var missing = caller("u", List.of("org"), deadline);
        missing.getJSONObject("input").remove("classNames");
        var invalid = caller("u", List.of("org"), deadline);
        invalid.getJSONObject("input").put("classNames", List.of(123));
        var noInput = caller("u", List.of("org"), deadline);
        noInput.remove("input");
        when(callers.serviceCaller(CALLER, "d")).thenReturn(
            caller("other", List.of("org"), deadline),
            caller("u", List.of("org"), Instant.EPOCH),
            missing, invalid, noInput, closed, caller("u", List.of(), deadline))
            .thenThrow(io.ontomato.dataengine.service.agent.AgentHttpException.missing());
        for (var reason : List.of("Caller belongs to another execution user", "Caller has expired",
                "The stored caller scope is invalid", "The stored caller scope is invalid", "The stored caller scope is invalid"))
            http.perform(request(batch(relationshipRead())).header(AgentExecutionScope.CALLER_HEADER, CALLER))
                .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].status").value("forbidden"))
                .andExpect(jsonPath("$.results[0].error").value(reason));
        http.perform(request(batch(relationshipRead())).header(AgentExecutionScope.CALLER_HEADER, CALLER))
                .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].code").value("RETRIEVAL_RUN_CLOSED"));
        verifyNoInteractions(relationship);
        when(relationship.read(any(), any(), any())).thenReturn("owner facts");
        http.perform(request(batch(relationshipRead())).header(AgentExecutionScope.CALLER_HEADER, CALLER))
                .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].payload").value("owner facts"));
        verify(relationship).read(any(), any(),
                argThat(target -> target.classNames().isEmpty() && target.expiresAt() == deadline.toEpochMilli()));
        http.perform(request(batch(relationshipRead())).header(AgentExecutionScope.CALLER_HEADER, CALLER))
                .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].code").value("NOT_FOUND"))
                .andExpect(jsonPath("$.results[0].payload").doesNotExist());
        verifyNoMoreInteractions(relationship);
    }

    @Test
    void scopedCustomerCreateFormKeepsMetadataAdmissionWithoutLoadingDataPermission() throws Exception {
        authenticated();
        registration();
        when(authorization.decide(same(subject), any())).thenReturn(new Decision(true, null, null));
        when(callers.serviceCaller(CALLER, "d")).thenReturn(caller("u", List.of("org"), Instant.now().plusSeconds(60)));
        when(customerCreate.read(same(subject), any(), any())).thenReturn("model facts");
        String item = read("registered", "panel", "frame", "registered")
                .replace("example:type", "customer:ObjectType").replace("\"query\"", "\"createForm\"");

        http.perform(request(batch(item)).header(AgentExecutionScope.CALLER_HEADER, CALLER))
                .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].payload").value("model facts"));
        verify(customerCreate).read(same(subject), any(), argThat(target -> target.classNames().equals(List.of("org"))));
        verifyNoInteractions(dataPermissions);
        verify(identity, never()).requireQueryAccess(anyString(), anyString());
    }

    @Test
    void callerScopeDoesNotAdmitOtherBatchItemsGrantsOrSandboxRequests() throws Exception {
        authenticated();
        String normal = read("registered", "panel", "frame", "registered");
        var otherItems = List.of(batch(normal), batch(relationshipRead(), normal),
                batch(relationshipRead().replace("\"uses\"", "\"visibleKinds\":[],\"uses\"")));
        for (var batch : otherItems)
            http.perform(request(batch).header(AgentExecutionScope.CALLER_HEADER, CALLER)).andExpect(status().isForbidden());
        http.perform(request(batch(relationshipRead())).header(AgentExecutionScope.CALLER_HEADER, CALLER)
                .requestAttr(QueryGrantService.ATTRIBUTE, new JSONObject())).andExpect(status().isUnauthorized());
        http.perform(request(batch(relationshipRead())).header(AgentExecutionScope.CALLER_HEADER, CALLER)
                .header(PreviewExecution.HEADER, "{}")).andExpect(status().isUnauthorized());
        verifyNoInteractions(callers, relationship, handler, dataPermissions);
    }

    private static JSONObject caller(String executor, List<String> classes, Instant deadline) {
        return JSONObject.of("user_id", "initiator", "deadline", deadline.toString(), "closed", false,
                "input", JSONObject.of("executionUserId", executor, "classNames", classes));
    }

    private static String metricRead(String name, String id) {
        return read("registered", "panel", "frame", "registered")
            .replace("example:type", "platform:MetricView").replace("\"query\"", "\"" + name + "\"")
            .replace("\"selected\":\"registered\"", "\"primaryKey\":\"" + id + "\",\"parameters\":{\"threshold\":35}");
    }

    private void metricAccess() {
        authenticated();
        registration();
        when(identity.getCurrentCredentialExpiresAt()).thenReturn(null);
        when(authorization.decide(same(subject), any())).thenReturn(new Decision(true, null, null));
        var permission = new UserDataPermission();
        permission.setFullData(true);
        when(dataPermissions.getDataPermission("u", "d")).thenReturn(permission);
    }

    private void stubMetric(String className) {
        var source = new ABCHarnessProgramOutKeyRef();
        source.setClassName(className);
        source.setAttrName("id");
        source.setKey("value");
        source.setStatCal(false);
        source.setAsGroupBy(false);
        var returns = new ReturnDef();
        returns.setOutKeyRefs(List.of(source));
        var threshold = new Parameter();
        threshold.setName("threshold");
        threshold.setType(Parameter.TYPE_NUMBER);
        var function = new Function();
        function.setReturnDef(returns);
        function.setParameters(List.of(threshold));
        var metric = new MetricView();
        metric.setId(className);
        metric.setName(className);
        metric.setStatus(MetricView.STATUS_PUBLISHED);
        metric.setFunction(function);
        when(metrics.requireExecutable(eq(className), argThat(user -> "u".equals(user.getId()) && "d".equals(user.getDomainId()))))
            .thenReturn(metric);
    }

    @Test
    void restrictedMetricResultAndDescribeUseTheStoredSourceScope() throws Exception {
        metricAccess();
        var unscopedQuery = metricRead("builderTestStatus", "org").replace("platform:MetricView", "platform:Application");
        for (var body : List.of(batch(unscopedQuery), batch(metricRead("result", "org"), metricRead("describe", "org"))))
            http.perform(request(body).header(AgentExecutionScope.CALLER_HEADER, CALLER)).andExpect(status().isForbidden());
        verifyNoInteractions(callers, dataPermissions);
        stubMetric("org");
        stubMetric("person");
        when(metricModel.getJSONRule("d")).thenReturn(Map.of("classDef", List.of(
            JSONObject.of("className", "org", "attrs", List.of(JSONObject.of("name", "id", "enable", true))),
            JSONObject.of("className", "person", "attrs", List.of(JSONObject.of("name", "id", "enable", true))))));
        var deadline = Instant.now().plusSeconds(60);
        when(callers.serviceCaller(CALLER, "d")).thenReturn(caller("u", List.of("org"), deadline));
        var outputs = mock(QueryOutputService.class);
        var requestThread = Thread.currentThread();
        when(outputs.executeMetric(any(), any(), any())).thenAnswer(call -> {
            assertSame(requestThread, Thread.currentThread());
            var access = call.<QueryAccessService.Access>getArgument(1);
            assertEquals(List.of("org"), access.classNames());
            assertEquals("u", access.executionUserId());
            assertEquals(deadline.toEpochMilli(), access.expiresAt());
            return JSONObject.of("rows", List.of());
        });
        var resultOwner = new WorkbenchMetricResult().workbenchMetricResultRead(ontology, outputs).handler();
        when(metricResult.read(any(), any(), any())).thenAnswer(call -> resultOwner.read(
            call.getArgument(0), call.getArgument(1), call.getArgument(2)));

        for (var name : List.of("result", "describe")) {
            http.perform(request(batch(metricRead(name, "org"))).header(AgentExecutionScope.CALLER_HEADER, CALLER))
                .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].status").value("ready"));
            http.perform(request(batch(metricRead(name, "person"))).header(AgentExecutionScope.CALLER_HEADER, CALLER))
                .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].status").value("forbidden"));
        }
        verify(outputs).executeMetric(argThat(body -> "org".equals(body.getString("id"))), any(), any());
        verifyNoMoreInteractions(outputs);
    }

    @Test
    void productGraphKeepsIndependentOwnerFactsWithAndWithoutCallerScope() throws Exception {
        metricAccess();
        stubMetric("org");
        stubMetric("person");
        when(metricModel.getJSONRule("d")).thenReturn(Map.of("classDef", List.of(
            JSONObject.of("className", "org", "attrs", List.of(JSONObject.of("name", "id", "enable", true))),
            JSONObject.of("className", "person", "attrs", List.of(JSONObject.of("name", "id", "enable", true))))));
        var range = new ObjectVisibilityRange(false, null, Set.of("panel", "outside"), false);
        when(authorization.readObjectRanges(same(subject), any(), eq(Set.of(Verb.USE))))
            .thenReturn(Map.of(Verb.USE, range));
        var candidates = List.of(new ApplicationCatalog.ProductGraphCandidate("app", true, JSONObject.of("id", "app"), List.of()));
        when(applications.productGraphCandidates(same(subject), eq(Set.of("panel")))).thenReturn(candidates);
        when(graphGrants.productGraphAuthorization(same(subject), same(candidates)))
            .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "Read denied"));
        when(graphModel.read(same(subject), eq(Map.of("primaryKey", "org")))).thenReturn(Map.of("view",
            new ObjectTypeView("org", "Organization", "", 0, 0, 0, null, null)));
        when(graphAction.read(same(subject), eq(Map.of("primaryKey", "approve"))))
            .thenReturn(new ObjectMapper().createObjectNode().put("name", "Approve"));
        when(graphAction.read(same(subject), eq(Map.of("primaryKey", "hidden"))))
            .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "Action definition denied"));
        when(callers.serviceCaller(CALLER, "d")).thenReturn(caller("u", List.of("org"), Instant.now().plusSeconds(60)));
        var requestThread = Thread.currentThread();
        when(identity.getCurrentCredentialExpiresAt()).thenAnswer(call -> {
            assertSame(requestThread, Thread.currentThread());
            return null;
        });
        String item = read("registered", "panel", "frame", "registered")
            .replace("example:type", "platform:ObjectType").replace("\"query\"", "\"productGraph\"")
            .replace("\"selected\":\"registered\"", """
                "panelIds":["panel"],"projectionIds":[],"objectTypes":["org"],"actions":["approve","hidden"],"metrics":["org","person"]
                """);

        http.perform(request(batch(item, metricRead("describe", "org"))).header(AgentExecutionScope.CALLER_HEADER, CALLER))
            .andExpect(status().isForbidden());
        verifyNoInteractions(callers, graphGrants, graphModel, graphAction);
        for (boolean scoped : List.of(false, true)) {
            clearInvocations(applications, graphGrants, identity);
            var req = request(batch(item));
            if (scoped) req.header(AgentExecutionScope.CALLER_HEADER, CALLER);
            http.perform(req).andExpect(status().isOk())
                .andExpect(jsonPath("$.results[0].status").value("ready"))
                .andExpect(jsonPath("$.results[0].payload.panels.payload.objectIds[0]").value("panel"))
                .andExpect(jsonPath("$.results[0].payload.panels.payload.objectIds.length()").value(1))
                .andExpect(jsonPath("$.results[0].payload.applications.payload[0].id").value("app"))
                .andExpect(jsonPath("$.results[0].payload.authorization.status").value("forbidden"))
                .andExpect(jsonPath("$.results[0].payload.objectTypes.org.payload").value("Organization"))
                .andExpect(jsonPath("$.results[0].payload.actions.approve.payload").value("Approve"))
                .andExpect(jsonPath("$.results[0].payload.actions.hidden.status").value("forbidden"))
                .andExpect(jsonPath("$.results[0].payload.metrics.org.payload").value("org"))
                .andExpect(jsonPath("$.results[0].payload.metrics.person.status").value(scoped ? "forbidden" : "ready"));
            verify(applications).productGraphCandidates(subject, Set.of("panel"));
            verify(graphGrants).productGraphAuthorization(subject, candidates);
            verify(identity).getCurrentCredentialExpiresAt();
        }
        verify(callers).serviceCaller(CALLER, "d");
    }

    @Test
    void restrictedMetricFormKeepsFieldsAndRejectsForeignClosedOrExpiredCallers() throws Exception {
        metricAccess();
        stubMetric("person");
        var deadline = Instant.now().plusSeconds(60);
        var valid = caller("u", List.of("org"), deadline);
        var closed = caller("u", List.of("org"), deadline);
        closed.put("closed", true);
        when(callers.serviceCaller(CALLER, "d")).thenReturn(valid, caller("other", List.of("org"), deadline), closed,
            caller("u", List.of("org"), Instant.EPOCH), caller("u", List.of(), deadline), valid);
        var forms = new MetricParameterForms(metrics, ontology, mock(SubjectValueResolver.class));
        var formOwner = new WorkbenchMetricMetadata().workbenchMetricParameterForm(forms).handler();
        var requestThread = Thread.currentThread();
        when(metricForm.read(any(), any(), any())).thenAnswer(call -> {
            assertNotSame(requestThread, Thread.currentThread());
            return formOwner.read(call.getArgument(0), call.getArgument(1), call.getArgument(2));
        });
        String item = batch(metricRead("parameterForm", "person"));
        http.perform(request(item).header(AgentExecutionScope.CALLER_HEADER, CALLER))
            .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].payload.values.threshold").value("35"))
            .andExpect(jsonPath("$.results[0].payload.fields.length()").value(1));
        http.perform(request(item).header(AgentExecutionScope.CALLER_HEADER, CALLER))
            .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].status").value("forbidden"));
        http.perform(request(item).header(AgentExecutionScope.CALLER_HEADER, CALLER))
            .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].code").value("RETRIEVAL_RUN_CLOSED"));
        http.perform(request(item).header(AgentExecutionScope.CALLER_HEADER, CALLER))
            .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].code").value("CALLER_EXPIRED"));
        http.perform(request(item).header(AgentExecutionScope.CALLER_HEADER, CALLER))
            .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].payload.values.threshold").value("35"));
        when(identity.getCurrentCredentialExpiresAt()).thenReturn(1L);
        http.perform(request(item).header(AgentExecutionScope.CALLER_HEADER, CALLER))
            .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].code").value("UNAUTHENTICATED"));
        verify(metricForm, times(2)).read(any(), any(), any());
    }

    @Test
    void refusesAnAuthenticatedViewerWithoutADomainBeforeLookingUpEntries() throws Exception {
        when(viewer.isEnable()).thenReturn(true);
        when(viewer.getId()).thenReturn("u");
        when(identity.verifyWorkbenchPanelViewer()).thenReturn(viewer);
        var locate = """
            {"kind":"locate","entries":[{"applicationId":"app-a","useId":"use"}]}
            """;
        http.perform(request(locate)).andExpect(status().isForbidden());
        verify(identity).verifyWorkbenchPanelViewer();
        verifyNoInteractions(applications, authorization);

        when(identity.verifyWorkbenchPanelViewer()).thenReturn(null);
        http.perform(request(locate)).andExpect(status().isUnauthorized());
    }

    @Test
    void locateReturnsIdentityAndRegistrationsInOrderWithoutResolvingSubjectOrAdmittingUse() throws Exception {
        authenticated();
        registration();
        when(viewer.getUserName()).thenReturn("Viewer name");
        http.perform(request("""
                {"kind":"locate","entries":[{"applicationId":"missing","useId":"use"},
                {"applicationId":"app-a","useId":"use"},{"applicationId":"app-a"}]}
                """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.viewer.userId").value("u"))
            .andExpect(jsonPath("$.viewer.domainId").value("d"))
            .andExpect(jsonPath("$.viewer.userName").value("Viewer name"))
            .andExpect(jsonPath("$.entries[0].kind").value("error"))
            .andExpect(jsonPath("$.entries[0].status").value(404))
            .andExpect(jsonPath("$.entries[1].kind").value("ready"))
            .andExpect(jsonPath("$.entries[1].entry.applicationId").value("app-a"))
            .andExpect(jsonPath("$.entries[1].entry.use.panelId").value("panel"))
            .andExpect(jsonPath("$.entries[1].entry.use.inputs.selected.literal.key").value("registered"))
            .andExpect(jsonPath("$.entries[1].entry.framePanelId").value("frame"))
            .andExpect(jsonPath("$.entries[1].skillSourceRefs").doesNotExist())
            .andExpect(jsonPath("$.entries[2].status").value(400));
        verify(identity).verifyWorkbenchPanelViewer();
        verify(identity, never()).getCurrentUser();
        verify(applications).panelReadRegistrations("d");
        verifyNoInteractions(authorization, handler);
    }

    @Test
    void changedRegistrationNeverCallsUseOrOwnerAndResultsKeepInputOrder() throws Exception {
        authenticated();
        registration();
        when(viewer.getId()).thenReturn("admin");
        var readSubject = subject.withJavaUserId("admin");
        when(authorization.decide(eq(readSubject), any())).thenReturn(new Decision(true, null, null));
        when(handler.read(eq(readSubject), any())).thenAnswer(call -> {
            assertEquals(Locale.FRANCE, LocaleContextHolder.getLocale());
            return Map.of("total", 1);
        });
        http.perform(request(batch(read("registered", "old-panel", "frame", "registered"),
                    read("frame", "panel", "old-frame", "registered"), read("registered", "panel", "frame", "old-input"),
                    read("registered", "panel", "frame", "registered")))
                .header(HttpHeaders.ACCEPT_LANGUAGE, "fr-FR"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.viewer.userId").value("u"))
            .andExpect(jsonPath("$.viewer.domainId").value("d"))
            .andExpect(jsonPath("$.results[0].code").value("PANEL_ENTRY_CHANGED"))
            .andExpect(jsonPath("$.results[1].code").value("PANEL_ENTRY_CHANGED"))
            .andExpect(jsonPath("$.results[2].code").value("PANEL_ENTRY_CHANGED"))
            .andExpect(jsonPath("$.results[3].status").value("ready"))
            .andExpect(jsonPath("$.results[3].payload.total").value(1));
        assertNull(worker.submit(LocaleContextHolder::getLocaleContext).get());
        verify(identity).verifyWorkbenchPanelViewer();
        verify(identity, never()).getCurrentUser();
        verify(authorization).resolveSubject(subject.identity());
        verify(applications).panelReadRegistrations("d");
        verify(authorization).decide(eq(readSubject), any());
        verify(handler).read(readSubject, Map.of("selected", "registered"));
    }

    @Test
    void mismatchedViewerNeverReadsRegistrationsOrResolvesSubject() throws Exception {
        authenticated();
        var body = batch(read("registered", "panel", "frame", "registered")).replace("\"userId\":\"u\"", "\"userId\":\"different\"");
        http.perform(request(body)).andExpect(status().isForbidden());
        verify(identity).verifyWorkbenchPanelViewer();
        verifyNoInteractions(applications, authorization, handler);
    }

    @Test
    void deniedUseNeverCallsOwner() throws Exception {
        authenticated();
        registration();
        when(authorization.decide(same(subject), any())).thenReturn(new Decision(false, "OBJECT_FORBIDDEN", "denied"));
        http.perform(request(batch(read("registered", "panel", "frame", "registered"))))
            .andExpect(status().isOk()).andExpect(jsonPath("$.results[0].status").value("forbidden"))
            .andExpect(jsonPath("$.results[0].code").value("OBJECT_FORBIDDEN"));
        verifyNoInteractions(handler);
    }

    @Test
    void liveDataIsCapturedOnceAfterUseWhileMetricsKeepTheirOwnAdmission() throws Exception {
        authenticated();
        registration();
        var requestThread = Thread.currentThread();
        var customerRead = read("registered", "panel", "frame", "registered").replace("example:type", "customer:ObjectType");
        var metricMetadata = customerRead.replace("customer:ObjectType", "platform:MetricView").replace("\"query\"", "\"parameterForm\"");
        var metricOutput = metricMetadata.replace("\"parameterForm\"", "\"result\"");

        http.perform(request(batch())).andExpect(status().isOk()).andExpect(jsonPath("$.results").isEmpty());
        verifyNoInteractions(applications, authorization, dataPermissions);
        when(authorization.decide(same(subject), any())).thenReturn(new Decision(false, "OBJECT_FORBIDDEN", "denied"));
        http.perform(request(batch(customerRead, metricMetadata))).andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].status").value("forbidden"))
            .andExpect(jsonPath("$.results[1].status").value("forbidden"));
        verifyNoInteractions(dataPermissions, customer, metricForm, metricResult);
        verify(identity, never()).requireQueryAccess("u", "d");

        var permission = new UserDataPermission();
        permission.setFullData(true);
        when(authorization.decide(same(subject), any())).thenReturn(new Decision(true, null, null));
        when(dataPermissions.getDataPermission("u", "d")).thenAnswer(call -> {
            assertSame(requestThread, Thread.currentThread());
            return permission;
        });
        when(customer.read(any(), any())).thenAnswer(call -> {
            assertNotSame(requestThread, Thread.currentThread());
            assertSame(permission, call.<SubjectContext>getArgument(0).liveDataPermission());
            return Map.of("customerRow", "visible");
        });
        doThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "Query access denied")).when(identity).requireQueryAccess("u", "d");
        http.perform(request(batch(customerRead, customerRead))).andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].payload.customerRow").value("visible"))
            .andExpect(jsonPath("$.results[1].status").value("ready"));
        verify(dataPermissions).getDataPermission("u", "d");
        verify(identity, never()).requireQueryAccess("u", "d");

        clearInvocations(dataPermissions);
        http.perform(request(batch(metricMetadata, customerRead, metricOutput))).andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].error").value("Query access denied"))
            .andExpect(jsonPath("$.results[1].status").value("ready"))
            .andExpect(jsonPath("$.results[2].status").value("forbidden"));
        verify(dataPermissions).getDataPermission("u", "d");
        verify(identity).requireQueryAccess("u", "d");
        verify(identity, never()).getCurrentCredentialExpiresAt();
        verifyNoInteractions(metricForm, metricResult);

        clearInvocations(dataPermissions, identity);
        doNothing().when(identity).requireQueryAccess("u", "d");
        when(identity.getCurrentCredentialExpiresAt()).thenReturn(123L);
        when(metricForm.read(any(), any(), any())).thenAnswer(call -> {
            assertNotSame(requestThread, Thread.currentThread());
            assertTrue(call.<QueryAccessService.Access>getArgument(0).permission().isFullData());
            return Map.of("metricForm", "ready");
        });
        when(metricResult.read(any(), any(), any())).thenAnswer(call -> {
            assertSame(requestThread, Thread.currentThread());
            var access = call.<QueryAccessService.Access>getArgument(0);
            assertTrue(access.permission().isFullData());
            assertEquals(123L, access.expiresAt());
            return Map.of("metricResult", "ready");
        });
        http.perform(request(batch(metricMetadata, customerRead, metricOutput))).andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].payload.metricForm").value("ready"))
            .andExpect(jsonPath("$.results[1].status").value("ready"))
            .andExpect(jsonPath("$.results[2].payload.metricResult").value("ready"));
        verify(dataPermissions).getDataPermission("u", "d");
        verify(identity).verifyWorkbenchPanelViewer();
        verify(identity).requireQueryAccess("u", "d");
        verify(identity).getCurrentCredentialExpiresAt();
    }


    @Test
    void executionUserReadsReuseEffectiveAdministrationAndResolveSelectionsWithoutReauthentication() throws Exception {
        authenticated();
        registration();
        when(authorization.decide(any(), any())).thenReturn(new Decision(true, null, null));
        var effectiveAdmin = new SubjectContext(subject.identity(),
            new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), true, false), Map.of(), Set.of(), Set.of());
        var ordinary = new SubjectContext(subject.identity(),
            new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false, false), Map.of(), Set.of(), Set.of());
        when(authorization.resolveSubject(subject.identity())).thenReturn(effectiveAdmin, ordinary);
        var id = "11111111-1111-4111-8111-111111111111";
        when(executionIdentity.options("d", "ali", 2, 10)).thenReturn(List.of(new AgentExecutionIdentity.Option(id, "Alice")));
        when(executionIdentity.selected("d", id)).thenReturn(new AgentExecutionIdentity.Selected(id, "Alice", false, "disabled"));
        var path = read("registered", "panel", "frame", "registered");
        var options = path.replace("example:type", "platform:User").replace("\"query\"", "\"options\"")
            .replace("{\"selected\":\"registered\"}", "{\"keyword\":\"ali\",\"pageNum\":2,\"pageSize\":10}");
        var resolve = path.replace("example:type", "platform:User").replace("\"query\"", "\"resolve\"")
            .replace("{\"selected\":\"registered\"}", "{\"ids\":[\"" + id + "\",\"" + id + "\"]}");

        http.perform(request(batch(options))).andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].payload.length()").value(1))
            .andExpect(jsonPath("$.results[0].payload[0].id").value(id));
        http.perform(request(batch(options, resolve))).andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].payload").isEmpty())
            .andExpect(jsonPath("$.results[1].payload[0].reason").value("disabled"))
            .andExpect(jsonPath("$.results[1].payload[1].id").value(id));
        verify(executionIdentity).options("d", "ali", 2, 10);
        verify(executionIdentity, times(2)).selected("d", id);
        verifyNoMoreInteractions(executionIdentity);
        verify(identity, times(2)).verifyWorkbenchPanelViewer();
        verify(identity, never()).getCurrentUser();
    }

    @Test
    void ownerErrorsKeepTheirCodesAndDoNotEraseOtherResults() throws Exception {
        authenticated();
        registration();
        when(authorization.decide(same(subject), any())).thenReturn(new Decision(true, null, null));
        when(handler.read(same(subject), any()))
            .thenThrow(OntologyModelException.notFound("ONTOLOGY_OBJECT_NOT_FOUND", "Object missing"))
            .thenThrow(new OwnerRefusal("USER_NOT_FOUND", "Member missing"))
            .thenReturn(Map.of("total", 1));
        var item = read("registered", "panel", "frame", "registered");
        http.perform(request(batch(item, item, item))).andExpect(status().isOk())
            .andExpect(jsonPath("$.results[0].status").value("empty"))
            .andExpect(jsonPath("$.results[0].code").value("ONTOLOGY_OBJECT_NOT_FOUND"))
            .andExpect(jsonPath("$.results[1].status").value("error"))
            .andExpect(jsonPath("$.results[1].code").value("USER_NOT_FOUND"))
            .andExpect(jsonPath("$.results[2].payload.total").value(1));
    }

    @Test
    void openReturnsRegistrationAndTheSameSubjectsDefinitionRangesWithoutHints() throws Exception {
        authenticated();
        when(applications.openPanelEntry("/ontology", null, null, subject)).thenReturn(JSONObject.of(
            "use", REGISTRATION.use(), "framePanelId", "frame", "allowStandalone", false));
        when(authorization.readObjectRanges(subject, Kind.PANEL, Set.of(Verb.USE))).thenReturn(
            Map.of(Verb.USE, new AuthorizationService.ObjectVisibilityRange(true, "u", Set.of("extra"), false)));
        http.perform(request("""
                {"kind":"open","entry":{"path":"/ontology"},"visibleKinds":[{"kind":"PANEL","verbs":["USE"]}]}
                """))
            .andExpect(status().isOk()).andExpect(jsonPath("$.entry.use.panelId").value("panel"))
            .andExpect(jsonPath("$.entry.allowStandalone").value(false))
            .andExpect(jsonPath("$.entry.rootPanelId").doesNotExist())
            .andExpect(jsonPath("$.entry.registrationRevision").doesNotExist())
            .andExpect(jsonPath("$.visibility.PANEL.USE.objectIds[0]").value("extra"))
            .andExpect(jsonPath("$.subject").doesNotExist()).andExpect(jsonPath("$.roles").doesNotExist());
        verify(authorization).resolveSubject(subject.identity());
    }

    @Test
    void requiresServiceAndOrdinaryUserCredentials() throws Exception {
        var unauthenticated = post(WorkbenchPanelReadsController.PATH).contentType(MediaType.APPLICATION_JSON)
            .content("{\"kind\":\"locate\",\"entries\":[]}");
        http.perform(unauthenticated).andExpect(status().isForbidden());
        verifyNoInteractions(identity, authorization);
        http.perform(unauthenticated.header(WorkbenchServiceAuthentication.HEADER, "service")).andExpect(status().isUnauthorized());
        http.perform(unauthenticated.header(PreviewExecution.HEADER, "sandbox")).andExpect(status().isUnauthorized());
        verify(identity).verifyWorkbenchPanelViewer();
        verifyNoInteractions(authorization, applications, handler);
    }
}
