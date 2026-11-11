package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.*;
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
