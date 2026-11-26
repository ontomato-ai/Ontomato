package io.ontomato.dataengine.service;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.bean.workflow.WorkflowDirectoryEntry;
import io.ontomato.dataengine.service.PlatformAccessQuery.RoleName;
import java.util.List;
import java.util.Set;

/**
 * Reads the capability grants in force in a domain.
 *
 * <p>{@link CapabilityGrantLookup} answers one question at execution time — "may this subject use this
 * action" — and never has to explain itself. An operator asking "what does this revision actually
 * approve" needs the opposite view: every row, with the role and the version that put it there. Without
 * that view a published workflow can only be audited by reading table dumps, so the grants become
 * write-only from the product's own point of view.</p>
 *
 * <p>The open-source edition has no roles and grants nothing, so it returns an empty list; the
 * enterprise edition reads the role-capability rows and resolves their role names.</p>
 */
public interface CapabilityGrantQuery {

    /** One grant, named the way an operator reads it rather than the way it is stored. */
    record Grant(
            String roleId,
            /** The domain role's display name (role_name), also used by workflow steps. */
            String roleCode,
            String capabilityKind,
            String capabilityId,
            String capabilityVersion,
            /** The workflow that activated this grant; null when granted directly. */
            String workflowId,
            /** The workflow revision that activated this grant; null when granted directly. */
            String activatedByWorkflowVersion, Integer stepNo, GrantScope scope, boolean inForce) {}

    /** Every grant in the domain. Read-only and unpaged: a domain's grants are bounded by its roles. */
    List<Grant> grantsInDomain(String domainId);

    List<RoleName> grantRoleNamesInDomain(String domainId, Set<String> roleIds);

    record WorkflowStepLink(String roleId, String roleCode, String workflowId, int stepNo,
                            String activatedByWorkflowVersion, GrantScope scope) {}

    record WorkflowStepLinks(List<WorkflowStepLink> links, List<WorkflowDirectoryEntry> workflows) {}

    WorkflowStepLinks workflowStepLinks(String domainId, String centerId, boolean outgoing);

    /** Distinct grant role IDs, and how many are not present in the current domain's role directory. */
    record RoleCounts(long total, long outsideDirectory) {}

    RoleCounts countRolesInDomain(String domainId);
}
