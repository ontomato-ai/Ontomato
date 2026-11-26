package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Persists the policies owned by the authorization module. */
public interface AuthorizationStore {
    List<PolicyRef> policies(String domainId, Set<String> roleIds);

    List<ObjectGrant> objectGrants(ObjectTarget target, Verb verb, Set<String> policyIds);
    Map<Verb, Set<String>> objectKeysByVerb(String domainId, Kind kind, Set<Verb> verbs, Set<String> policyIds);
    List<ObjectGrant> policyObjectGrants(String domainId, String policyId);
    List<ObjectGrant> domainObjectGrants(String domainId);
    List<ObjectGrant> policyEntryGrants(String domainId, String policyId);
    List<ObjectGrant> applicationEntryGrants(String domainId, String applicationId);
    List<ObjectGrant> policyActionGrants(String domainId, String policyId);
    List<ObjectGrant> actionPolicyGrants(String domainId, String actionId);
    List<ObjectGrant> policyObjectGrants(String domainId, String policyId, Set<Kind> kinds);
    List<ObjectGrant> targetObjectGrants(String domainId, String targetId, Set<Kind> kinds);
    List<ObjectGrant> policyCreateGrants(String domainId, Set<String> policyIds, Set<Kind> kinds);
    Set<String> policyUseKeys(String domainId, String policyId, Kind kind, Set<String> targetIds);
    List<PolicyRef> domainRolePolicies(String domainId);
    Map<String, Set<String>> domainManagementOperations(String domainId);
    Set<String> managementOperations(String domainId, Set<String> policyIds);
    Set<String> entryPolicies(ObjectTarget entry);
    Set<String> policyRoleIds(String domainId, String policyId);
    Map<String, Long> countObjectGrantsByPolicy(String domainId, Set<String> policyIds);
    Map<String, Long> countManagementOperationsByPolicy(String domainId, Set<String> policyIds);
    Map<String, Long> countPendingGrantsByPolicy(String domainId, Set<String> policyIds);

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
