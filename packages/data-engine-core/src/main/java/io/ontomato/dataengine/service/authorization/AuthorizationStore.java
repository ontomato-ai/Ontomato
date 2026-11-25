package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Persists the policies owned by the authorization module. */
public interface AuthorizationStore {
    List<PolicyRef> policies(String domainId, Set<String> roleIds);

    List<ObjectGrant> objectGrants(ObjectTarget target, Verb verb, Set<String> policyIds);
    Set<String> managementOperations(String domainId, Set<String> policyIds);
    Set<String> entryPolicies(ObjectTarget entry);

    default boolean requiresFirstPublicationAudience() { return true; }
    default List<ObjectGrantView> objectGrantViews(ObjectTarget target) { throw unsupportedObjectPolicies(); }

    default PolicyRef domainPolicy(String domainId) { throw unsupportedObjectPolicies(); }
    default List<AgentPolicyGrant> agentPolicyGrants(ObjectTarget target) { throw unsupportedObjectPolicies(); }
    default void replaceAgentLevel(String policyId, ObjectTarget target, Verb level) { throw unsupportedObjectPolicies(); }

    private static ResponseStatusException unsupportedObjectPolicies() {
        return new ResponseStatusException(HttpStatus.NOT_IMPLEMENTED, "Ordinary object policies are not available");
    }

    void grantObject(ObjectGrant grant);
    void revokeObject(ObjectGrant grant);
    default void retireObject(ObjectTarget target) { throw unsupportedObjectPolicies(); }
    void grantManagement(String domainId, String policyId, String operationId);
    void revokeManagement(String domainId, String policyId, String operationId);

    List<PendingGrant> pendingGrants(String domainId, String policyId);
    PendingGrant pendingGrant(String domainId, String policyId, long id);
    void addPendingGrant(PendingGrant pending);
    void closePendingGrants(ObjectTarget entry, ObjectTarget target, Verb verb,
                            GrantScope scope);
    void resolvePendingGrant(String domainId, String policyId, long id, boolean confirm, GrantScope scope);
}
