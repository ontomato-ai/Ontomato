package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.OrganizationDirectory;
import io.ontomato.dataengine.service.PermissionPolicyDirectory;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GovernanceDirectoryController {
    private final IdentityService identity;
    private final OrganizationDirectory organization;
    private final PermissionPolicyDirectory policies;

    public GovernanceDirectoryController(IdentityService identity, OrganizationDirectory organization,
        PermissionPolicyDirectory policies) {
        this.identity = identity;
        this.organization = organization;
        this.policies = policies;
    }

    @PostMapping("/platform/governance/organization")
    public OrganizationDirectory.Snapshot organization() {
        return organization.snapshot(identity.getCurrentUser().getDomainId());
    }

    @PostMapping("/platform/governance/policies")
    public Map<String, List<PermissionPolicyDirectory.Policy>> policies() {
        return Map.of("policies", policies.listPolicies(identity.getCurrentUser().getDomainId()));
    }

    @PostMapping("/platform/governance/role-policies")
    public Map<String, List<PermissionPolicyDirectory.RolePolicy>> rolePolicies() {
        return Map.of("rolePolicies", policies.listRolePolicies(identity.getCurrentUser().getDomainId()));
    }

    @PostMapping("/platform/governance/policy-data-permissions")
    public Map<String, List<PermissionPolicyDirectory.PolicyDataPermission>> policyDataPermissions() {
        return Map.of("policyDataPermissions", policies.listPolicyDataPermissions(identity.getCurrentUser().getDomainId()));
    }
}
