package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.dao.WorkflowDao;
import org.springframework.stereotype.Component;

/** Attribute a verified target only when one active workflow uses its class and action. */
@Component
public class WorkflowRunResolver {
    private final WorkflowDao workflows;

    public WorkflowRunResolver(WorkflowDao workflows) { this.workflows = workflows; }

    public String resolve(String domainId, String actionId, String className, String key) {
        long owners = workflows.queryList(Workflow.STATUS_ACTIVE, domainId).stream()
                .filter(workflow -> className.equals(workflow.getRunClassName()))
                .filter(workflow -> workflow.getSteps().stream().anyMatch(step -> actionId.equals(step.getActionId())))
                .limit(2).count();
        return owners == 1 ? key : null;
    }

}
