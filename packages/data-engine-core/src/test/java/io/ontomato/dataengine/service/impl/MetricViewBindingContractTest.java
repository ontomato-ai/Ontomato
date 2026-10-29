package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.*;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.*;
import io.ontomato.dataengine.service.*;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.ZipBundleUtil;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

/** Service contracts with explicit in-memory persistence and execution boundaries, no models or servers. */
class MetricViewBindingContractTest {
  final MetricViewServiceImpl service = new MetricViewServiceImpl();
  final Map<String, MetricView> metrics = new LinkedHashMap<>();
  final Map<String, Function> functions = new LinkedHashMap<>();
  final MetricViewDao dao = mock(MetricViewDao.class);
  final FunctionDao functionDao = mock(FunctionDao.class);
  final ABCProgramService execution = mock(ABCProgramService.class);
  final User user = new QueryAccessService.GrantUser("reader", "domain-a");

  static <T> T copy(T value, Class<T> type) { return JSON.parseObject(JSON.toJSONString(value, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue), type); }

  @BeforeEach
  void setup() throws Exception {
    var transactions = mock(PlatformTransactionManager.class);
    when(transactions.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    ReflectionTestUtils.setField(service, "transactionManager", transactions);
    ReflectionTestUtils.setField(service, "metricViewDao", dao);
    ReflectionTestUtils.setField(service, "functionDao", functionDao);
    ReflectionTestUtils.setField(service, "abcProgramService", execution);
    when(functionDao.queryById(anyString())).thenAnswer(call -> {
      Function f = functions.get(call.getArgument(0)); return f == null ? null : copy(f, Function.class);
    });
    when(functionDao.save(any())).thenAnswer(call -> {
      Function f = call.getArgument(0);
      if (f.getId() == null) f.setId(UUID.randomUUID().toString());
      functions.put(f.getId(), copy(f, Function.class)); return f;
    });
    when(dao.save(any())).thenAnswer(call -> {
      MetricView m = call.getArgument(0);
      if (m.getId() == null) m.setId(UUID.randomUUID().toString());
      for (var b : m.getBindings()) if (b.getId() == null) b.setId(UUID.randomUUID().toString());
      metrics.put(m.getId(), copy(m, MetricView.class)); return m;
    });
    when(dao.exists(anyString())).thenAnswer(call -> metrics.containsKey(call.getArgument(0)));
    when(dao.queryById(anyString(), anyString())).thenAnswer(call -> {
      MetricView m = metrics.get(call.getArgument(0));
      return m == null || !m.getDomainId().equals(call.getArgument(1)) ? null : new Object[]{copy(m, MetricView.class), m.getFunction().getId()};
    });
    when(dao.queryList(any(), any(), any(), any())).thenAnswer(call -> metrics.values().stream()
        .filter(m -> Objects.equals(m.getDomainId(), call.getArgument(3)))
        .filter(m -> call.getArgument(1) == null || Objects.equals(m.getFunction().getId(), call.getArgument(1)))
        .map(m -> new Object[]{copy(m, MetricView.class), m.getFunction().getId()}).toList());
    doAnswer(call -> {
      MetricView m = metrics.get(call.getArgument(0));
      if (m != null && m.getDomainId().equals(call.getArgument(1))) metrics.remove(m.getId());
      return null;
    }).when(dao).delete(anyString(), anyString());
    when(execution.execute(anyString(), any(), anyString(), any(), isNull(), anyString(), anyInt(), anyString()))
        .thenAnswer(call -> {
          Function f = call.getArgument(1);
          return new Object[]{JSONArray.of(JSONObject.of("code", f.getCode(), "values", MetricViewBindings.values(f))), new PythonExecuteResult()};
        });
  }

  MetricView metric(String domain) {
    Function f = new Function(); f.setOperation(Function.OPERATION_READ); f.setCode("shared calculation");
    f.setParameters(new ArrayList<>());
    for (String[] field : new String[][]{{"amount", Parameter.TYPE_NUMBER}, {"labels", Parameter.TYPE_STRING_ARRAY}, {"optional", Parameter.TYPE_STRING}}) {
      Parameter p = new Parameter(); p.setName(field[0]); p.setType(field[1]); p.setValue(null); f.getParameters().add(p);
    }
    f.setReturnDef(new ReturnDef());
    MetricView m = service.generateFromFunction(f); m.setDomainId(domain); m.setName("Revenue");
    m.setStatus(MetricView.STATUS_PUBLISHED); m.setMatchQuestions(new HashSet<>());
    m.setBindings(new ArrayList<>(List.of(binding("First", 0), binding("Second", 12))));
    return m;
  }

  MetricViewBinding binding(String name, int amount) {
    MetricViewBinding b = new MetricViewBinding(); b.setName(name);
    b.setParameters(JSONObject.of("amount", amount, "labels", List.of("north", "west"), "optional", null));
    b.setMatchQuestions(Set.of(name)); return b;
  }

  JSONObject execute(MetricView m, String bindingId) throws Exception {
    return ((JSONArray) service.execute(m.getId(), bindingId, null, "en", user, new UserDataPermission(), 1)[0]).getJSONObject(0);
  }

  @Test
  void bindingsShareOneDefinitionAndExecutionNeverMutatesIt() throws Exception {
    MetricView m = service.save(metric("domain-a"), "en");
    service.appendBinding(m.getId(), binding("Third", 25), "domain-a");
    m = service.queryById(m.getId(), "domain-a");
    assertEquals(1, functions.size()); assertEquals(3, m.getBindings().size());
    assertEquals(0, execute(m, m.getBindings().get(0).getId()).getJSONObject("values").getIntValue("amount"));
    assertEquals(12, execute(m, m.getBindings().get(1).getId()).getJSONObject("values").getIntValue("amount"));
    assertNull(functions.values().iterator().next().getParameters().get(0).getValue());
    m.getFunction().setCode("updated calculation"); service.save(m, "en");
    for (var b : m.getBindings()) assertEquals("updated calculation", execute(m, b.getId()).getString("code"));
    assertEquals(1, functions.size());
    JSONObject payload = JSON.parseObject(JSON.toJSONString(m, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue));
    assertFalse(payload.containsKey("type"));
    assertFalse(payload.getJSONArray("bindings").getJSONObject(0).containsKey("status"));
    assertTrue(payload.getJSONArray("bindings").getJSONObject(0).getJSONObject("parameters").containsKey("optional"));
  }

  @Test
  void invalidatingEditsDoNotChangeStoredDefinitionOrBindings() {
    MetricView m = service.save(metric("domain-a"), "en");
    String before = JSON.toJSONString(functions);
    m.getFunction().getParameters().get(0).setType(Parameter.TYPE_STRING);
    m.setBindings(null); // Definition-only clients preserve the saved binding collection.
    assertThrows(IllegalArgumentException.class, () -> service.save(m, "en"));
    assertEquals(before, JSON.toJSONString(functions));
    MetricView renamed = service.queryById(m.getId(), "domain-a");
    renamed.getFunction().getParameters().get(0).setName("renamed");
    assertThrows(IllegalArgumentException.class, () -> service.save(renamed, "en"));
    assertEquals(2, metrics.get(m.getId()).getBindings().size());
  }

  @Test
  void bindingsCannotBeStolenOrOverriddenAndRemovalKeepsTheDefinition() throws Exception {
    MetricView a = service.save(metric("domain-a"), "en");
    MetricView other = service.save(metric("domain-a"), "en");
    a.getBindings().add(copy(other.getBindings().get(0), MetricViewBinding.class));
    assertThrows(IllegalArgumentException.class, () -> service.save(a, "en"));
    MetricView original = service.queryById(a.getId(), "domain-a");
    String bindingId = original.getBindings().get(0).getId();
    assertThrows(IllegalArgumentException.class, () -> service.execute(a.getId(), bindingId, JSONObject.of("amount", 100), "en", user, new UserDataPermission(), 1));
    original.getBindings().remove(0); service.save(original, "en");
    assertEquals(1, metrics.get(a.getId()).getBindings().size());
    assertEquals(2, functions.size());
    assertThrows(IllegalArgumentException.class, () -> execute(original, bindingId));
  }

  @Test
  void readDeleteAndExportStayInTheCredentialDomain() throws Exception {
    MetricView a = service.save(metric("domain-a"), "en");
    MetricView b = service.save(metric("domain-b"), "en");
    assertNull(service.queryById(b.getId(), "domain-a"));
    assertThrows(IllegalArgumentException.class, () -> service.delete(b.getId(), "domain-a", "en"));
    JSONArray exported = JSON.parseArray(new String(ZipBundleUtil.unzipFirstJson(service.exportMetricViews("domain-a", "en")), java.nio.charset.StandardCharsets.UTF_8));
    assertEquals(1, exported.size()); assertEquals(a.getId(), exported.getJSONObject(0).getString("id"));
    assertEquals(2, exported.getJSONObject(0).getJSONArray("bindings").size());
    service.delete(a.getId(), "domain-a", "en");
    assertFalse(metrics.containsKey(a.getId())); assertTrue(metrics.containsKey(b.getId()));
  }
}
