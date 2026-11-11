package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.multisource.DataSourceEntry;
import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.agent.AgentJson;
import io.ontomato.dataengine.service.impl.SandboxServiceImpl;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

class SandboxConnectionBindingTest {
  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void cleanupMatchesExistingBindingsAndStillRejectsEveryChangedConnectionValue(boolean multi) {
    var connection = new DataAdapterConnection();
    connection.put("url", "jdbc:postgresql://original/db");
    connection.put("user", "builder");
    connection.put("password", "original-secret");
    connection.put("company", null);
    var config = new BusinessConfig();
    config.setDataAdapter(multi ? "multi" : "postgresql");
    config.getDataAdapterConnections().put("postgresql", connection);
    if (multi) {
      var source = new DataSourceEntry();
      source.setId("primary");
      source.setAdapterType("postgresql");
      source.setConnection(connection);
      var sources = new MultiDataSourceDefinition();
      sources.setDataSources(List.of(source));
      config.setMultiDataSource(sources);
    }
    var configs = mock(BusinessConfigService.class);
    when(configs.get("domain")).thenAnswer(call ->
        JSON.parseObject(JSON.toJSONString(config, Feature.WriteMapNullValue), BusinessConfig.class));
    var rules = mock(JSONRuleDao.class);
    when(rules.query("domain")).thenReturn(new JSONObject());
    var adapter = mock(DataAdapter.class);
    when(adapter.supportsSandbox(List.of("item"))).thenReturn(true);
    var registry = mock(DataAdapterRegistry.class);
    when(registry.create(any(), any())).thenReturn(adapter);
    var sandbox = new SandboxServiceImpl();
    ReflectionTestUtils.setField(sandbox, "businessConfigService", configs);
    ReflectionTestUtils.setField(sandbox, "jsonRuleDao", rules);
    ReflectionTestUtils.setField(sandbox, "dataAdapterRegistry", registry);
    var binding = sandbox.bindSample(JSON.parseObject("{\"objDatas\":[{\"className\":\"item\",\"rows\":[]}]}"), "domain");
    // Existing contexts fingerprinted the default JSON representation, which omits unset fields.
    var oldHash = AgentJson.hash(JSON.parseObject(JSON.toJSONString(connection)));
    assertEquals(oldHash, binding.getJSONObject("connectionHashes").getString(multi ? "source:primary" : "postgresql"));
    assertNotEquals(oldHash, AgentJson.hash(connection));
    binding = AgentJson.copy(binding);
    var recordedBinding = binding;
    var resource = JSONObject.of("kind", "table", "schema", "public", "name", "recorded_item");
    var resources = new JSONArray(List.of(resource));
    clearInvocations(adapter, registry);
    for (String field : List.of("url", "user", "password", "company")) {
      String original = connection.put(field, "replacement");
      var failure = assertThrows(IllegalStateException.class, () ->
          sandbox.dropSampleStructure(recordedBinding, resources, "domain", saved -> fail("Must refuse before deletion")));
      assertEquals("Original source unavailable: " + (multi ? "primary" : "postgresql"), failure.getMessage());
      verifyNoInteractions(adapter, registry);
      connection.put(field, original);
    }
    sandbox.dropSampleStructure(recordedBinding, resources, "domain", saved -> {});
    verify(adapter).dropRecordedResource(resource);
    assertEquals("DELETED", resource.getString("cleanupStatus"));
  }
}
