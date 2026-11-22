package io.ontomato.dataengine.service;

import java.util.Collection;
import java.util.Map;
import java.util.Set;

/** Identity-owned role resolution for product Grant decisions. */
public interface ProductPrincipalLookup {
    Set<String> effectiveRoles(String userId, String domainId);
    default String productPrincipalId(String userId){return userId;}
    /** Import legacy application entry and maintenance authority once, at the identity boundary. */
    default java.util.List<ProductGrants.Grant> legacyApplicationGrants(String domainId,String applicationId){return java.util.List.of();}
    /** Resolve user display names by principal ID in a domain; missing IDs are omitted. */
    default Map<String, String> principalNames(String domainId, Collection<String> principalIds) { return Map.of(); }
    /** Resolve role display names by role ID in a domain; missing IDs are omitted. */
    default Map<String, String> roleNames(String domainId, Collection<String> roleIds) { return Map.of(); }
}
