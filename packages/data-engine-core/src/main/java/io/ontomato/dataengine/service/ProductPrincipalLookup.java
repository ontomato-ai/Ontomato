package io.ontomato.dataengine.service;

import java.util.Set;

/** Identity-owned role resolution for product Grant decisions. */
public interface ProductPrincipalLookup {
    Set<String> effectiveRoles(String userId, String domainId);
    default String productPrincipalId(String userId){return userId;}
    /** Import legacy application entry and maintenance authority once, at the identity boundary. */
    default java.util.List<ProductGrants.Grant> legacyApplicationGrants(String domainId,String applicationId){return java.util.List.of();}
}
