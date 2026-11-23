package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.dao.MetricViewDao;
import io.ontomato.dataengine.service.impl.MetricViewServiceImpl;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

/** A batch status change reads, changes only the status and saves each metric in its own transaction. */
class MetricViewSetStatusTest {
  private static final String DSL = """
      {"answer":{"steps":[{"graph":{"patterns":[{"objects":[{"idx":0,"variable":"e","class":"/Employee"}]}]},
      "output":{"fields":[{"expr":"'shared calculation'","as":"code"}]}}]}}
      """;

  private final MetricViewServiceImpl service = new MetricViewServiceImpl();
  private final MetricViewDao metricViewDao = mock(MetricViewDao.class);
  private final FunctionDao functionDao = mock(FunctionDao.class);
  private final AdminService adminService = mock(AdminService.class);
  private final IdentityService identityService = mock(IdentityService.class);
  private final LangService langService = mock(LangService.class);
  private final Map<String, MetricView> metrics = new LinkedHashMap<>();

  @BeforeEach
  void setup() {
    PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    when(transactions.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
    ReflectionTestUtils.setField(service, "transactionManager", transactions);
    ReflectionTestUtils.setField(service, "metricViewDao", metricViewDao);
    ReflectionTestUtils.setField(service, "functionDao", functionDao);
    ReflectionTestUtils.setField(service, "adminService", adminService);
    ReflectionTestUtils.setField(service, "identityService", identityService);
    ReflectionTestUtils.setField(service, "langService", langService);
    ReflectionTestUtils.setField(service, "subjectValues",
        new SubjectValueResolver(mock(SubjectAttributeLookup.class)));
    when(langService.get(anyString(), anyString())).thenAnswer(call -> call.getArgument(1));
    when(adminService.getJSONRule(anyString())).thenReturn(Map.of("classDef", List.of(
        JSONObject.of("className", "/Employee", "attrs", List.of(JSONObject.of("name", "salary"))))));
    when(identityService.getCurrentUserId()).thenReturn("reviewer");
    when(metricViewDao.queryById(anyString(), anyString())).thenAnswer(call -> {
      MetricView metric = metrics.get(call.getArgument(0));
      if (metric == null || !metric.getDomainId().equals(call.getArgument(1))) return null;
      return new Object[]{copy(metric), metric.getFunction().getId()};
    });
    when(functionDao.queryById(anyString())).thenAnswer(call -> {
      MetricView metric = metrics.values().stream()
          .filter(item -> item.getFunction().getId().equals(call.getArgument(0))).findFirst().orElse(null);
      return metric == null ? null : copyFunction(metric.getFunction());
    });
    when(metricViewDao.save(any())).thenAnswer(call -> call.getArgument(0));
    when(functionDao.save(any(), anyString())).thenAnswer(call -> call.getArgument(0));
    when(metricViewDao.queryList(any(), any(), any(), any())).thenReturn(List.of());
  }

  @Test
  void changesOnlyTheStatusAndRecordsTheReviewer() {
    put(metric("m1", MetricView.ORIGIN_USER));

    List<MetricViewService.StatusResult> results =
        service.setStatus("domain-a", List.of("m1"), MetricView.STATUS_PUBLISHED, "en");

    assertEquals(1, results.size());
    assertNull(results.get(0).error());
    MetricView saved = results.get(0).data();
    assertEquals(MetricView.STATUS_PUBLISHED, saved.getStatus());
    assertEquals("reviewer", saved.getReviewedBy());
    assertEquals("Revenue", saved.getName());
    assertEquals(1, saved.getBindings().size());
    ArgumentCaptor<MetricView> captured = ArgumentCaptor.forClass(MetricView.class);
    verify(metricViewDao).save(captured.capture());
    assertEquals(MetricView.STATUS_PUBLISHED, captured.getValue().getStatus());
    assertEquals("Revenue", captured.getValue().getName());
  }

  @Test
  void oneRefusalOneFailureAndOneSuccessDoNotStopEachOther() {
    put(metric("system", MetricView.ORIGIN_SYSTEM));
    put(metric("broken", MetricView.ORIGIN_USER));
    put(metric("m1", MetricView.ORIGIN_USER));
    when(functionDao.queryById("f-broken")).thenReturn(null);

    List<MetricViewService.StatusResult> results =
        service.setStatus("domain-a", List.of("system", "broken", "m1"), MetricView.STATUS_PUBLISHED, "en");

    assertEquals(3, results.size());
    assertEquals("system", results.get(0).id());
    assertEquals("METRIC_VIEW_SYSTEM", results.get(0).refusal().code());
    assertEquals("Cannot modify a system MetricView", results.get(0).refusal().getMessage());
    assertEquals("broken", results.get(1).id());
    assertNull(results.get(1).refusal());
    assertEquals("MetricView read Function is missing or belongs to another domain", results.get(1).error());
    assertEquals("m1", results.get(2).id());
    assertNull(results.get(2).refusal());
    assertEquals(MetricView.STATUS_PUBLISHED, results.get(2).data().getStatus());
  }

  @Test
  void refusesAWorkflowPendingMetricAndAMissingMetric() {
    MetricView pending = metric("pending", MetricView.ORIGIN_USER);
    pending.setWorkflowSource(new MetricView.WorkflowSource("w1", 1, MetricView.WorkflowSource.Purpose.pending));
    put(pending);

    List<MetricViewService.StatusResult> results =
        service.setStatus("domain-a", List.of("pending", "missing"), MetricView.STATUS_UNUSED, "en");

    assertEquals("METRIC_VIEW_WORKFLOW_PENDING", results.get(0).refusal().code());
    assertEquals("Edit the workflow to change its pending query", results.get(0).refusal().getMessage());
    assertEquals("METRIC_VIEW_NOT_FOUND", results.get(1).refusal().code());
    assertEquals("MetricView.notFound", results.get(1).refusal().getMessage());
  }

  @Test
  void handlesARepeatedIdOnce() {
    put(metric("m1", MetricView.ORIGIN_USER));

    List<MetricViewService.StatusResult> results =
        service.setStatus("domain-a", List.of("m1", "m1"), MetricView.STATUS_UNUSED, "en");

    assertEquals(1, results.size());
    verify(metricViewDao, times(1)).save(any());
  }

  @Test
  void rejectsAnEmptyIdListOrAnUnknownStatusBeforeAnyWork() {
    for (OwnerRefusal refusal : List.of(
        assertThrows(OwnerRefusal.class, () -> service.setStatus("domain-a", List.of(), MetricView.STATUS_PUBLISHED, "en")),
        assertThrows(OwnerRefusal.class, () -> service.setStatus("domain-a", List.of("m1"), "DELETED", "en")),
        assertThrows(OwnerRefusal.class, () -> service.setStatus("domain-a", List.of("m1"), null, "en"))))
      assertEquals("METRIC_VIEW_STATUS_INVALID", refusal.code());
    verifyNoInteractions(metricViewDao);
  }

  @Test
  void testExecuteRefusesAMetricThatIsNeitherPublishedNorTheCallersCandidate() {
    MetricView candidate = metric("candidate", MetricView.ORIGIN_USER);
    candidate.setCreatedBy("someone-else");
    put(candidate);
    User reader = mock(User.class);
    when(reader.getId()).thenReturn("reviewer");
    when(reader.getDomainId()).thenReturn("domain-a");

    OwnerRefusal refusal = assertThrows(OwnerRefusal.class, () -> service.testExecute(
        candidate, null, new JSONObject(), "en", reader, new UserDataPermission(), 1));

    assertEquals("METRIC_VIEW_NOT_EXECUTABLE", refusal.code());
    assertEquals("Executable read metric not found", refusal.getMessage());
  }

  @Test
  void testExecuteReportsAMissingMetricAsNotFound() {
    MetricView absent = metric("missing", MetricView.ORIGIN_USER);
    User reader = mock(User.class);
    when(reader.getId()).thenReturn("reviewer");
    when(reader.getDomainId()).thenReturn("domain-a");

    OwnerRefusal refusal = assertThrows(OwnerRefusal.class, () -> service.testExecute(
        absent, null, new JSONObject(), "en", reader, new UserDataPermission(), 1));

    assertEquals("METRIC_VIEW_NOT_FOUND", refusal.code());
  }

  private void put(MetricView metric) {
    metrics.put(metric.getId(), metric);
  }

  private MetricView metric(String id, String origin) {
    Function function = new Function();
    function.setId("f-" + id);
    function.setName("Revenue function");
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(Function.OPERATION_READ);
    function.setDomainId("domain-a");
    function.setQueryPackage(QueryPackage.fromDsl(DSL));
    ReturnDef returnDef = new ReturnDef();
    returnDef.setColumnLabels(JSONObject.of("code", "Code"));
    function.setReturnDef(returnDef);
    MetricView metric = new MetricView();
    metric.setId(id);
    metric.setName("Revenue");
    metric.setDescription("Revenue by amount");
    metric.setOrigin(origin);
    metric.setStatus(MetricView.STATUS_PENDING_REVIEW);
    metric.setDomainId("domain-a");
    metric.setMatchQuestions(new HashSet<>(Set.of("revenue")));
    MetricViewBinding binding = new MetricViewBinding();
    binding.setId("b-" + id);
    binding.setName("First");
    binding.setDescription("");
    binding.setMatchQuestions(new HashSet<>());
    binding.setParameters(new JSONObject());
    metric.setBindings(new ArrayList<>(List.of(binding)));
    metric.setFunction(function);
    return metric;
  }

  private static MetricView copy(MetricView metric) {
    return JSON.parseObject(
        JSON.toJSONString(metric, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue), MetricView.class);
  }

  private static Function copyFunction(Function function) {
    return JSON.parseObject(
        JSON.toJSONString(function, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue), Function.class);
  }
}
