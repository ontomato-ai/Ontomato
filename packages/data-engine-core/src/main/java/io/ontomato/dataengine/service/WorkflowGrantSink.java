package io.ontomato.dataengine.service;

import io.ontomato.dataengine.bean.workflow.Workflow;

/**
 * Writes the grants a workflow version activates.
 *
 * <p>A workflow is the published unit of authority for a business process: activating one lets the
 * roles its steps name run the actions those steps name. The authority therefore has to be written
 * somewhere durable that the action executor already consults, and it has to name the version that
 * granted it — otherwise an audit asking "why may this role approve this report now" has no answer.</p>
 *
 * <p>The open-source edition has no roles and writes nothing; the enterprise edition writes the role's
 * capability grants.</p>
 */
public interface WorkflowGrantSink {

    /**
     * Grant one capability to the role a step names, recording the workflow version that activated it.
     *
     * @param roleCode the role the step names, in the business vocabulary the workflow was written in
     * @param capabilityKind one of {@link CapabilityGrantLookup#KINDS}
     */
    void grant(
            String domainId,
            String roleCode,
            String capabilityKind,
            String capabilityId,
            int workflowVersion);

    /**
     * Withdraw exactly the grants that this workflow version activated.
     *
     * <p>Scoped by version, not by workflow: deactivating the current revision must not silently remove
     * authority that an earlier revision granted and that is still in force.</p>
     */
    void revokeActivatedBy(String domainId, int workflowVersion);

    /** Record that a workflow became effective, so the change itself is auditable. */
    default void activated(Workflow workflow, String principalId) {}

    /** Record that a workflow stopped being effective. */
    default void deactivated(Workflow workflow, String principalId) {}
}
