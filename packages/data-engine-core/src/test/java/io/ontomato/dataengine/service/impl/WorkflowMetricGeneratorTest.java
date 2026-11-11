package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.workflow.RunContract;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.MetricViewService;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * What activating a process publishes as queries, and what it must refuse to publish.
 *
 */
class WorkflowMetricGeneratorTest {

  private static final String DOMAIN = "d1";

  private MetricViewService metrics;
  private AdminService admin;
  private WorkflowMetricGenerator generator;

  @BeforeEach
  void setUp() throws Exception {
    metrics = mock(MetricViewService.class);
    admin = mock(AdminService.class);
    generator = new WorkflowMetricGenerator(metrics, admin);
    when(metrics.queryList(any(), any(), any(), anyString())).thenReturn(List.of());
    when(metrics.publishWorkflowMetric(any(), anyString())).thenAnswer(call -> call.getArgument(0));
    when(admin.getJSONRule(DOMAIN)).thenReturn(classRule());
  }

  @Test
  void generatesAPendingQueryAndADetailQuery() throws Exception {
    Workflow workflow = workflow(contract());

    WorkflowMetricGenerator.Generated generated = generator.generate(workflow);

    ArgumentCaptor<MetricView> saved = ArgumentCaptor.forClass(MetricView.class);
    verify(metrics, times(2)).publishWorkflowMetric(saved.capture(), anyString());
    assertEquals(2, generated.names().size());
    assertTrue(generated.warnings().isEmpty(), generated.warnings().toString());

    MetricView pending = saved.getAllValues().stream()
        .filter(metric -> metric.getName().startsWith("我的待办"))
        .findFirst()
        .orElseThrow();
    String bundle = pending.getFunction().getQueryPackage().toJSONString();
    assertTrue(pending.getBindings().isEmpty());
    assertEquals("w1", pending.getWorkflowSource().workflowId());
    assertEquals(2, pending.getWorkflowSource().version());
    assertEquals(MetricView.WorkflowSource.Purpose.pending, pending.getWorkflowSource().purpose());
    assertTrue(!bundle.contains("account.id") && !bundle.contains("assignee_id"), bundle);
    assertEquals(MetricView.STATUS_PUBLISHED, pending.getStatus());

    MetricView detail = saved.getAllValues().stream()
        .filter(metric -> metric.getName().startsWith("单据详情"))
        .findFirst()
        .orElseThrow();
    // The by-id query takes the id from the caller and involves no subject value.
    assertTrue(detail.getBindings().isEmpty());
    assertTrue(detail.getFunction().getQueryPackage().toJSONString().contains("runId"));
  }

  @Test
  void departmentStepsNeedNoAssigneeField() throws Exception {
    RunContract contract = contract();
    contract.setAssigneeField(null);

    WorkflowMetricGenerator.Generated generated = generator.generate(workflow(contract));

    verify(metrics, times(2)).publishWorkflowMetric(any(), anyString());
    assertEquals(2, generated.names().size());
    assertTrue(generated.warnings().isEmpty());
  }

  @Test
  void aWorkflowWithoutAContractPublishesNoQueries() {
    Workflow workflow = workflow(null);

    WorkflowMetricGenerator.Generated generated = generator.generate(workflow);

    assertTrue(generated.names().isEmpty());
    assertTrue(generated.warnings().isEmpty());
    verifyNoInteractions(metrics);
  }

