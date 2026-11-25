package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.authorization.ActionAuthorization.Denied;
import io.ontomato.dataengine.service.authorization.AuthorizationService.WorkflowStep;
import org.springframework.stereotype.Component;

/** Checks the step asserted by the instance owner against the effective frozen definition. */
@Component
public class WorkflowRunResolver {
    private final WorkflowDao workflows;

    public WorkflowRunResolver(WorkflowDao workflows) {
        this.workflows = workflows;
    }

    public void requireActiveStep(Action action, WorkflowStep execution) {
        var workflow = workflows.queryActiveById(execution.workflowId(), action.getDomainId());
        if (workflow == null || workflow.getVersion() != execution.version()
                || workflow.getSteps().stream().noneMatch(step -> step.getStepNo() == execution.stepNo()
                    && action.getId().equals(step.getActionId())))
            throw new Denied("WORKFLOW_STEP_FORBIDDEN", "The workflow step is no longer effective for this action.");
    }
}
