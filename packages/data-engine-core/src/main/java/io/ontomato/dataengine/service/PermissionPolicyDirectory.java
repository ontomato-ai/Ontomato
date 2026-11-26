package io.ontomato.dataengine.service;

import java.util.List;

/** Reads policy records and their independently authorized relationships in one domain. */
public interface PermissionPolicyDirectory {
    record Policy(String id, String name, Integer type, Boolean fullData, String parentId) {}
    record RolePolicy(String roleId, String policyId) {}
    record PolicyDataPermission(String policyId, String className) {}

    List<Policy> listPolicies(String domainId);
    long countInDomain(String domainId);
    List<RolePolicy> listRolePolicies(String domainId);
    List<PolicyDataPermission> listPolicyDataPermissions(String domainId);
}
