package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Set;

/**
 * Which roles may perform a platform operation, and what each role may touch.
 *
 * <p>Platform operations and business capabilities are two separate authorization paths and must stay
 * that way: a role that may run 审批通过 is not thereby allowed to author workflows, and a role that may
 * author workflows is not thereby allowed to run the business actions inside them. The action executor
 * asks {@link CapabilityGrantLookup}; the request interceptor asks the platform path. Merging the two
 * would let a role grant itself work by editing its own permissions.</p>
 *
 * <p>The interceptor already enforces its side at request time. What it cannot do is explain itself: an
 * operator asking "which roles may create a workflow in this domain" has no answer without walking
 * role → post → api-permission by hand. This interface is that answer, read-only.</p>
 */
public interface PlatformAccessQuery {

    /**
     * One role and the platform operations it holds.
     *
     * @param roleCode the role's code in this domain, the same vocabulary a workflow step uses
     * @param apiPermissions the request paths this role may call, as the interceptor compares them
     * @param managementRole true when the role holds every enabled operation by rule rather than by
     *     listed rows; {@code apiPermissions} is then empty because expanding it here would go stale
     *     the moment an endpoint is added
     */
    record RoleAccess(String roleId, String roleCode, Set<String> apiPermissions, boolean managementRole) {}

    /** Every role in the domain with its platform operations. Bounded by the domain's roles. */
    List<RoleAccess> rolesInDomain(String domainId);
}
