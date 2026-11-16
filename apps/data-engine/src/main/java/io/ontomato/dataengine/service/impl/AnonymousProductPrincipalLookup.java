package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.ProductPrincipalLookup;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public class AnonymousProductPrincipalLookup implements ProductPrincipalLookup {
    @Override public String productPrincipalId(String userId) { return userId==null?null:"system"; }
    @Override public Set<String> effectiveRoles(String userId, String domainId) { return Set.of(); }
}
