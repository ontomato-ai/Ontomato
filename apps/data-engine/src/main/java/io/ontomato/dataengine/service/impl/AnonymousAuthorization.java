package io.ontomato.dataengine.service.impl;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import io.ontomato.dataengine.service.authorization.PresetAgentPolicies;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.SqlArrayValue;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@Component
@DependsOn("jdbcInitDb")
public final class AnonymousAuthorization implements AuthorizationSubjects, AuthorizationStore, PresetAgentPolicies.RolePolicies, InitializingBean {
    private static final String DOMAIN_POLICY = "domain";
    private static final String DOMAIN_OBJECT_KEYS = """
            SELECT target_key FROM object_policy_grant
            WHERE domain_id=? AND target_kind=? AND verb=?
            """;
    private static final String DOMAIN_GRANTS = "SELECT target_kind, target_key, verb FROM object_policy_grant WHERE domain_id=?";
    private final JdbcTemplate jdbc;

    public AnonymousAuthorization(JdbcTemplate jdbc) {
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
            case PANEL, PROJECTION, COMPONENT -> usesDomainObjectPolicy(target.kind(), verb)
                    && !objectGrants(target, verb, Set.of(DOMAIN_POLICY)).isEmpty();
            case APPLICATION -> verb == Verb.EDIT && !objectGrants(target, verb, Set.of(DOMAIN_POLICY)).isEmpty();
            case AGENT -> domainWideObjectEntitlement(target.kind(), verb);
            case METRIC, READ_FUNCTION, WRITE_FUNCTION, TRIGGER, ACTION, WORKFLOW, SKILL -> true;
            case ENTRY -> false;
        };
    }

    @Override
    public boolean domainWideObjectEntitlement(Kind kind, Verb verb) {
        return kind == Kind.AGENT && (verb == Verb.USE || verb == Verb.VIEW || verb == Verb.EDIT);
    }

    private static boolean usesDomainObjectPolicy(Kind kind, Verb verb) {
        return verb == Verb.USE && (kind == Kind.PANEL || kind == Kind.PROJECTION || kind == Kind.COMPONENT);
    }

    @Override
    public void initialize(String domainId, List<String> ids) {
        // The anonymous subject already has these agent verbs and has no roles.
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
        return jdbc.query(DOMAIN_OBJECT_KEYS + " AND target_key=?",
                (row, index) -> new ObjectGrant(DOMAIN_POLICY, target, verb, null),
                target.domainId(), target.kind().name(), verb.name(), target.id());
    }

    @Override
    public Map<Verb, Set<String>> objectKeysByVerb(String domainId, Kind kind, Set<Verb> verbs, Set<String> policyIds) {
        if (!verbs.contains(Verb.USE) || !usesDomainObjectPolicy(kind, Verb.USE)) return Map.of();
        var keys = jdbc.queryForList(DOMAIN_OBJECT_KEYS, String.class, domainId, kind.name(), Verb.USE.name());
        return Map.of(Verb.USE, Set.copyOf(keys));
    }

    @Override public List<AgentPolicyGrant> agentPolicyGrants(ObjectTarget target) { return List.of(); }
    @Override public void replaceAgentLevel(String policyId, ObjectTarget target, Verb level) { throw noRolePolicies(); }
    @Override public List<ObjectGrant> policyObjectGrants(String domainId, String policyId) { return List.of(); }
    @Override public List<ObjectGrant> domainObjectGrants(String domainId) {
        return domainGrants(domainId, DOMAIN_GRANTS, domainId);
    }

    @Override public List<ObjectGrant> policyEntryGrants(String domainId, String policyId) {
        if (!DOMAIN_POLICY.equals(policyId)) return List.of();
        return domainGrants(domainId, DOMAIN_GRANTS + " AND target_kind='ENTRY'", domainId);
    }

    @Override public List<ObjectGrant> applicationEntryGrants(String domainId, String applicationId) {
        String prefix = applicationId + "/";
        return domainGrants(domainId, DOMAIN_GRANTS + """
                 AND target_kind='ENTRY' AND (target_key=? OR LEFT(target_key, LENGTH(?))=?)
                """, domainId, applicationId, prefix, prefix);
    }

    @Override public List<ObjectGrant> policyActionGrants(String domainId, String policyId) {
        if (!DOMAIN_POLICY.equals(policyId)) return List.of();
        return domainGrants(domainId, DOMAIN_GRANTS + " AND target_kind='ACTION' AND target_key<>''", domainId);
    }

    @Override public List<ObjectGrant> actionPolicyGrants(String domainId, String actionId) {
        return domainGrants(domainId, DOMAIN_GRANTS + " AND target_kind='ACTION' AND target_key=?", domainId, actionId);
    }

    @Override public List<ObjectGrant> policyObjectGrants(String domainId, String policyId, Set<Kind> kinds) {
        if (!DOMAIN_POLICY.equals(policyId)) return List.of();
        return domainGrants(domainId, DOMAIN_GRANTS + " AND target_kind=ANY (?) AND target_key<>''",
                domainId, kindNames(kinds));
    }

    @Override public List<ObjectGrant> targetObjectGrants(String domainId, String targetId, Set<Kind> kinds) {
        return domainGrants(domainId, DOMAIN_GRANTS + " AND target_kind=ANY (?) AND target_key=?",
                domainId, kindNames(kinds), targetId);
    }

    @Override public List<ObjectGrant> policyCreateGrants(String domainId, Set<String> policyIds, Set<Kind> kinds) {
        if (!policyIds.contains(DOMAIN_POLICY)) return List.of();
        return domainGrants(domainId, DOMAIN_GRANTS + " AND target_kind=ANY (?) AND verb='CREATE' AND target_key=''",
                domainId, kindNames(kinds));
    }

    @Override public Set<String> policyUseKeys(String domainId, String policyId, Kind kind, Set<String> targetIds) {
        if (!DOMAIN_POLICY.equals(policyId) || targetIds.isEmpty()) return Set.of();
        return Set.copyOf(jdbc.queryForList(DOMAIN_OBJECT_KEYS + " AND target_key=ANY (?)", String.class,
                domainId, kind.name(), Verb.USE.name(), new SqlArrayValue("text", targetIds.toArray())));
    }

    private static SqlArrayValue kindNames(Set<Kind> kinds) {
        return new SqlArrayValue("text", kinds.stream().map(Kind::name).toArray());
    }

    private List<ObjectGrant> domainGrants(String domainId, String sql, Object... args) {
        return jdbc.query(sql, (row, index) -> new ObjectGrant(DOMAIN_POLICY,
                new ObjectTarget(domainId, Kind.valueOf(row.getString("target_kind")), row.getString("target_key")),
                Verb.valueOf(row.getString("verb")), null), args);
    }

    @Override public List<PolicyRef> domainRolePolicies(String domainId) { return List.of(); }
    @Override public Map<String, Set<String>> domainManagementOperations(String domainId) { return Map.of(); }
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
        var verb = grant.target().kind() == Kind.APPLICATION ? Verb.EDIT : Verb.USE;
        if (!DOMAIN_POLICY.equals(grant.policyId()) || grant.scope() != null || grant.verb() != verb)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported permission for the anonymous domain policy.");
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
