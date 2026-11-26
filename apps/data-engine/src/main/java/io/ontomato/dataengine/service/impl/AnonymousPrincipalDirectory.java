package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.IdentityPrincipalDirectory;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class AnonymousPrincipalDirectory implements IdentityPrincipalDirectory {
    @Override
    public Map<String, String> principalNames(String domainId, Collection<String> principalIds) {
        return Map.of();
    }

    @Override
    public Map<String, String> roleNames(String domainId, Collection<String> roleIds) {
        return Map.of();
    }

    @Override
    public List<PrincipalOption> searchPrincipals(String domainId, String keyword, int limit) {
        return List.of();
    }

    @Override
    public List<PrincipalOption> searchRoles(String domainId, String keyword, int limit) {
        return List.of();
    }
}
