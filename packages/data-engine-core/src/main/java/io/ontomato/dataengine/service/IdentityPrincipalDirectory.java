package io.ontomato.dataengine.service;

import java.util.Collection;
import java.util.List;
import java.util.Map;

/** Display names and candidate searches scoped to the caller's domain. */
public interface IdentityPrincipalDirectory {
    record PrincipalOption(String id, String name) {}

    Map<String, String> principalNames(String domainId, Collection<String> principalIds);

    Map<String, String> roleNames(String domainId, Collection<String> roleIds);

    List<PrincipalOption> searchPrincipals(String domainId, String keyword, int limit);

    List<PrincipalOption> searchRoles(String domainId, String keyword, int limit);
}
