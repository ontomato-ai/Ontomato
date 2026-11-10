package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.workflow.RunContract;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.WorkflowGrantSink;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Activation is the moment a process becomes able to convey authority, so these cases fix what may and
 * may not happen there: a step without a role or action must fail rather than grant nothing quietly, a
 * revision must get its own number, and deactivation must withdraw only its own version.
 */
class WorkflowServiceImplTest {

  private static final String DOMAIN = "d1";

  private WorkflowDao workflows;
  private ActionDao actions;
  private WorkflowGrantSink grants;
  private AdminService admin;
  private WorkflowMetricGenerator metricGenerator;
  private WorkflowServiceImpl service;

  @BeforeEach
  void setUp() {
    workflows = mock(WorkflowDao.class);
    actions = mock(ActionDao.class);
    grants = mock(WorkflowGrantSink.class);
    admin = mock(AdminService.class);
    metricGenerator = mock(WorkflowMetricGenerator.class);
    service = new WorkflowServiceImpl(workflows, actions, grants, admin, metricGenerator);
    when(actions.queryById(anyString())).thenReturn(new Object[] {new Action(), null});
    when(metricGenerator.generate(any()))
        .thenReturn(new WorkflowMetricGenerator.Generated(List.of(), List.of()));
    when(admin.getJSONRule(DOMAIN))
        .thenReturn(classRule("workflow_instance", "id", "current_node", "status", "assignee_id"));
  }

  @Test
  void activationFreezesANewVersionAndGrantsEveryStep() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"), step(2, "FINANCE", "pay"));
    when(workflows.queryById("w1")).thenReturn(workflow);
    // The number comes from the DAO, which allocates it from the frozen revisions; the service must
    // grant exactly what was frozen rather than a number it computed itself.
    when(workflows.publishVersion(workflow)).thenReturn(1);

    Workflow activated = service.activate("w1", DOMAIN, "U1");

