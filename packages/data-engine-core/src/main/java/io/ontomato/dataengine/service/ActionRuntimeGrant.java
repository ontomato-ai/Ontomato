package io.ontomato.dataengine.service;

import io.ontomato.dataengine.core.bean.User;

/** Execution facts captured by the action owner after checking the real target and caller. */
public record ActionRuntimeGrant(String domainId, String userId, String actionId, Row target, Step workflowStep) {
    public record Row(String className, String key) {}

    /** The workflow owner supplies the frozen step and its instance binding. */
    public record Step(String workflowId, int version, int stepNo, String runId, Row target) {}

    /** Implemented by the action owner. Policy, target and workflow checks stay with their owners. */
    @FunctionalInterface
    public interface Owner {
        void requireCurrent(User user, ActionRuntimeGrant grant, ExecutionTarget execution) throws Exception;
    }
}
