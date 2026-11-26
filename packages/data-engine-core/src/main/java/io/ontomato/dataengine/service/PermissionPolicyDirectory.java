package io.ontomato.dataengine.service;

import java.util.List;
import java.util.Set;

/** Reads policy records and their independently authorized relationships in one domain. */
public interface PermissionPolicyDirectory {
    record Policy(String id, String name, Integer type, Boolean fullData, String parentId) {}
    record PolicyName(String id, String name) {}
    record RolePolicy(String roleId, String policyId) {}
    record PolicyDataPermission(String policyId, String className) {}
    record PolicyDataNeighbor(String policyId, String className, String policyName) {}

    List<Policy> listPolicies(String domainId);
    List<PolicyName> policyNamesInDomain(String domainId, Set<String> policyIds);
    long countInDomain(String domainId);
    List<RolePolicy> listRolePolicies(String domainId);
    List<PolicyDataPermission> listPolicyDataPermissions(String domainId);
    List<PolicyDataNeighbor> policyDataNeighbors(String domainId, String centerId, boolean outgoing);
}
