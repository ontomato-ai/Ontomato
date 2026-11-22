package io.ontomato.dataengine.service;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Identity-owned role and display-name resolution for product Grant decisions. */
public interface ProductPrincipalLookup {
    record PrincipalOption(String id, String name) {}

    Set<String> effectiveRoles(String userId, String domainId);
    default String productPrincipalId(String userId){return userId;}
    /** Import legacy application entry and maintenance authority once, at the identity boundary. */
    default List<ProductGrants.Grant> legacyApplicationGrants(String domainId,String applicationId){return List.of();}
    /** Resolve user display names by principal ID in a domain; missing IDs are omitted. */
    default Map<String, String> principalNames(String domainId, Collection<String> principalIds) { return Map.of(); }
    /** Resolve role display names by role ID in a domain; missing IDs are omitted. */
    default Map<String, String> roleNames(String domainId, Collection<String> roleIds) { return Map.of(); }
    /** Search selectable domain members by optional keyword for product grant pickers. */
    default List<PrincipalOption> searchPrincipals(String domainId, String keyword, int limit) { return List.of(); }
    /** Search selectable domain roles by optional keyword for product grant pickers. */
    default List<PrincipalOption> searchRoles(String domainId, String keyword, int limit) { return List.of(); }
}
