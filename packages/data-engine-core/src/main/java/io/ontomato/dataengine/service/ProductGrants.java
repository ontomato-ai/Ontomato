package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Objects;
import java.util.Set;

/** Pure Grant matching; a product use decision never authorizes business execution. */
public final class ProductGrants {
    private ProductGrants() {}
    public record Grant(String principalKind,String principalId,String verb) {}
    static boolean isValidVerb(String verb) {
        return "use".equals(verb) || "view".equals(verb) || "edit".equals(verb);
    }
    public static boolean allows(List<Grant> grants,String userId,Set<String> roles,String verb) {
        if(userId==null||!isValidVerb(verb))return false;
        return grants.stream().anyMatch(grant->Objects.equals(verb,grant.verb())&&switch(grant.principalKind()) {
            case "principal" -> Objects.equals(userId,grant.principalId());
            case "role" -> roles.contains(grant.principalId());
            case "domain" -> "*".equals(grant.principalId());
            default -> false;
        });
    }
}
