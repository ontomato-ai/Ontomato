package io.ontomato.dataengine.service.impl;

import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.service.CapabilityGrantQuery;
import io.ontomato.dataengine.service.PlatformAccessQuery.RoleName;

/**
 * The open-source answer: no roles exist, so nothing was ever granted.
 *
 * <p>Returns an empty list rather than {@code null} — a reader that has to special-case "no answer"
 * ends up treating absence as an error, and an edition without roles is not an error.</p>
 */
@Component
public class AnonymousCapabilityGrantQuery implements CapabilityGrantQuery {

    @Override
    public List<Grant> grantsInDomain(String domainId) {
        return List.of();
    }

    @Override
    public List<RoleName> grantRoleNamesInDomain(String domainId, Set<String> roleIds) {
        return List.of();
    }

    @Override
    public WorkflowStepLinks workflowStepLinks(String domainId, String centerId, boolean outgoing) {
        return new WorkflowStepLinks(List.of(), List.of());
    }

    @Override
    public RoleCounts countRolesInDomain(String domainId) {
        return new RoleCounts(0, 0);
    }
}
