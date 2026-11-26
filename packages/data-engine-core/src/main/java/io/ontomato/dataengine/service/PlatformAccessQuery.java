package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Set;

/** Domain role directory with grants from the authorization module. */
public interface PlatformAccessQuery {

    /** Fixed administrator operations are identified by the flag, alongside assigned operation IDs. */
    record RoleAccess(String roleId, String roleCode, Set<String> managementOperations,
                      boolean managementRole, boolean canCreateWorkflow) {}

    List<RoleAccess> rolesInDomain(String domainId);

    long countRolesInDomain(String domainId);
}
