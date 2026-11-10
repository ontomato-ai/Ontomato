package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.EnvService;
import io.ontomato.dataengine.service.impl.WriteFunctionOperationServiceImpl;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class AgentContractBoundaryTest {
  @Test void queryArraysAndSerializedObjectsNeverReachEitherQueryService() throws Exception {
    var writes = new WriteFunctionOperationController();
    var production = new ProductionEnvController();
    var env = mock(EnvService.class);
    ReflectionTestUtils.setField(production, "envService", env);
    for (Object raw : List.of(new JSONArray(), JSONArray.of(JSONObject.of("answer", 1)), "{}", 7)) {
      var body = JSONObject.of("dsl", raw);
      var error = assertThrows(IllegalArgumentException.class, () -> writes.query(body));
      assertTrue(error.getMessage().startsWith("dsl:"));
      var result = production.queryData(body);
      assertFalse(result.getBooleanValue("success"));
      assertEquals(error.getMessage(), result.getString("message"));
    }
    verifyNoInteractions(env);
  }

  @Test void omittedDryRunIsSafeAndOnlyAnExplicitBooleanFalseWrites() throws Exception {
    var production = new ProductionEnvController();
    var env = mock(EnvService.class);
    ReflectionTestUtils.setField(production, "envService", env);
    when(env.syncAssetsToProduction(anyList(), anyList(), anyBoolean()))
        .thenReturn(JSONObject.of("success", true));
    production.sync(new JSONObject());
    verify(env).syncAssetsToProduction(List.of(), List.of(), true);
    production.sync(JSONObject.of("dryRun", false));
    verify(env).syncAssetsToProduction(List.of(), List.of(), false);
    clearInvocations(env);
    for (Object raw : Arrays.asList(null, "false", 0)) {
      var result = production.sync(JSONObject.of("dryRun", raw));
      assertFalse(result.getBooleanValue("success"));
      assertTrue(result.getString("message").startsWith("dryRun:"));
    }
    verifyNoInteractions(env);
  }

  @Test void entireInsertBatchIsRejectedBeforeAdapterCreationAndInputIsPreserved() {
    var service = new WriteFunctionOperationServiceImpl();
    var rules = mock(JSONRuleDao.class);
    var registry = mock(DataAdapterRegistry.class);
    ReflectionTestUtils.setField(service, "jsonRuleDao", rules);
    ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
    when(rules.query("d")).thenReturn(Map.of("classDef", List.of(Map.of(
        "className", "person", "attrs", List.of(Map.of("name", "photo", "type", "vector"))))));
    var objects = JSONArray.of(JSONObject.of("id", "a"), JSONObject.of("id", "b", "photo", "must-stay"));
    var error = assertThrows(IllegalArgumentException.class, () -> service.insert("person", objects, null, "d"));
    assertTrue(error.getMessage().startsWith("objs[1].photo:"));
    assertEquals("must-stay", objects.getJSONObject(1).getString("photo"));
    for (JSONArray raw : Arrays.asList(null, new JSONArray(), JSONArray.of("{}")))
      assertThrows(IllegalArgumentException.class, () -> service.insert("person", raw, null, "d"));
    verifyNoInteractions(registry);
  }
}
