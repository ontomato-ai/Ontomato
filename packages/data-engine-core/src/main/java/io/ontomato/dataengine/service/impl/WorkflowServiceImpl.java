package io.ontomato.dataengine.service.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

import org.springframework.stereotype.Service;

import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.WorkflowGrantSink;
import io.ontomato.dataengine.service.WorkflowService;

/**
 * Publishes workflows as units of authority.
 *
 * <p>Activation freezes the current steps as a numbered revision, writes the grants those steps name,
 * and appends an event. Nothing here runs a process: a step's owner does their own step, and the
 * action's preconditions decide whether it is their turn. Deactivation withdraws only what this
 * version granted, so an earlier revision still in force is not silently removed.</p>
 */
@Service
public class WorkflowServiceImpl implements WorkflowService {

    private final WorkflowDao workflows;
    private final ActionDao actions;
    private final WorkflowGrantSink grants;

    public WorkflowServiceImpl(WorkflowDao workflows, ActionDao actions, WorkflowGrantSink grants) {
        this.workflows = workflows;
        this.actions = actions;
        this.grants = grants;
    }

    @Override
    public Workflow save(Workflow workflow) {
        requireIdentity(workflow);
        if (workflow.getStatus() == null) workflow.setStatus(Workflow.STATUS_DRAFT);
        if (Workflow.STATUS_ACTIVE.equals(workflow.getStatus())) {
            throw new IllegalArgumentException("Activating a workflow is its own operation");
        }
        validate(workflow, workflow.getDomainId());
        return workflows.save(workflow);
    }

    @Override
    public Workflow queryById(String id, String domainId) {
        Workflow workflow = workflows.queryById(id);
        return workflow == null || !Objects.equals(domainId, workflow.getDomainId()) ? null : workflow;
    }

    @Override
    public List<Workflow> queryList(String status, String domainId) {
        return workflows.queryList(status, domainId);
    }

    @Override
    public Workflow activate(String id, String domainId, String principalId) {
        Workflow workflow = require(id, domainId);
        validate(workflow, domainId);

        // A revision is numbered from the highest one already published, so a draft edit cannot reuse a
        // version number whose grants and steps are already on record.
        int version = (workflow.getVersion() == null ? 0 : workflow.getVersion()) + 1;
        workflow.setVersion(version);
        workflow.setStatus(Workflow.STATUS_ACTIVE);
        workflows.publishVersion(workflow);
        workflows.save(workflow);

        for (WorkflowStep step : workflow.getSteps()) {
            grants.grant(domainId, step.getRoleCode(), CapabilityGrantLookup.ACTION, step.getActionId(), version);
        }
        workflows.appendEvent(workflow, Workflow.EVENT_ACTIVATED, principalId);
        grants.activated(workflow, principalId);
        return workflow;
    }

    @Override
    public Workflow deactivate(String id, String domainId, String principalId) {
        Workflow workflow = require(id, domainId);
        if (!Workflow.STATUS_ACTIVE.equals(workflow.getStatus())) {
            throw new IllegalArgumentException("Only an active workflow can be deactivated");
        }
        workflow.setStatus(Workflow.STATUS_INACTIVE);
        workflows.save(workflow);
        grants.revokeActivatedBy(domainId, workflow.getVersion() == null ? 0 : workflow.getVersion());
        workflows.appendEvent(workflow, Workflow.EVENT_DEACTIVATED, principalId);
        grants.deactivated(workflow, principalId);
        return workflow;
    }

    @Override
    public void delete(String id, String domainId) {
        Workflow workflow = require(id, domainId);
        if (Workflow.STATUS_ACTIVE.equals(workflow.getStatus())) {
            // Deleting an active workflow would remove authority without a record of doing so.
            throw new IllegalArgumentException("Deactivate a workflow before deleting it");
        }
        workflows.delete(id);
        workflows.deleteVersionRows(id);
    }

    private Workflow require(String id, String domainId) {
        Workflow workflow = queryById(id, domainId);
        if (workflow == null) throw new IllegalArgumentException("Workflow not found");
        return workflow;
    }

    private void requireIdentity(Workflow workflow) {
        if (workflow.getDomainId() == null || workflow.getDomainId().isBlank()) {
            throw new IllegalArgumentException("A workflow requires its domain");
        }
        if (workflow.getName() == null || workflow.getName().isBlank()) {
            throw new IllegalArgumentException("A workflow requires its name");
        }
    }

    /** A step must name a role and an action that exists in this domain, or activation grants nothing. */
    private void validate(Workflow workflow, String domainId) {
        List<WorkflowStep> steps = workflow.getSteps();
        if (steps == null || steps.isEmpty()) return;
        List<String> problems = new ArrayList<>();
        for (WorkflowStep step : steps) {
            String where = "step " + step.getStepNo();
            if (step.getRoleCode() == null || step.getRoleCode().isBlank()) {
                problems.add(where + " names no role");
            }
            if (step.getActionId() == null || step.getActionId().isBlank()) {
                problems.add(where + " names no action");
            } else if (actions.queryById(step.getActionId()) == null) {
                problems.add(where + " names an unknown action: " + step.getActionId());
            }
            if (step.getActionType() != null && !WorkflowStep.actionTypes().contains(step.getActionType())) {
                problems.add(where + " has an unknown action type: " + step.getActionType());
            }
            if (step.getAssignRule() != null && !WorkflowStep.assignRules().contains(step.getAssignRule())) {
                problems.add(where + " has an unknown assignment rule: " + step.getAssignRule());
            }
        }
        if (!problems.isEmpty()) throw new IllegalArgumentException(String.join("; ", problems));
    }
}
