package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;
import io.ontomato.dataengine.dao.WorkflowDao;
import org.springframework.stereotype.Component;

/** Attribute a verified target only when one active workflow uses its class and action. */
@Component
public class WorkflowRunResolver {
    private final WorkflowDao workflows;

    public WorkflowRunResolver(WorkflowDao workflows) { this.workflows = workflows; }

    public String resolve(String domainId, String actionId, String className, String key) {
        long owners = workflows.queryList(Workflow.STATUS_ACTIVE, domainId).stream()
                .filter(workflow -> className.equals(workflow.getRunClassName()) && runsStep(workflow, actionId))
                .limit(2).count();
        return owners == 1 ? key : null;
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
