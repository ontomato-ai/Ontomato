package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.authorization.AuthorizationService.ActionPath;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Standalone;
import io.ontomato.dataengine.service.authorization.AuthorizationService.WorkflowStep;

/** Execution facts captured by the action owner after checking the real target and caller. */
public record ActionRuntimeGrant(String domainId, String userId, String actionId, Row target, Step workflowStep) {
    public record Row(String className, String key) {}

    /** The workflow owner supplies the frozen step and its instance binding. */
    public record Step(String workflowId, int version, int stepNo, String runId, Row target) {}

    public static ActionRuntimeGrant capture(Action action, User user, JSONObject parameters, ActionPath path) {
        var target = action.getTarget();
        var row = target == null ? null : new Row(target.className(), target.key(parameters));
        Step evidence = null;
        if (path instanceof WorkflowStep step) {
            var bound = step.targetClass() == null ? null : new Row(step.targetClass(), step.targetKey());
            evidence = new Step(step.workflowId(), step.version(), step.stepNo(), step.runId(), bound);
        }
        return new ActionRuntimeGrant(user.getDomainId(), user.getId(), action.getId(), row, evidence);
    }

    public ActionPath path() {
        if (workflowStep == null) return new Standalone();
        var bound = workflowStep.target();
        return new WorkflowStep(workflowStep.workflowId(), workflowStep.version(), workflowStep.stepNo(),
                workflowStep.runId(), bound == null ? null : bound.className(), bound == null ? null : bound.key());
    }

    /** Implemented by the action owner. Policy, target and workflow checks stay with their owners. */
    @FunctionalInterface
    public interface Owner {
        void requireCurrent(User user, ActionRuntimeGrant grant, ExecutionTarget execution) throws Exception;
    }
}