  @Test
  void activatingAgainUpdatesTheSameMetricsInsteadOfAddingMore() throws Exception {
    Workflow workflow = workflow(contract());
    MetricView existingPending = new MetricView();
    existingPending.setId("mv-1");
    existingPending.setName("previous name");
    existingPending.setWorkflowSource(new MetricView.WorkflowSource("w1", 1, MetricView.WorkflowSource.Purpose.pending));
    existingPending.setBindings(new ArrayList<>());
    MetricView existingDetail = new MetricView();
    existingDetail.setId("mv-2");
    existingDetail.setWorkflowSource(new MetricView.WorkflowSource("w1", 1, MetricView.WorkflowSource.Purpose.detail));
    var manual = new MetricView();
    manual.setId("manual"); manual.setName("我的待办 · 虚机申请流程");
    when(metrics.queryList(any(), any(), any(), anyString()))
        .thenReturn(List.of(manual, existingPending, existingDetail));

    generator.generate(workflow);

    ArgumentCaptor<MetricView> saved = ArgumentCaptor.forClass(MetricView.class);
    verify(metrics, times(2)).publishWorkflowMetric(saved.capture(), anyString());
    // Reusing the ids is what makes a re-activation a refresh rather than a duplicate pair every time.
    assertTrue(saved.getAllValues().stream().anyMatch(metric -> "mv-1".equals(metric.getId())));
    assertTrue(saved.getAllValues().stream().anyMatch(metric -> "mv-2".equals(metric.getId())));
  }

  // ---------------------------------------------------------------- fixtures

  private static Workflow workflow(RunContract contract) {
    Workflow workflow = new Workflow();
    workflow.setId("w1");
    workflow.setName("虚机申请流程");
    workflow.setDomainId(DOMAIN);
    workflow.setStatus(Workflow.STATUS_ACTIVE);
    workflow.setVersion(2);
    workflow.setRunContract(contract);
    return workflow;
  }

  private static RunContract contract() {
    RunContract contract = new RunContract();
    contract.setClassName("vm_request");
    contract.setStepField("current_node");
    contract.setStatusField("status");
    contract.setStatusOpen(List.of("待办"));
    contract.setStatusDone(List.of("已完成"));
    contract.setAssigneeField("assignee_id");
    return contract;
  }

  private static Map<String, Object> classRule() {
    List<Map<String, Object>> attrs = new ArrayList<>();
    for (String[] field : new String[][]{
        {"id", "单号"}, {"current_node", "当前节点"}, {"status", "状态"}, {"assignee_id", "负责人"}}) {
      Map<String, Object> attr = new LinkedHashMap<>();
      attr.put("name", field[0]);
      attr.put("showName", field[1]);
      attrs.add(attr);
    }
    Map<String, Object> definition = new LinkedHashMap<>();
    definition.put("className", "vm_request");
    definition.put("attrs", attrs);
    Map<String, Object> rule = new LinkedHashMap<>();
    rule.put("classDef", List.of(definition));
    return rule;
  }

  @Test
  void sharedRunClassesWithoutAWorkflowReferenceRequireAModelDecision() throws Exception {
    var flow = workflow(contract());
    generator.generate(flow);
    var saved = ArgumentCaptor.forClass(MetricView.class);
    verify(metrics, times(2)).publishWorkflowMetric(saved.capture(), anyString());
    var metric = saved.getAllValues().stream().filter(MetricView::isWorkflowPending).findFirst().orElseThrow();
    var dao = mock(io.ontomato.dataengine.dao.WorkflowDao.class);
    when(dao.pendingRevision(DOMAIN,"w1",2)).thenReturn(
        new io.ontomato.dataengine.dao.WorkflowDao.PendingRevision(flow.getRunContract(), List.of(), true));
    var grants = mock(io.ontomato.dataengine.service.CapabilityGrantLookup.class);
    var query = new io.ontomato.dataengine.service.WorkflowPendingQuery(dao, grants, null);
    var access = new io.ontomato.dataengine.service.QueryAccessService.Access(
        new io.ontomato.dataengine.service.QueryAccessService.GrantUser("user", DOMAIN),
        new io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission(), null, null, null);
    var error = org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
        () -> query.execute("test",metric,new com.alibaba.fastjson2.JSONObject(),access,"en"));
    assertTrue(error.getMessage().contains("workflowRefField"));
    verifyNoInteractions(grants);
  }
}
