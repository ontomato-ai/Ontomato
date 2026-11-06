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
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.WorkflowGrantSink;
import java.util.List;
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
  private WorkflowServiceImpl service;

  @BeforeEach
  void setUp() {
    workflows = mock(WorkflowDao.class);
    actions = mock(ActionDao.class);
    grants = mock(WorkflowGrantSink.class);
    service = new WorkflowServiceImpl(workflows, actions, grants);
    when(actions.queryById(anyString())).thenReturn(new Object[] {new Action(), null});
  }

  @Test
  void activationFreezesANewVersionAndGrantsEveryStep() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"), step(2, "FINANCE", "pay"));
    when(workflows.queryById("w1")).thenReturn(workflow);

    Workflow activated = service.activate("w1", DOMAIN, "U1");

    assertEquals(Workflow.STATUS_ACTIVE, activated.getStatus());
    assertEquals(1, activated.getVersion());
    verify(workflows).publishVersion(workflow);
    verify(grants).grant(DOMAIN, "LEADER", CapabilityGrantLookup.ACTION, "approve", 1);
    verify(grants).grant(DOMAIN, "FINANCE", CapabilityGrantLookup.ACTION, "pay", 1);
    verify(workflows).appendEvent(workflow, Workflow.EVENT_ACTIVATED, "U1");
  }

  @Test
  void aSecondActivationGetsItsOwnVersionNumber() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setVersion(3);
    when(workflows.queryById("w1")).thenReturn(workflow);

    service.activate("w1", DOMAIN, "U1");

    assertEquals(4, workflow.getVersion());
    verify(grants).grant(DOMAIN, "LEADER", CapabilityGrantLookup.ACTION, "approve", 4);
  }

  @Test
  void deactivationWithdrawsOnlyItsOwnVersion() {
    Workflow workflow = workflow(step(1, "LEADER", "approve"));
    workflow.setVersion(2);
    workflow.setStatus(Workflow.STATUS_ACTIVE);
    when(workflows.queryById("w1")).thenReturn(workflow);

    service.deactivate("w1", DOMAIN, "U1");

    assertEquals(Workflow.STATUS_INACTIVE, workflow.getStatus());
    verify(grants).revokeActivatedBy(DOMAIN, 2);
    verify(workflows).appendEvent(workflow, Workflow.EVENT_DEACTIVATED, "U1");
  }

  @Test
  void aStepWithoutARoleFailsActivationInsteadOfGrantingNothing() {
    Workflow workflow = workflow(step(1, null, "approve"));
    when(workflows.queryById("w1")).thenReturn(workflow);

    var refused = assertThrows(IllegalArgumentException.class, () -> service.activate("w1", DOMAIN, "U1"));

    assertTrue(refused.getMessage().contains("names no role"), refused.getMessage());
    verify(grants, never()).grant(anyString(), anyString(), anyString(), anyString(), anyInt());
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
    verify(grants, never()).grant(anyString(), anyString(), anyString(), anyString(), anyInt());
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
