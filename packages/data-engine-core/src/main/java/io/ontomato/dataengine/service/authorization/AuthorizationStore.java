package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import java.util.List;
import java.util.Set;

/** Persists the policies owned by the authorization module. */
public interface AuthorizationStore {
    List<PolicyRef> policies(String domainId, Set<String> roleIds);

    List<ObjectGrant> objectGrants(ObjectTarget target, Verb verb, Set<String> policyIds);
    Set<String> managementOperations(String domainId, Set<String> policyIds);
    Set<String> entryPolicies(ObjectTarget entry);

    void grantObject(ObjectGrant grant);
    void revokeObject(ObjectGrant grant);
    void grantManagement(String domainId, String policyId, String operationId);
    void revokeManagement(String domainId, String policyId, String operationId);

    List<PendingGrant> pendingGrants(String domainId, String policyId);
    PendingGrant pendingGrant(String domainId, String policyId, long id);
    void addPendingGrant(PendingGrant pending);
    void closePendingGrants(ObjectTarget entry, ObjectTarget target, Verb verb,
                            GrantScope scope);
    void resolvePendingGrant(String domainId, String policyId, long id, boolean confirm, GrantScope scope);
}
