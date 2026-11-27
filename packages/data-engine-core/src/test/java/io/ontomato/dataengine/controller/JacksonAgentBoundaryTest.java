package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.config.BaseControllerAdvice;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorRebuildState;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.agent.ActionCreationService;
import io.ontomato.dataengine.service.agent.AgentCaller;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.OntologyAgentAccess;
import io.ontomato.dataengine.service.agent.OntologyAgentHost;
import io.ontomato.dataengine.service.agent.OntologyAgentLabels;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.agent.OntologyRetrievalService;
import io.ontomato.dataengine.service.agent.PlatformAuthoringService;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class JacksonAgentBoundaryTest {
  @Test
  void agentCatalogueUsesCurrentDomainActionCreateWithoutConsultingKnowledgePermissions() throws Exception {
    var identity = mock(IdentityService.class);
    var caller = new OntologyAgentStore.Owner("creator", "domain-a");
    when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser(caller.userId(), caller.domainId()));
    var subjects = mock(AuthorizationSubjects.class);
    var policies = mock(AuthorizationStore.class);
    var roles = Set.of("member");
    var policy = "action-policy";
    when(subjects.resolveRoles(caller.domainId(), caller.userId()))
        .thenReturn(new RoleResolution(roles, roles, List.of(), Set.of(), Map.of(), false, false));
    when(policies.policies(caller.domainId(), roles))
        .thenReturn(List.of(new PolicyRef("member", policy, PolicyKind.OBJECT)));
    var createTarget = new ObjectTarget(caller.domainId(), Kind.ACTION, "");
    when(policies.objectGrants(createTarget, Verb.CREATE, Set.of(policy)))
        .thenReturn(List.of(new ObjectGrant(policy, createTarget, Verb.CREATE, null)), List.of());

    var authorization = new AuthorizationService(subjects, policies, null, null, null);
    var retrieval = mock(OntologyRetrievalService.class);
    when(retrieval.canUse(caller)).thenReturn(true);
    var labels = mock(OntologyAgentLabels.class);
    when(labels.localize(anyString(), any(), anyString())).thenAnswer(call -> call.getArgument(1));
    var host = new OntologyAgentHost(null, null, retrieval, null, null, labels, authorization);
    var access = new OntologyAgentAccess(null, identity, null, null);
    var mvc = statusBoundary(host, access);
    var action = "$.agents[?(@.id == '%s')]".formatted(ActionCreationService.AGENT);
    var retriever = "$.agents[?(@.id == '%s')]".formatted(OntologyAgentStore.RETRIEVER);

    mvc.perform(get("/ontology/ai/agents").header("X-Domain-Id", "other-domain"))
        .andExpect(status().isOk())
        .andExpect(jsonPath(action).isNotEmpty())
        .andExpect(jsonPath(retriever).isNotEmpty());

    mvc.perform(get("/ontology/ai/agents"))
        .andExpect(status().isOk())
        .andExpect(jsonPath(action).isEmpty())
        .andExpect(jsonPath(retriever).isNotEmpty());
  }

  @Test
  void authoringContextExplainsWhyVectorSearchIsUnavailable() throws Exception {
    var config = mock(BusinessConfig.class);
    when(config.getLang()).thenReturn("en");
    var configs = mock(BusinessConfigService.class);
    when(configs.get("domain-a")).thenReturn(config);
    var state = mock(VectorRebuildState.class);
    when(state.getStatus()).thenReturn(VectorRebuildState.Status.PENDING);
    var gate = spy(new VectorRetrievalGate());
    doReturn(state).when(gate).effectiveState("domain-a");
    var message = "向量尚未就绪，请在模型配置中开始或继续重建。";
    var messages = mock(LangService.class);
    when(messages.get("en", "Vector.rebuildRequired")).thenReturn("Vector search is paused.");
    when(messages.get("zh-CN", "Vector.rebuildRequired")).thenReturn(message);
    ReflectionTestUtils.setField(gate, "businessConfigService", configs);
    ReflectionTestUtils.setField(gate, "langService", messages);

    var access = mock(OntologyAgentAccess.class);
    var platform = mock(PlatformAuthoringService.class);
    when(platform.operateExternal(anyString(), eq("metric-view"), eq("context"), any(), any()))
        .thenAnswer(call -> {
          gate.requireRetrievable("domain-a");
          return null;
        });
    var controller = new OntologyGenerationController(null, null, access, null, null, null);
    ReflectionTestUtils.setField(controller, "platform", platform);
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new OntologyAgentErrors(messages), new BaseControllerAdvice())
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();

    mvc.perform(post("/ontology/ai/generation/{run}/authoring/metric-view/context",
            "11111111-1111-4111-8111-111111111111")
        .header("Accept-Language", "zh-CN").contentType(MediaType.APPLICATION_JSON).content("{}"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.error.code").value("VECTOR_NOT_READY"))
        .andExpect(jsonPath("$.error.message").value(message));
  }

  @Test
  void actionGatePassesDeclaredClassesSeparatelyFromTheCallerAuthority() throws Exception {
    var generation = mock(OntologyGenerationService.class);
    var access = mock(OntologyAgentAccess.class);
    var owner = new OntologyAgentStore.Owner("author", "domain-a");
    var authority = new QueryAccessService.Access(new QueryAccessService.GrantUser("author", "domain-a"),
        null, null, null, null, List.of("student", "workflow_run", "unrelated"));
    when(access.current(any())).thenReturn(new OntologyAgentAccess.Context(owner, authority, null, null, "en", null, null));
    var controller = new OntologyGenerationController(generation, null, access, null, null, null);
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new OntologyAgentErrors((language, key) -> key))
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();

    mvc.perform(post("/ontology/ai/generation/gates").contentType(MediaType.APPLICATION_JSON)
        .content("""
            {"kind":"action","classNames":["workflow_run"]}
            """)).andExpect(status().isOk());
    verify(generation).openExternal(eq("action"), anyString(), isNull(), eq(owner), eq(List.of("workflow_run")), eq(authority));

    mvc.perform(post("/ontology/ai/generation/gates").contentType(MediaType.APPLICATION_JSON)
        .content("""
            {"kind":"action","classNames":[42]}
            """)).andExpect(status().isBadRequest());
  }

  @Test
  void retrievalPreparePreservesAnExplicitlyUnknownConditionMapping() throws Exception {
    var retrieval = mock(OntologyRetrievalService.class);
    when(retrieval.prepareRun(anyString(), anyString(), any(), anyString(), any(), anyString(), any()))
        .thenAnswer(call -> {
          var input = call.getArgument(2, JSONObject.class);
          var context = call.getArgument(4, JSONObject.class);
          return OntologyRetrievalService.input(JSONObject.of("question", input.getString("content"),
              "queryIntent", context.getJSONObject("queryIntent")));
        });
    var controller = new AgentChannelController(mock(AgentCaller.class), null, null, null,
        mock(WorkbenchServiceAuthentication.class), retrieval, null, null, null, null, null, null);
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new OntologyAgentErrors((language, key) -> key))
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    String request = """
        {"mode":"run","language":"en","agent":{"providerId":"ontology","agentId":"%s"},
         "sessionId":"11111111-1111-4111-8111-111111111111","runId":"22222222-2222-4222-8222-222222222222",
         "inputId":"33333333-3333-4333-8333-333333333333","actor":{},"authority":{"executionKind":"live"},
         "root":{"runId":"22222222-2222-4222-8222-222222222222"},
         "input":{"role":"notification","kind":"agent-message","content":"Count active staff"},
         "context":{"queryIntent":{"schema":"ontomato.query-intent.v1",
           "conditions":[{"id":"employment","quote":"active","mapping":null}],"outputs":["Count"]}}}
        """.formatted(OntologyAgentStore.RETRIEVER);

    var response = mvc.perform(post("/platform/agent-channel/prepare")
        .header("X-Domain-Id", "domain-a").contentType(MediaType.APPLICATION_JSON).content(request))
        .andExpect(status().isOk()).andReturn().getResponse();
    var condition = JSON.parseObject(response.getContentAsString()).getJSONObject("queryIntent")
        .getJSONArray("conditions").getJSONObject(0);
    assertTrue(condition.containsKey("mapping"));
    assertNull(condition.get("mapping"));

    mvc.perform(post("/platform/agent-channel/prepare").header("X-Domain-Id", "domain-a")
        .contentType(MediaType.APPLICATION_JSON).content(request.replace(",\"mapping\":null", "")))
        .andExpect(status().isBadRequest());
  }

  @Test
  void httpDatasetSettlementAcceptsNestedRecipeAndParameterObjects() throws Exception {
    var authorization = mock(QueryAccessService.class);
    var user = new QueryAccessService.GrantUser("reader", "domain-a");
    var access = new QueryAccessService.Access(user, null, null, null, null);
    when(authorization.access(any())).thenReturn(access);
    var metrics = mock(MetricViewService.class);
    var ontology = mock(OntologyQueryService.class);
    var generation = mock(OntologyGenerationService.class);
    var metric = boundaryMetric();
    when(ontology.metric(eq("metric-1"), eq("revision-1"), any())).thenReturn(metric);
    when(generation.executionAccess("domain-a")).thenReturn(access);
    when(metrics.appendBinding(eq("metric-1"), any(), eq("domain-a"))).thenReturn(metric);
    var settlement = new MetricSettlementService(metrics, ontology, generation,
        new SubjectValueResolver(mock(SubjectAttributeLookup.class)));
    var sessions = mock(BackendSessionEntrance.class);
    when(sessions.beginNewSession(any())).thenReturn("settlement-session");
    var controller = new MetricSettlementController(mock(WorkbenchServiceAuthentication.class),
        authorization, settlement, sessions);
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new OntologyAgentErrors((language, key) -> key))
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var response = mvc.perform(post("/ontology/ai/metrics/settle-from-dataset")
        .contentType(MediaType.APPLICATION_JSON).content("""
            {"question":"Regional sales in 2026","recipe":{"kind":"metric","metricId":"metric-1",
              "revision":"revision-1","parameters":{"year":2026,"regions":["north","south"]}}}
            """))
        .andExpect(status().isOk()).andReturn().getResponse();
    var result = JSON.parseObject(response.getContentAsString());
    assertEquals("metric-1", result.getString("metricId"));
    var binding = org.mockito.ArgumentCaptor.forClass(MetricViewBinding.class);
    verify(metrics).appendBinding(eq("metric-1"), binding.capture(), eq("domain-a"));
    assertInstanceOf(Number.class, binding.getValue().getParameters().get("year"));
    assertEquals(List.of("north", "south"), binding.getValue().getParameters().get("regions"));
    verify(sessions).endSession("settlement-session");
  }

  @Test
  void httpMetricParameterTextsAreParsedAfterJacksonBinding() throws Exception {
    var authorization = mock(QueryAccessService.class);
    var user = new QueryAccessService.GrantUser("reader", "domain-a");
    var access = new QueryAccessService.Access(user, null, null, null, null);
    when(authorization.access(any())).thenReturn(access);
    var ontology = mock(OntologyQueryService.class);
    when(ontology.metric(eq("metric-1"), eq("revision-1"), any())).thenReturn(boundaryMetric());
    var forms = new MetricParameterForms(mock(MetricViewService.class), ontology,
        new SubjectValueResolver(mock(SubjectAttributeLookup.class)));
    var outputs = mock(QueryOutputService.class);
    var controller = new OntologyQueryController(authorization, ontology, outputs, mock(QueryJobService.class));
    ReflectionTestUtils.setField(controller, "metricForms", forms);
    var mvc = MockMvcBuilders.standaloneSetup(controller)
        .setControllerAdvice(new OntologyQueryErrors())
        .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    var response = mvc.perform(post("/ontology/query/metrics/parse-parameters")
        .contentType(MediaType.APPLICATION_JSON).content("""
            {"id":"metric-1","revision":"revision-1",
              "parameters":{"year":2025,"regions":["north","south"]},"values":{"year":"2026"}}
            """))
        .andExpect(status().isOk()).andReturn().getResponse();
    var result = JSON.parseObject(response.getContentAsString());
    assertTrue(result.getJSONArray("errors").isEmpty());
    assertInstanceOf(Number.class, result.getJSONObject("parameters").get("year"));
    assertEquals(2026, result.getJSONObject("parameters").getIntValue("year"));
    assertEquals(List.of("north", "south"), result.getJSONObject("parameters").get("regions"));
    verifyNoInteractions(outputs);
  }

  @Test
  void httpSessionStatusRequestBindsItsArrayAsAList() throws Exception {
    String first = "11111111-1111-4111-8111-111111111111";
    String second = "33333333-3333-4333-8333-333333333333";
    var owner = new OntologyAgentStore.Owner("user-a", "domain-a");
    var store = mock(OntologyAgentStore.class);
    when(store.session(first, owner))
        .thenReturn(JSONObject.of("agent_id", OntologyAgentStore.RETRIEVER));
    when(store.session(second, owner))
        .thenReturn(JSONObject.of("agent_id", OntologyAgentStore.RETRIEVER));
    var host = mock(OntologyAgentHost.class);
    var sessions =
        JSONArray.of(
            JSONObject.of(
                "sessionId",
                first,
                "latestRun",
                JSONObject.of(
                    "id", "22222222-2222-4222-8222-222222222222",
                    "status", "running",
                    "stopReason", null)),
            JSONObject.of("sessionId", second, "latestRun", null));
    when(host.sessionStatuses(any(), eq(owner))).thenReturn(sessions);
    var mvc = statusBoundary(host, boundaryAccess(owner, store));
    var response =
        mvc.perform(
                post("/ontology/ai/sessions/status")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        "{\"sessionIds\":[\""
                            + first
                            + "\",\""
                            + second
                            + "\"]}"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse();
    assertEquals(
        sessions, JSON.parseObject(response.getContentAsString()).getJSONArray("sessions"));
    var ids = org.mockito.ArgumentCaptor.forClass(List.class);
    verify(host).sessionStatuses(ids.capture(), eq(owner));
    assertEquals(List.of(first, second), ids.getValue());

    // A JSON string is not the array this endpoint accepts.
    var invalid =
        mvc.perform(
                post("/ontology/ai/sessions/status")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"sessionIds\":\"" + first + "\"}"))
            .andReturn()
            .getResponse();
    assertEquals(400, invalid.getStatus());
    verifyNoMoreInteractions(host);
  }

  @Test
  void httpSessionStatusReturnsOnlyTheReadableSubset() throws Exception {
    String missing = "11111111-1111-4111-8111-111111111111";
    String first = "33333333-3333-4333-8333-333333333333";
    String second = "55555555-5555-4555-8555-555555555555";
    var owner = new OntologyAgentStore.Owner("user-a", "domain-a");
    var store = mock(OntologyAgentStore.class);
    when(store.session(missing, owner)).thenThrow(AgentHttpException.missing());
    when(store.session(first, owner))
        .thenReturn(JSONObject.of("agent_id", OntologyAgentStore.RETRIEVER));
    when(store.session(second, owner))
        .thenReturn(JSONObject.of("agent_id", OntologyAgentStore.RETRIEVER));
    var host = mock(OntologyAgentHost.class);
    var sessions =
        JSONArray.of(
            JSONObject.of("sessionId", first, "latestRun", null),
            JSONObject.of("sessionId", second, "latestRun", null));
    when(host.sessionStatuses(any(), eq(owner))).thenReturn(sessions);
    var response =
        statusBoundary(host, boundaryAccess(owner, store))
            .perform(
                post("/ontology/ai/sessions/status")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        "{\"sessionIds\":[\""
                            + missing
                            + "\",\""
                            + first
                            + "\",\""
                            + second
                            + "\"]}"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse();
    assertEquals(
        sessions, JSON.parseObject(response.getContentAsString()).getJSONArray("sessions"));
    var ids = org.mockito.ArgumentCaptor.forClass(List.class);
    verify(host).sessionStatuses(ids.capture(), eq(owner));
    assertEquals(List.of(first, second), ids.getValue());
  }

  private static OntologyAgentAccess boundaryAccess(
      OntologyAgentStore.Owner owner, OntologyAgentStore store) {
    var identity = mock(IdentityService.class);
    when(identity.getCurrentUser())
        .thenReturn(new QueryAccessService.GrantUser(owner.userId(), owner.domainId()));
    return new OntologyAgentAccess(
        mock(QueryAccessService.class), identity, mock(QueryGrantService.class), store);
  }

  private static org.springframework.test.web.servlet.MockMvc statusBoundary(
      OntologyAgentHost host, OntologyAgentAccess access) {
    return MockMvcBuilders.standaloneSetup(
            new OntologyAgentController(
                host, access, mock(AgentRuntimeClient.class), mock(OntologyRetrievalService.class)))
        .setControllerAdvice(new OntologyAgentErrors((language, key) -> key))
        .setMessageConverters(new MappingJackson2HttpMessageConverter())
        .build();
  }

  private static MetricView boundaryMetric() {
    var year = new Parameter();
    year.setName("year");
    year.setType(Parameter.TYPE_NUMBER);
    var regions = new Parameter();
    regions.setName("regions");
    regions.setType(Parameter.TYPE_STRING_ARRAY);
    var function = new Function();
    function.setOperation(Function.OPERATION_READ);
    function.setDomainId("domain-a");
    function.setParameters(List.of(year, regions));
    var metric = new MetricView();
    metric.setId("metric-1");
    metric.setName("Regional sales");
    metric.setDomainId("domain-a");
    metric.setStatus(MetricView.STATUS_PUBLISHED);
    metric.setBindings(List.of());
    metric.setFunction(function);
    return metric;
  }


  @Test
  void httpObjectsAndArraysReachFunctionAdmissionWithoutCoercingStrings() throws Exception {
    var input = new MockHttpInputMessage("""
        {"function":{"name":"Update name","operation":"OPERATION_WRITE",
          "code":"# ontomato-python:2\\nprint('ok')",
          "parameters":[{"name":"id","type":"TYPE_STRING","value":"e2e-1"}]}}
        """.getBytes(StandardCharsets.UTF_8));
    input.getHeaders().setContentType(MediaType.APPLICATION_JSON);
    var body = (JSONObject) new MappingJackson2HttpMessageConverter().read(JSONObject.class, input);
    var function = Function.fromAsset(body);
    assertDoesNotThrow(() -> FunctionDao.requireSupported(function, "en"));
    body.put("function", JSONObject.of("parameters", "[]"));
    assertTrue(assertThrows(IllegalArgumentException.class, () -> Function.fromAsset(body))
        .getMessage().startsWith("Function.parameters:"));
  }

  @Test
  void httpDslObjectsReachTheQueryServiceWhileStringsAndArraysAreRejected() throws Exception {
    var controller = new ProductionEnvController();
    var env = mock(EnvService.class);
    ReflectionTestUtils.setField(controller, "envService", env);
    when(env.executeDslInProductionEnv(any())).thenReturn(JSONObject.of("success", true));
    var mvc = MockMvcBuilders.standaloneSetup(controller).build();
    var result = mvc.perform(post("/productionEnv/queryData").contentType(MediaType.APPLICATION_JSON)
        .content("{\"dsl\":{\"answer\":{\"steps\":[]}}}"))
        .andExpect(status().isOk()).andReturn().getResponse();
    assertTrue(JSON.parseObject(result.getContentAsString()).getBooleanValue("success"));
    verify(env).executeDslInProductionEnv(any(JSONObject.class));
    clearInvocations(env);
    for (String invalid : List.of("[]", "\"{}\"")) {
      var rejected = mvc.perform(post("/productionEnv/queryData").contentType(MediaType.APPLICATION_JSON)
          .content("{\"dsl\":" + invalid + "}"))
          .andReturn().getResponse();
      assertFalse(JSON.parseObject(rejected.getContentAsString()).getBooleanValue("success"));
    }
    verifyNoInteractions(env);
  }
  @Test
  void httpWritePayloadsReachTheirOwnersAsJsonObjectsAndArrays() throws Exception {
    var controller = new WriteFunctionOperationController();
    var writes = mock(WriteFunctionOperationService.class);
    var rules = mock(JSONRuleDao.class);
    var queries = mock(OntologyQueryService.class);
    ReflectionTestUtils.setField(controller, "writeFunctionOperationService", writes);
    ReflectionTestUtils.setField(controller, "jsonRuleDao", rules);
    ReflectionTestUtils.setField(controller, "queries", queries);
    ReflectionTestUtils.setField(controller, "request", new MockHttpServletRequest());
    ReflectionTestUtils.setField(controller, "accessService", mock(QueryAccessService.class));
    when(rules.query("domain-a")).thenReturn(Map.of("classDef", List.of(Map.of(
        "className", "person", "attrs", List.of(Map.of("name", "id"), Map.of("name", "name"))))));
    when(queries.execute(any(), any())).thenReturn(Map.of("data", List.of()));
    var mvc = MockMvcBuilders.standaloneSetup(controller).build();
    Map<String, String> bodies = Map.of(
        "insert", "{\"className\":\"person\",\"objs\":[{\"id\":\"e2e-1\",\"name\":\"Before\"}]}",
        "update", "{\"className\":\"person\",\"setValues\":{\"name\":\"After\"},\"where\":{\"operator\":\"logic\",\"and\":[{\"field\":\"id\",\"operator\":\"in\",\"value\":[\"e2e-1\"]}]}}",
        "delete", "{\"className\":\"person\",\"where\":{\"field\":\"id\",\"operator\":\"=\",\"value\":\"e2e-1\"}}",
        "query", "{\"dsl\":{\"answer\":{\"steps\":[]}}}");
    for (var entry : bodies.entrySet()) {
      var response = mvc.perform(post("/writeFunctionOperation/" + entry.getKey())
          .requestAttr(QueryGrantService.ATTRIBUTE, JSONObject.of("domainId", "domain-a", "sandboxId", "sandbox-a"))
          .contentType(MediaType.APPLICATION_JSON).content(entry.getValue()))
          .andExpect(status().isOk()).andReturn().getResponse();
      JSONObject result = JSON.parseObject(response.getContentAsString());
      assertNotEquals(Boolean.FALSE, result.getBoolean("success"), result.toJSONString());
    }
    verify(writes).insert(eq("person"), any(), eq("sandbox-a"), eq("domain-a"));
    verify(writes).update(eq("person"), any(), any(), eq("sandbox-a"), eq("domain-a"));
    verify(writes).delete(eq("person"), any(), eq("sandbox-a"), eq("domain-a"));
    verify(queries).execute(any(JSONObject.class), isNull());
  }

}
