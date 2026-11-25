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
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public final class AuthorizationService {
    public sealed interface Request permits Entry, ObjectAccess, Create, Management, Action, Data {}
    public record Entry(ObjectTarget target) implements Request {}
    public record ObjectAccess(ObjectTarget target, Verb verb, OwnerFacts ownerFacts) implements Request {}
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

    public record SubjectContext(VerifiedIdentity identity, RoleResolution roles, Map<String, List<PolicyRef>> policyRefsByRole,
                                 Set<String> objectPolicyIds, Set<String> managementPolicyIds) {}

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
            (ref.kind() == PolicyKind.OBJECT ? objects : management).add(ref.policyId());
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
            case Create(var kind) -> decideCreate(ctx, kind);
            case Management(var operationId) -> decideManagement(ctx, operationId);
            case Data ignored -> Decision.ALLOWED;
            case Action ignored -> throw new AssertionError();
        };
    }

    public List<Decision> decideBatch(SubjectContext ctx, List<? extends Request> requests) {
        return requests.stream().map(request -> decide(ctx, request)).toList();
    }

    private Decision decideEntry(SubjectContext ctx, ObjectTarget target) {
        if (!sameDomain(ctx, target)) return differentDomain();
        return subjects.entryEntitlement(target) || has(ctx, target, Verb.ENTER) ? Decision.ALLOWED
                : Decision.denied("ENTRY_FORBIDDEN", "You are not allowed to enter this application entry.");
    }

    private Decision decideObject(SubjectContext ctx, ObjectAccess access) {
        var target = access.target();
        if (!sameDomain(ctx, target)) return differentDomain();
        var ownership = OwnershipAdmission.decide(ctx.identity().userId(), target.kind(), access.verb(),
                access.ownerFacts(), false);
        if (ownership == OwnershipAdmission.Result.PRIVATE_DRAFT)
            return Decision.denied("PRIVATE_DRAFT", "Only the authors may access this draft.");
        if (ownership == OwnershipAdmission.Result.ALLOWED
                || subjects.objectEntitlement(ctx.identity().userId(), target, access.verb())
                || has(ctx, target, access.verb())) return Decision.ALLOWED;
        return Decision.denied("OBJECT_FORBIDDEN", "You do not have the required permission for this object.");
    }

    private Decision decideCreate(SubjectContext ctx, Kind kind) {
        var target = new ObjectTarget(ctx.identity().domainId(), kind, "");
        if (subjects.objectEntitlement(ctx.identity().userId(), target, Verb.CREATE) || has(ctx, target, Verb.CREATE))
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
                List<String> values = switch (scope.kind()) {
                    case initiated_by_self, assigned_to_self -> List.of(ctx.identity().userId());
                    case self_organization, self_subtree, self_descendants -> {
                        var roots = ctx.roles().rootsForRole(edge.getKey());
                        yield roots.isEmpty() ? List.of() : subjects.organizationCodes(target.domainId(), roots, scope.kind());
                    }
                    case all -> throw new AssertionError();
                };
                if (!values.isEmpty()) matches.add(new Match(scope.className(), scope.field(), values));
            }
        }
        return new Admission(false, List.copyOf(matches));
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
