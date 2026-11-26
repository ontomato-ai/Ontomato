package io.ontomato.dataengine.service;

import java.util.Collection;
import java.util.List;
import java.util.Set;

/** Identity-owned principal and role resolution for legacy product grants. */
public interface ProductPrincipalLookup extends IdentityPrincipalDirectory {
    Set<String> effectiveRoles(String userId, String domainId);
    default String productPrincipalId(String userId){return userId;}
    default List<ProductGrants.Grant> defaultAdminGrants(String domainId, Collection<String> verbs) { return List.of(); }
}
