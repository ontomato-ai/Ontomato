package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.PermissionPolicyDirectory;
import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class AnonymousPermissionPolicyDirectory implements PermissionPolicyDirectory {
    @Override
    public List<Policy> listPolicies(String domainId) {
        return List.of();
    }

    @Override
    public List<RolePolicy> listRolePolicies(String domainId) {
        return List.of();
    }

    @Override
    public List<PolicyDataPermission> listPolicyDataPermissions(String domainId) {
        return List.of();
    }
}
