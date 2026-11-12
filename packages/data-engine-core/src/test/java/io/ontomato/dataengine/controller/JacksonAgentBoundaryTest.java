package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.OntologyAgentAccess;
import io.ontomato.dataengine.service.agent.OntologyAgentHost;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
import io.ontomato.dataengine.service.agent.OntologyRetrievalService;
import java.util.List;
import java.util.Map;
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
        .setControllerAdvice(new OntologyAgentErrors())
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
        .setControllerAdvice(new OntologyAgentErrors())
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
  void testContextRefusesBatchVectorUploadsBeforeEitherWriterRuns() throws Exception {
    var contexts = mock(BuildTestContextService.class);
    var vectors = mock(VectorResourceService.class);
    var writes = mock(WriteFunctionOperationService.class);
    var controller = new VectorResourceController();
    ReflectionTestUtils.setField(controller, "buildTests", contexts);
    ReflectionTestUtils.setField(controller, "vectorResourceService", vectors);
    ReflectionTestUtils.setField(controller, "writes", writes);
    when(contexts.resolve(any())).thenReturn(new ExecutionTarget("ctx", "sandbox", List.of("person"), 1L));
    var response = MockMvcBuilders.standaloneSetup(controller).build()
        .perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart("/vectorResource/upload")
            .param("items", "[{}]"))
        .andExpect(status().isOk()).andReturn().getResponse();
    var body = JSON.parseObject(response.getContentAsString());
    assertFalse(body.getBooleanValue("success"));
    assertEquals("The test context supports only single-resource uploads.", body.getString("message"));
    verifyNoInteractions(vectors, writes);
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