    assertEquals(Workflow.STATUS_ACTIVE, activated.getStatus());
    assertEquals(1, activated.getVersion());
    verify(workflows).publishVersion(workflow);
    verify(grants).grant(DOMAIN, "w1", "LEADER", CapabilityGrantLookup.ACTION, "approve", 1);
    verify(grants).grant(DOMAIN, "w1", "FINANCE", CapabilityGrantLookup.ACTION, "pay", 1);
    verify(workflows).appendEvent(workflow, Workflow.EVENT_ACTIVATED, "U1");
  }

  @Test
  void activationGrantsTheRevisionTheDaoFrozeNotOneDerivedFromTheStaleRow() {
    // The bug this guards: a draft edit leaves the row's version at 0 even though revision 1 is
    // published. Deriving "next" from the row would grant v1 again while the frozen v1 holds other
    // steps — the grants and the audited revision would describe different processes.
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setVersion(0);
    when(workflows.queryById("w1")).thenReturn(workflow);
    when(workflows.publishVersion(workflow)).thenReturn(2);

    Workflow activated = service.activate("w1", DOMAIN, "U1");

    assertEquals(2, activated.getVersion());
    verify(grants).grant(DOMAIN, "w1", "LEADER", CapabilityGrantLookup.ACTION, "approve", 2);
    verify(grants, never()).grant(anyString(), anyString(), anyString(), anyString(), anyString(), eq(1));
  }

  @Test
  void deactivationWithdrawsOnlyItsOwnVersion() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setVersion(2);
    workflow.setStatus(Workflow.STATUS_ACTIVE);
    when(workflows.queryById("w1")).thenReturn(workflow);

    service.deactivate("w1", DOMAIN, "U1");

    assertEquals(Workflow.STATUS_INACTIVE, workflow.getStatus());
    verify(grants).revokeActivatedBy(DOMAIN, "w1", 2);
    verify(workflows).appendEvent(workflow, Workflow.EVENT_DEACTIVATED, "U1");
  }

  @Test
  void aStepWithoutARoleFailsActivationInsteadOfGrantingNothing() {
    Workflow workflow = workflow(step(1, null, "approve"));
    when(workflows.queryById("w1")).thenReturn(workflow);

    var refused = assertThrows(IllegalArgumentException.class, () -> service.activate("w1", DOMAIN, "U1"));

    assertTrue(refused.getMessage().contains("names no role"), refused.getMessage());
    verify(grants, never()).grant(anyString(), anyString(), anyString(), anyString(), anyString(), anyInt());
  }

  @Test
  void aStepNamingAnUnknownActionFailsActivation() {
    Workflow workflow = workflow(step(1, "LEADER", "missing"));
    when(workflows.queryById("w1")).thenReturn(workflow);
    when(actions.queryById("missing")).thenReturn(null);

    var refused = assertThrows(IllegalArgumentException.class, () -> service.activate("w1", DOMAIN, "U1"));

    assertTrue(refused.getMessage().contains("unknown action"), refused.getMessage());
  }

  @Test
  void savingCannotActivateDirectly() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setStatus(Workflow.STATUS_ACTIVE);

    assertThrows(IllegalArgumentException.class, () -> service.save(workflow));
    verify(grants, never()).grant(anyString(), anyString(), anyString(), anyString(), anyString(), anyInt());
  }

  @Test
  void aWorkflowFromAnotherDomainIsNotVisible() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    when(workflows.queryById("w1")).thenReturn(workflow);

    assertEquals(null, service.queryById("w1", "other"));
  }

  @Test
  void anActiveWorkflowMustBeDeactivatedBeforeDeletion() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setStatus(Workflow.STATUS_ACTIVE);
    when(workflows.queryById("w1")).thenReturn(workflow);

    assertThrows(IllegalArgumentException.class, () -> service.delete("w1", DOMAIN));
    verify(workflows, never()).delete(anyString());
  }

  @Test
  void deletingADraftRemovesItsHistoryToo() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setStatus(Workflow.STATUS_DRAFT);
    when(workflows.queryById("w1")).thenReturn(workflow);

    service.delete("w1", DOMAIN);

    verify(workflows, times(1)).delete("w1");
    verify(workflows, times(1)).deleteVersionRows("w1");
  }

  // ---------- the declared run contract ----------

  @Test
  void aDeclaredRunContractIsAcceptedAndSuppliesTheClassName() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setRunContract(contract("workflow_instance", "current_node", "status", List.of("待办")));

    service.save(workflow);

    // Both names describe the same object: the contract fills in the older field when it is unset.
    assertEquals("workflow_instance", workflow.getRunClassName());
    // The identity field may be left out; a reader may then rely on "id" without repeating fallbacks.
    assertEquals("id", workflow.getRunContract().getIdField());
    verify(workflows).save(workflow);
  }

  @Test
  void aWorkflowWithoutAContractStaysAllowed() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));

    service.save(workflow);

    // Not declaring a contract costs the generic read capabilities, not the ability to run the process.
    assertThrows(IllegalArgumentException.class, () -> {
      Workflow broken = workflow(step(1, "LEADER", "approve"));
      broken.setRunContract(contract("workflow_instance", "current_node", "status", List.of()));
      service.save(broken);
    });
    verify(workflows).save(workflow);
  }

  @Test
  void aContractNamingAnUnknownClassIsRefused() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setRunContract(contract("no_such_class", "current_node", "status", List.of("待办")));

    IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> service.save(workflow));

    assertTrue(error.getMessage().contains("does not exist in this domain"), error.getMessage());
    verify(workflows, never()).save(any());
  }

  @Test
  void aContractNamingAnAttributeTheClassLacksIsRefused() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setRunContract(contract("workflow_instance", "current_stp", "status", List.of("待办")));

    IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> service.save(workflow));

    // This is the failure a contract exists to catch: a typo that would otherwise match nothing at read time.
    assertTrue(error.getMessage().contains("current_stp"), error.getMessage());
    verify(workflows, never()).save(any());
  }

  @Test
  void aContractWithoutOpenStatusesIsRefused() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setRunContract(contract("workflow_instance", "current_node", "status", List.of()));

    IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> service.save(workflow));

    assertTrue(error.getMessage().contains("no open status values"), error.getMessage());
  }

  @Test
  void aContractWithOverlappingStateGroupsIsRefused() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    RunContract contract = contract("workflow_instance", "current_node", "status", List.of("待办"));
    contract.setStatusDone(List.of("待办"));
    workflow.setRunContract(contract);

    IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> service.save(workflow));

    // A run that is both open and finished leaves every reader without an answer.
    assertTrue(error.getMessage().contains("more than one state group"), error.getMessage());
  }

  @Test
  void runClassNameAndTheContractMustNameTheSameClass() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setRunClassName("other_class");
    workflow.setRunContract(contract("workflow_instance", "current_node", "status", List.of("待办")));

    IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> service.save(workflow));

    assertTrue(error.getMessage().contains("name different classes"), error.getMessage());
  }

  @Test
  void activationRefusesAContractThatCannotBeRead() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setRunContract(contract("workflow_instance", "current_stp", "status", List.of("待办")));
    when(workflows.queryById("w1")).thenReturn(workflow);

    assertThrows(IllegalArgumentException.class, () -> service.activate("w1", DOMAIN, "U1"));

    // Nothing may be granted for a revision whose run contract was never verified.
    verify(grants, never()).grant(any(), any(), any(), any(), any(), anyInt());
    verify(workflows, never()).publishVersion(any());
  }

  // ---------- read capabilities generated at activation ----------

  @Test
  void activationGeneratesTheRevisionReadCapabilities() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    when(workflows.queryById("w1")).thenReturn(workflow);
    when(workflows.publishVersion(workflow)).thenReturn(1);

    service.activate("w1", DOMAIN, "U1");

    // Generated from the revision that just took effect, so the queries follow the steps in force.
    verify(metricGenerator).generate(workflow);
  }

  @Test
  void activationReportsWhatCouldNotBeGenerated() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    when(workflows.queryById("w1")).thenReturn(workflow);
    when(workflows.publishVersion(workflow)).thenReturn(1);
    when(metricGenerator.generate(any()))
        .thenReturn(new WorkflowMetricGenerator.Generated(
            List.of("我的待办"), List.of("运行契约未声明 assigneeField")));

    Workflow activated = service.activate("w1", DOMAIN, "U1");

    // The operator must be able to tell "no query" from "no pending items".
    assertEquals(List.of("运行契约未声明 assigneeField"), activated.getActivationNotes());
  }

  @Test
  void aGenerationFailureDoesNotRollBackAuthority() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    when(workflows.queryById("w1")).thenReturn(workflow);
    when(workflows.publishVersion(workflow)).thenReturn(1);
    when(metricGenerator.generate(any())).thenThrow(new IllegalStateException("boom"));

    Workflow activated = service.activate("w1", DOMAIN, "U1");

    // Authority is already in force; a convenience query failing must not take it back.
    assertEquals(Workflow.STATUS_ACTIVE, activated.getStatus());
    verify(grants, times(1)).grant(any(), any(), any(), any(), any(), anyInt());
    assertTrue(activated.getActivationNotes().get(0).contains("boom"), activated.getActivationNotes().toString());
  }

  private static RunContract contract(
      String className, String stepField, String statusField, List<String> open) {
    RunContract contract = new RunContract();
    contract.setClassName(className);
    contract.setStepField(stepField);
    contract.setStatusField(statusField);
    contract.setStatusOpen(open);
    contract.setAssigneeField("assignee_id");
    return contract;
  }

  /** The shape {@code AdminService.getJSONRule} returns: a classDef list of maps with attrs. */
  private static Map<String, Object> classRule(String className, String... attributes) {
    List<Map<String, Object>> attrs = new ArrayList<>();
    for (String attribute : attributes) attrs.add(Map.of("name", attribute));
    Map<String, Object> definition = new LinkedHashMap<>();
    definition.put("className", className);
    definition.put("attrs", attrs);
    Map<String, Object> rule = new LinkedHashMap<>();
    rule.put("classDef", List.of(definition));
    return rule;
  }

  private static Workflow workflow(WorkflowStep... steps) {
    Workflow workflow = new Workflow();
    workflow.setId("w1");
    workflow.setName("标准报销流程");
    workflow.setDomainId(DOMAIN);
    workflow.setStatus(Workflow.STATUS_DRAFT);
    workflow.setSteps(List.of(steps));
    return workflow;
  }

  private static WorkflowStep step(int no, String roleCode, String actionId) {
    WorkflowStep step = new WorkflowStep();
    step.setStepNo(no);
    step.setName("step " + no);
    step.setRoleCode(roleCode);
    step.setActionId(actionId);
    step.setActionType(WorkflowStep.ACTION_TYPE_APPROVE);
    step.setAssignRule(WorkflowStep.ASSIGN_GLOBAL_ROLE);
    return step;
  }
}
