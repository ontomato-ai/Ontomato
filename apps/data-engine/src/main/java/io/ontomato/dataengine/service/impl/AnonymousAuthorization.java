package io.ontomato.dataengine.service.impl;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

@Component
public final class AnonymousAuthorization implements AuthorizationSubjects, AuthorizationStore {
    private final ProductGrantService products;

    public AnonymousAuthorization(ProductGrantService products) {
        this.products = products;
    }

    @Override
    public RoleResolution resolveRoles(String domainId, String userId) {
        return new RoleResolution(Set.of(), Set.of(), List.of(), Set.of(), Map.of(), false);
    }

    @Override public boolean entryEntitlement(ObjectTarget entry) { return true; }
    @Override public boolean managementEntitlement(String operationId) { return true; }
    @Override public boolean unrestrictedStandaloneActions() { return true; }

    @Override
    public boolean objectEntitlement(String userId, ObjectTarget target, Verb verb) {
        if (verb == Verb.CREATE) return target.kind() != Kind.ENTRY;
        return switch (target.kind()) {
            case PANEL, PROJECTION, COMPONENT, AGENT, APPLICATION ->
                    products.allowedFor(target.domainId(), userId, target.id(), verb.name().toLowerCase(Locale.ROOT));
            case METRIC, READ_FUNCTION, ACTION, WORKFLOW -> true;
            case ENTRY -> false;
        };
    }

    @Override
    public List<String> organizationCodes(String domainId, Set<String> roots, GrantScope.Kind kind) {
        throw new IllegalStateException("Anonymous authorization has no organization scopes");
    }

    @Override public List<PolicyRef> policies(String domainId, Set<String> roleIds) { return List.of(); }
    @Override public List<ObjectGrant> objectGrants(ObjectTarget target, Verb verb, Set<String> policyIds) { return List.of(); }
    @Override public Set<String> managementOperations(String domainId, Set<String> policyIds) { return Set.of(); }
    @Override public Set<String> entryPolicies(ObjectTarget entry) { return Set.of(); }

    @Override public void grantObject(ObjectGrant grant) { throw noRolePolicies(); }
    @Override public void revokeObject(ObjectGrant grant) { throw noRolePolicies(); }
    @Override public void grantManagement(String domainId, String policyId, String operationId) { throw noRolePolicies(); }
    @Override public void revokeManagement(String domainId, String policyId, String operationId) { throw noRolePolicies(); }
    @Override public List<PendingGrant> pendingGrants(String domainId, String policyId) { throw noRolePolicies(); }
    @Override public PendingGrant pendingGrant(String domainId, String policyId, long id) { throw noRolePolicies(); }
    @Override public void addPendingGrant(PendingGrant pending) { throw noRolePolicies(); }
    @Override public void closePendingGrants(ObjectTarget entry, ObjectTarget target, Verb verb, GrantScope scope) {}
    @Override public void resolvePendingGrant(String domainId, String policyId, long id, boolean confirm, GrantScope scope) { throw noRolePolicies(); }

    private static IllegalStateException noRolePolicies() {
        return new IllegalStateException("Role policies are not supported by anonymous authorization");
    }
}
