package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.CapabilityGrantLookup.Admission;
import io.ontomato.dataengine.service.CapabilityGrantLookup.Match;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public final class AuthorizationService {
    public sealed interface Request permits Entry, ObjectAccess, FixedProductRead, PublishedObjectRead, Create, Management, Action, Data {}
    public record Entry(ObjectTarget target) implements Request {}
    public record ObjectAccess(ObjectTarget target, Verb verb, OwnerFacts ownerFacts) implements Request {}
    /** Only an owner that has read a builtin record may construct this request. */
    public record FixedProductRead(Kind kind, Verb verb) implements Request {}
    /** A credential must allow the whole kind/verb; a point-limited credential does not authorize enumeration. */
    public record PublishedObjectRead(Kind kind, Verb verb) implements Request {}
    public record ObjectVisibilityRange(boolean fixed, String authorId, Set<String> objectIds, boolean all) {
        private static final ObjectVisibilityRange EMPTY = new ObjectVisibilityRange(false, null, Set.of(), false);
    }
    public record Create(Kind kind) implements Request {}
    public record Management(String operationId) implements Request {}
    public record Data(List<String> classes) implements Request {}

    public sealed interface ActionPath permits Standalone, WorkflowStep {}
    public record Standalone() implements ActionPath {}
    /** Constructed by the workflow owner after resolving the actual run and its current step. */
    public record WorkflowStep(String workflowId, int version, int stepNo, String runId, String targetClass, String targetKey) implements ActionPath {}
    public record Action(ObjectTarget target, ActionPath path, ExecutionTarget execution, OwnerFacts ownerFacts)
            implements Request {}

    @FunctionalInterface
    public interface CredentialLimit {
        CredentialLimit UNRESTRICTED = request -> true;
        boolean permits(Request request);
    }

    /** Constructed from the verified identity at the appropriate server boundary. */
    public record VerifiedIdentity(String domainId, String userId, CredentialLimit limit) {}

    /** The resolved identity remains the placement principal. Application catalogue reads use the original Java user ID. */
    public record SubjectContext(VerifiedIdentity identity, RoleResolution roles, Map<String, List<PolicyRef>> policyRefsByRole,
                                 Set<String> objectPolicyIds, Set<String> managementPolicyIds,
                                 UserDataPermission liveDataPermission, String javaUserId) {
        public SubjectContext(VerifiedIdentity identity, RoleResolution roles, Map<String, List<PolicyRef>> policyRefsByRole,
                              Set<String> objectPolicyIds, Set<String> managementPolicyIds) {
            this(identity, roles, policyRefsByRole, objectPolicyIds, managementPolicyIds, null, identity.userId());
        }

        public SubjectContext withLiveDataPermission(UserDataPermission permission) {
            return new SubjectContext(identity, roles, policyRefsByRole, objectPolicyIds, managementPolicyIds, permission, javaUserId);
        }

        public SubjectContext withJavaUserId(String userId) {
            return javaUserId.equals(userId) ? this
                    : new SubjectContext(identity, roles, policyRefsByRole, objectPolicyIds, managementPolicyIds, liveDataPermission, userId);
        }

        /**
         * The same person identified by the Java user ID, for owners whose records name Java users as authors. A
         * Workbench placement's identity is its own principal, so in OSS the two differ ({@code system}, {@code admin}).
         */
        public SubjectContext asJavaUser() {
            return identity.userId().equals(javaUserId) ? this
                    : new SubjectContext(new VerifiedIdentity(identity.domainId(), javaUserId, identity.limit()), roles,
                            policyRefsByRole, objectPolicyIds, managementPolicyIds, liveDataPermission, javaUserId);
        }
    }

    public record Decision(boolean allowed, String code, String reason) {
        static final Decision ALLOWED = new Decision(true, null, null);
        static Decision denied(String code, String reason) { return new Decision(false, code, reason); }
    }
    public record ActionDecision(Decision decision, Admission admission) {}

    private final AuthorizationSubjects subjects;
    private final AuthorizationStore policies;
    private final ManagementOperations operations;
    private final CapabilityGrantLookup workflow;
    private final DataPermissionLookup data;

    public AuthorizationService(AuthorizationSubjects subjects, AuthorizationStore policies,
            ManagementOperations operations, CapabilityGrantLookup workflow, DataPermissionLookup data) {
        this.subjects = subjects;
        this.policies = policies;
        this.operations = operations;
        this.workflow = workflow;
        this.data = data;
    }

    public SubjectContext resolveSubject(VerifiedIdentity actor) {
        var roles = subjects.resolveRoles(actor.domainId(), actor.userId());
        var byRole = new LinkedHashMap<String, List<PolicyRef>>();
        var objects = new LinkedHashSet<String>();
        var management = new LinkedHashSet<String>();
        for (var ref : policies.policies(actor.domainId(), roles.effectiveRoleIds())) {
            byRole.computeIfAbsent(ref.roleId(), key -> new ArrayList<>()).add(ref);
            if (ref.kind() == PolicyKind.OBJECT) objects.add(ref.policyId());
            else if (ref.kind() == PolicyKind.MANAGEMENT) management.add(ref.policyId());
        }
        byRole.replaceAll((role, refs) -> List.copyOf(refs));
        return new SubjectContext(actor, roles, Map.copyOf(byRole), Set.copyOf(objects), Set.copyOf(management));
    }

    public Decision decide(SubjectContext ctx, Request request) {
        if (request instanceof Action action) return decideAction(ctx, action).decision();
        if (!ctx.identity().limit().permits(request)) return limited();
        return switch (request) {
            case Entry(var target) -> decideEntry(ctx, target);
            case ObjectAccess access -> decideObject(ctx, access);
            case FixedProductRead(var kind, var verb) -> FixedProductAccess.allows(kind, verb) ? Decision.ALLOWED
                    : Decision.denied("OBJECT_FORBIDDEN", "This verb is not available on platform definitions.");
            case PublishedObjectRead ignored -> Decision.ALLOWED;
            case Create(var kind) -> decideCreate(ctx, kind);
            case Management(var operationId) -> decideManagement(ctx, operationId);
            case Data ignored -> Decision.ALLOWED;
            case Action ignored -> throw new AssertionError();
        };
    }

    public List<Decision> decideBatch(SubjectContext ctx, List<? extends Request> requests) {
        return requests.stream().map(request -> decide(ctx, request)).toList();
    }

    public Map<Verb, ObjectVisibilityRange> readObjectRanges(SubjectContext ctx, Kind kind, Set<Verb> verbs) {
        var ranges = new EnumMap<Verb, ObjectVisibilityRange>(Verb.class);
        var policyVerbs = new LinkedHashSet<Verb>();
        for (var verb : verbs) {
            if (!decide(ctx, new PublishedObjectRead(kind, verb)).allowed()) {
                ranges.put(verb, ObjectVisibilityRange.EMPTY);
                continue;
            }
            boolean all = subjects.domainWideObjectEntitlement(kind, verb);
            var author = OwnershipAdmission.authorAllowed(kind, verb, false) ? ctx.identity().userId() : null;
            ranges.put(verb, new ObjectVisibilityRange(FixedProductAccess.allows(kind, verb), author, Set.of(), all));
            if (!all) policyVerbs.add(verb);
        }
        if (!policyVerbs.isEmpty()) {
            var keys = policies.objectKeysByVerb(ctx.identity().domainId(), kind, policyVerbs, ctx.objectPolicyIds());
            keys.forEach((verb, ids) -> {
                var range = ranges.get(verb);
                ranges.put(verb, new ObjectVisibilityRange(range.fixed(), range.authorId(), ids, range.all()));
            });
        }
        return ranges;
    }

    private Decision decideEntry(SubjectContext ctx, ObjectTarget target) {
        if (!sameDomain(ctx, target)) return differentDomain();
        return subjects.entryEntitlement(target) || has(ctx, target, Verb.ENTER) ? Decision.ALLOWED
                : Decision.denied("ENTRY_FORBIDDEN", "You are not allowed to enter this application entry.");
    }

    private Decision decideObject(SubjectContext ctx, ObjectAccess access) {
        var target = access.target();
        if (!sameDomain(ctx, target)) return differentDomain();
        if (target.kind() == Kind.SKILL)
            return Decision.denied("OBJECT_FORBIDDEN", "Skill packages are managed through the skill library.");
        var ownership = access.ownerFacts() == null ? OwnershipAdmission.Result.PASS_TO_POLICY
                : OwnershipAdmission.decide(ctx.identity().userId(), target.kind(), access.verb(),
                        access.ownerFacts(), false);
        if (ownership == OwnershipAdmission.Result.PRIVATE_DRAFT)
            return Decision.denied("PRIVATE_DRAFT", "Only the authors may access this draft.");
        if (ownership == OwnershipAdmission.Result.ALLOWED
                || subjects.domainWideObjectEntitlement(target.kind(), access.verb())
                || subjects.objectEntitlement(ctx.identity().userId(), target, access.verb())
                || has(ctx, target, access.verb())) return Decision.ALLOWED;
        return Decision.denied("OBJECT_FORBIDDEN", "You do not have the required permission for this object.");
    }

    private Decision decideCreate(SubjectContext ctx, Kind kind) {
        var target = new ObjectTarget(ctx.identity().domainId(), kind, "");
        if (kind != Kind.SKILL && (subjects.objectEntitlement(ctx.identity().userId(), target, Verb.CREATE) || has(ctx, target, Verb.CREATE)))
            return Decision.ALLOWED;
        return Decision.denied("CREATE_FORBIDDEN", "You are not allowed to create this type of object.");
    }

    private Decision decideManagement(SubjectContext ctx, String operationId) {
        operations.require(operationId);
        if (ctx.roles().administrator() || subjects.managementEntitlement(operationId)
                || policies.managementOperations(ctx.identity().domainId(), ctx.managementPolicyIds()).contains(operationId))
            return Decision.ALLOWED;
        return Decision.denied("MANAGEMENT_FORBIDDEN", "You do not have permission for this management operation.");
    }

    public ActionDecision decideAction(SubjectContext ctx, Action action) {
        if (!ctx.identity().limit().permits(action)) return new ActionDecision(limited(), Admission.DENIED);
        if (!sameDomain(ctx, action.target())) return new ActionDecision(differentDomain(), Admission.DENIED);
        var identity = ctx.identity();
        var owner = OwnershipAdmission.decide(identity.userId(), Kind.ACTION, Verb.EXECUTE, action.ownerFacts(),
                action.execution().testing());
        if (owner == OwnershipAdmission.Result.PRIVATE_DRAFT)
            return new ActionDecision(Decision.denied("PRIVATE_DRAFT", "Only the authors may access this draft."), Admission.DENIED);

        Admission admission = switch (action.path()) {
            case WorkflowStep step -> workflow.stepAdmissions(identity.userId(), identity.domainId(),
                    step.workflowId(), step.version()).getOrDefault(step.stepNo(), Admission.DENIED);
            case Standalone ignored -> owner == OwnershipAdmission.Result.ALLOWED || subjects.unrestrictedStandaloneActions()
                    ? Admission.ALL : standaloneAdmission(ctx, action.target());
        };
        return new ActionDecision(admission.admitted() ? Decision.ALLOWED
                : Decision.denied("ACTION_NOT_GRANTED", "You are not allowed to execute this action."), admission);
    }

    private Admission standaloneAdmission(SubjectContext ctx, ObjectTarget target) {
        var matches = new ArrayList<Match>();
        for (var grant : policies.objectGrants(target, Verb.EXECUTE, ctx.objectPolicyIds())) {
            var scope = grant.scope();
            if (scope.kind() == GrantScope.Kind.all) return Admission.ALL;
            for (var edge : ctx.policyRefsByRole().entrySet()) {
                if (edge.getValue().stream().noneMatch(ref -> ref.kind() == PolicyKind.OBJECT
                        && ref.policyId().equals(grant.policyId()))) continue;
                var values = standaloneScopeValues(ctx, target, scope, edge.getKey());
                if (!values.isEmpty()) matches.add(new Match(scope.className(), scope.field(), values));
            }
        }
        return new Admission(false, List.copyOf(matches));
    }

    List<String> standaloneScopeValues(SubjectContext ctx, ObjectTarget target, GrantScope scope, String roleId) {
        return switch (scope.kind()) {
            case initiated_by_self, assigned_to_self -> List.of(ctx.identity().userId());
            case self_organization, self_subtree, self_descendants -> {
                var roots = ctx.roles().rootsForRole(roleId);
                yield roots.isEmpty() ? List.of() : subjects.organizationCodes(target.domainId(), roots, scope.kind());
            }
            case all -> throw new AssertionError();
        };
    }

    public UserDataPermission resolveData(SubjectContext ctx, Data request) {
        var decision = decide(ctx, request);
        if (!decision.allowed()) throw new org.springframework.web.server.ResponseStatusException(
                org.springframework.http.HttpStatus.FORBIDDEN, decision.reason());
        return data.getDataPermission(ctx.identity().userId(), ctx.identity().domainId());
    }

    private boolean has(SubjectContext ctx, ObjectTarget target, Verb verb) {
        return !policies.objectGrants(target, verb, ctx.objectPolicyIds()).isEmpty();
    }

    private static boolean sameDomain(SubjectContext ctx, ObjectTarget target) {
        return ctx.identity().domainId().equals(target.domainId());
    }

    private static Decision limited() {
        return Decision.denied("CREDENTIAL_SCOPE", "This operation is outside the scope of this credential.");
    }

    private static Decision differentDomain() {
        return Decision.denied("DOMAIN_MISMATCH", "This resource belongs to a different domain.");
    }
}
