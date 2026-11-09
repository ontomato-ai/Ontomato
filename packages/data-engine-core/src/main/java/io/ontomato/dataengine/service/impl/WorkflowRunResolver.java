package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.ActionPreconditionService;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Names the workflow run an action is executing against, from what the server already proved.
 *
 * <p>This is the answer to "which run am I working on" without reading it from the caller's parameters.
 * The parameters do carry a run id, and a caller can pass any id it likes; what makes the value
 * trustworthy is the precondition evaluation that preceded it — every condition the action declared
 * about that object had to hold against stored state, including "this is assigned to me". Only objects
 * that survived that evaluation are considered here.</p>
 *
 * <p>Attribution is deliberately narrow. A run class is shared by every workflow that declares it, so
 * the class alone cannot say which process a run belongs to. A run is attributed only when exactly one
 * active workflow in the domain declares both that class <em>and</em> this action as one of its steps.
 * When two active workflows could both own it, the answer is no answer: reporting one of them would put
 * a fabricated provenance in front of the program, and a program that records provenance cannot tell a
 * guess from a fact. The proven objects stay visible so the program can still reason without it.</p>
 */
@Component
public class WorkflowRunResolver {

    private final WorkflowDao workflows;

    public WorkflowRunResolver(WorkflowDao workflows) {
        this.workflows = workflows;
    }

    /**
     * The run this action is executing against, or null when no single active workflow owns it.
     *
     * @param actionId the action being executed
     * @param proven objects the preconditions actually verified
     */
    public String resolve(
            String domainId, String actionId, List<ActionPreconditionService.Proven> proven) {
        if (domainId == null || actionId == null || proven == null || proven.isEmpty()) return null;

        List<String> candidates = new ArrayList<>();
        for (ActionPreconditionService.Proven object : proven) {
            if (object == null || object.objectId() == null) continue;
            for (Workflow workflow : workflows.queryList(Workflow.STATUS_ACTIVE, domainId)) {
                if (!object.className().equals(workflow.getRunClassName())) continue;
                if (!runsStep(workflow, actionId)) continue;
                if (!candidates.contains(object.objectId())) candidates.add(object.objectId());
            }
        }
        // Two possible runs means the snapshot would have to pick one; refusing is the honest answer.
        return candidates.size() == 1 ? candidates.get(0) : null;
    }

    /** Whether the revision in force lists this action as one of its steps. */
    private boolean runsStep(Workflow workflow, String actionId) {
        Integer version = workflow.getVersion();
        if (version == null) return false;
        for (WorkflowStep step : workflows.versionSteps(workflow.getId(), version)) {
            if (actionId.equals(step.getActionId())) return true;
        }
        return false;
    }
}
