package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.OrganizationDirectory;
import io.ontomato.dataengine.service.PermissionPolicyDirectory;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
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
    public Object organization(@RequestBody(required = false) JSONObject param) {
        String domainId = identity.getCurrentUser().getDomainId();
        return countOnly(param) ? organization.countInDomain(domainId) : organization.snapshot(domainId);
    }

    @PostMapping("/platform/governance/policies")
    public Map<String, ?> policies(@RequestBody(required = false) JSONObject param) {
        String domainId = identity.getCurrentUser().getDomainId();
        return countOnly(param) ? Map.of("total", policies.countInDomain(domainId))
            : Map.of("policies", policies.listPolicies(domainId));
    }

    private static boolean countOnly(JSONObject param) {
        return param != null && Boolean.TRUE.equals(param.get("countOnly"));
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
