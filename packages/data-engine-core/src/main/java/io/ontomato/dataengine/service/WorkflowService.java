package io.ontomato.dataengine.service;

import java.util.List;

import io.ontomato.dataengine.bean.workflow.Workflow;

/** Reads and publishes workflows; publishing is what puts a version's grants in force. */
public interface WorkflowService {

    Workflow save(Workflow workflow);

    Workflow queryById(String id, String domainId);

    List<Workflow> queryList(String status, String domainId);

    /**
     * Make the workflow's current steps effective: freeze them as a new version, write its grants, and
     * append the activation event.
     *
     * @throws IllegalArgumentException when a step names no role, no action, or an unknown action type
     */
    Workflow activate(String id, String domainId, String principalId);

    /** Withdraw the grants this version activated, and append the deactivation event. */
    Workflow deactivate(String id, String domainId, String principalId);

    void delete(String id, String domainId);
}
