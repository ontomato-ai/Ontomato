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
 * <p>The pending query is the one that decides whether "I have nothing pending" is an answer or a
 * failure, so these cases pin the two things that make it trustworthy: the owner is a server-filled
 * subject reference, and a contract without an owner field produces no such query at all rather than
 * one that quietly lists everyone's work.</p>
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
    when(metrics.save(any(), anyString())).thenAnswer(call -> call.getArgument(0));
    when(admin.getJSONRule(DOMAIN)).thenReturn(classRule());
  }

  @Test
  void generatesAPendingQueryAndADetailQuery() throws Exception {
    Workflow workflow = workflow(contract());

    WorkflowMetricGenerator.Generated generated = generator.generate(workflow);

    ArgumentCaptor<MetricView> saved = ArgumentCaptor.forClass(MetricView.class);
    verify(metrics, times(2)).save(saved.capture(), anyString());
    assertEquals(2, generated.names().size());
    assertTrue(generated.warnings().isEmpty(), generated.warnings().toString());

    MetricView pending = saved.getAllValues().stream()
        .filter(metric -> metric.getName().startsWith("我的待办"))
        .findFirst()
        .orElseThrow();
    String bundle = pending.getFunction().getQueryPackage().toJSONString();
    // The caller cannot choose the owner: the server fills it from the authenticated request.
    assertTrue(bundle.contains("{{account.id}}"), bundle);
    // Owner and state: the pointer targets the owner inside the and-group, and the open state is fixed.
    assertTrue(bundle.contains(
        "\"pointer\":\"/answer/steps/0/graph/patterns/0/objects/0/conditions/properties/and/0/value\""), bundle);
    assertTrue(bundle.contains("待办"), bundle);
    assertTrue(bundle.contains("vm_request"), bundle);
    assertEquals("{{account.id}}", pending.getBindings().get(0).getParameters().getString("assignee"));
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
  void aContractWithoutAnOwnerProducesOnlyTheDetailQuery() throws Exception {
    RunContract contract = contract();
    contract.setAssigneeField(null);

    WorkflowMetricGenerator.Generated generated = generator.generate(workflow(contract));

    verify(metrics, times(1)).save(any(), anyString());
    assertEquals(1, generated.names().size());
    // Refusing is the point: a pending query with no owner field would list everyone's work as "mine".
    assertTrue(generated.warnings().stream().anyMatch(w -> w.contains("assigneeField")), generated.warnings().toString());
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
    existingPending.setName("我的待办 · 虚机申请流程");
    existingPending.setBindings(new ArrayList<>());
    MetricView existingDetail = new MetricView();
    existingDetail.setId("mv-2");
    existingDetail.setName("单据详情 · 虚机申请流程");
    when(metrics.queryList(any(), any(), any(), anyString()))
        .thenReturn(List.of(existingPending, existingDetail));

    generator.generate(workflow);

    ArgumentCaptor<MetricView> saved = ArgumentCaptor.forClass(MetricView.class);
    verify(metrics, times(2)).save(saved.capture(), anyString());
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
    workflow.setStatus(Workflow.STATUS_DRAFT);
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
}
