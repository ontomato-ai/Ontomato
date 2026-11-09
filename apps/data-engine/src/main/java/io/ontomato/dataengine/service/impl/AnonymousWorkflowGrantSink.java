package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.WorkflowGrantSink;
import org.springframework.stereotype.Component;

/**
 * The open-source answer: there are no roles, so activating a workflow grants nothing.
 *
 * <p>A workflow still publishes a frozen revision and appends its events, because the record of what was
 * declared is useful on its own; only the authority it would convey has nowhere to go.</p>
 */
@Component
public class AnonymousWorkflowGrantSink implements WorkflowGrantSink {

    @Override
    public void grant(
            String domainId,
            String workflowId,
            String roleCode,
            String capabilityKind,
            String capabilityId,
            int workflowVersion) {
        // No roles to grant to.
    }

    @Override
    public void revokeActivatedBy(String domainId, String workflowId, int workflowVersion) {
        // Nothing was granted, so nothing is withdrawn.
    }
}
