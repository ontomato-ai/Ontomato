package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.ProductPrincipalLookup;
import io.ontomato.dataengine.service.ProductGrants;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class AnonymousProductPrincipalLookup implements ProductPrincipalLookup {
    @Override
    public List<ProductGrants.Grant> defaultAdminGrants(String domainId, Collection<String> verbs) {
        return verbs.stream().map(verb -> new ProductGrants.Grant("principal", "system", verb)).toList();
    }

    @Override public String productPrincipalId(String userId) { return userId==null?null:"system"; }
    @Override public Set<String> effectiveRoles(String userId, String domainId) { return Set.of(); }
}
