package io.ontomato.dataengine.service.impl;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.service.BuiltinProductIds;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@Component
@DependsOn("jdbcInitDb")
public final class AnonymousAuthorization implements AuthorizationSubjects, AuthorizationStore, InitializingBean {
    private static final String DOMAIN_POLICY = "domain";
    private final ProductGrantService products;

    private final JdbcTemplate jdbc;

    public AnonymousAuthorization(ProductGrantService products, JdbcTemplate jdbc) {
        this.products = products;
        this.jdbc = jdbc;
    }

    @Override
    public void afterPropertiesSet() {
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS object_policy_grant (
                    domain_id text NOT NULL, target_kind text NOT NULL, target_key text NOT NULL, verb text NOT NULL,
                    PRIMARY KEY (domain_id, target_kind, target_key, verb)
                )
                """);
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
            case PANEL, PROJECTION -> verb == Verb.USE &&
                    (BuiltinProductIds.isValid(target.id()) || hasDomainUse(target));
            case COMPONENT -> verb == Verb.USE && hasDomainUse(target);
            case APPLICATION -> products.allowedFor(target.domainId(), userId, target.id(), verb.name().toLowerCase(Locale.ROOT));
            // The anonymous workbench could use and configure each registered agent.
            case AGENT -> verb == Verb.USE || verb == Verb.VIEW || verb == Verb.EDIT;
            case METRIC, READ_FUNCTION, WRITE_FUNCTION, TRIGGER, ACTION, WORKFLOW, SKILL -> true;
            case ENTRY -> false;
        };
    }

    private boolean hasDomainUse(ObjectTarget target) {
        return !objectGrants(target, Verb.USE, Set.of(DOMAIN_POLICY)).isEmpty();
    }

    @Override public boolean requiresFirstPublicationAudience() { return false; }
    @Override public List<ObjectGrantView> objectGrantViews(ObjectTarget target) { return List.of(); }

    @Override
    public List<String> organizationCodes(String domainId, Set<String> roots, GrantScope.Kind kind) {
        throw new IllegalStateException("Anonymous authorization has no organization scopes");
    }

    @Override public List<PolicyRef> policies(String domainId, Set<String> roleIds) { return List.of(); }
    @Override
    public PolicyRef domainPolicy(String domainId) {
        return new PolicyRef(null, DOMAIN_POLICY, PolicyKind.OBJECT);
    }

    @Override
    public List<ObjectGrant> objectGrants(ObjectTarget target, Verb verb, Set<String> policyIds) {
        if (!policyIds.contains(DOMAIN_POLICY)) return List.of();
        return jdbc.query("""
                SELECT target_key FROM object_policy_grant
                WHERE domain_id=? AND target_kind=? AND target_key=? AND verb=?
                """, (row, index) -> new ObjectGrant(DOMAIN_POLICY, target, verb, null),
                target.domainId(), target.kind().name(), target.id(), verb.name());
    }

    @Override public List<AgentPolicyGrant> agentPolicyGrants(ObjectTarget target) { return List.of(); }
    @Override public void replaceAgentLevel(String policyId, ObjectTarget target, Verb level) { throw noRolePolicies(); }
    @Override public List<ObjectGrant> policyObjectGrants(String domainId, String policyId) { return List.of(); }
    @Override public List<ObjectGrant> domainObjectGrants(String domainId) { return List.of(); }
    @Override public Set<String> managementOperations(String domainId, Set<String> policyIds) { return Set.of(); }
    @Override public Set<String> entryPolicies(ObjectTarget entry) { return Set.of(); }
    @Override public Set<String> policyRoleIds(String domainId, String policyId) { return Set.of(); }
    @Override public Map<String, Long> countObjectGrantsByPolicy(String domainId, Set<String> policyIds) { return Map.of(); }
    @Override public Map<String, Long> countManagementOperationsByPolicy(String domainId, Set<String> policyIds) { return Map.of(); }
    @Override public Map<String, Long> countPendingGrantsByPolicy(String domainId, Set<String> policyIds) { return Map.of(); }

    @Override
    public void grantObject(ObjectGrant grant) {
        requireDomainPolicy(grant);
        ObjectTarget target = grant.target();
        jdbc.update("""
                INSERT INTO object_policy_grant (domain_id,target_kind,target_key,verb)
                VALUES (?,?,?,?) ON CONFLICT DO NOTHING
                """, target.domainId(), target.kind().name(), target.id(), grant.verb().name());
    }

    @Override
    public void revokeObject(ObjectGrant grant) {
        requireDomainPolicy(grant);
        ObjectTarget target = grant.target();
        jdbc.update("""
                DELETE FROM object_policy_grant WHERE domain_id=? AND target_kind=? AND target_key=? AND verb=?
                """, target.domainId(), target.kind().name(), target.id(), grant.verb().name());
    }

    @Override
    public void retireObject(ObjectTarget target) {
        jdbc.update("DELETE FROM object_policy_grant WHERE domain_id=? AND target_kind=? AND target_key=?",
                target.domainId(), target.kind().name(), target.id());
    }

    private static void requireDomainPolicy(ObjectGrant grant) {
        if (!DOMAIN_POLICY.equals(grant.policyId()) || grant.verb() != Verb.USE || grant.scope() != null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Anonymous object access supports only the domain use policy.");
    }
    @Override public void grantManagement(String domainId, String policyId, String operationId) { throw noRolePolicies(); }
    @Override public void revokeManagement(String domainId, String policyId, String operationId) { throw noRolePolicies(); }
    @Override public List<PendingGrant> pendingGrants(String domainId, String policyId) { throw noRolePolicies(); }
    @Override public PendingGrant pendingGrant(String domainId, String policyId, long id) { throw noRolePolicies(); }
    @Override public void addPendingGrant(PendingGrant pending) { throw noRolePolicies(); }
    @Override public void closePendingGrants(ObjectTarget entry, ObjectTarget target, Verb verb, GrantScope scope) {}
    @Override public void resolvePendingGrant(String domainId, String policyId, long id, boolean confirm, GrantScope scope) { throw noRolePolicies(); }

    private static ResponseStatusException noRolePolicies() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Role policies are not supported by anonymous authorization");
    }
}
