package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.service.CapabilityGrantLookup;
import io.ontomato.dataengine.service.CapabilityGrantLookup.Admission;
import io.ontomato.dataengine.service.CapabilityGrantLookup.Match;
import io.ontomato.dataengine.service.ExecutionTarget;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthorizationAccessInspector {
    public record InspectRequest(String subjectId, String entryId, String targetPolicyId,
                                 List<InspectItem> items, List<ActionTargetInput> optionalActionTargets) {}
    public record InspectItem(Kind kind, String id, Verb verb, OwnerFacts ownerFacts) {}
    public record ActionTargetInput(String actionId, String className, String objectId, Map<String, Object> fields) {}

    public record InspectResult(String subjectId, String entryId, String targetPolicyId, ItemResult entry, List<ItemResult> items,
                                Set<String> targetPolicyRoleIds, Set<String> subjectRoleIds) {}
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ItemResult(Kind kind, String id, Verb verb, boolean allowed, String code, String reason,
                             List<Source> sources, List<GrantScope> effectiveScopes, List<ActionTargetResult> targetDecisions) {}
    public record ActionTargetResult(String actionId, String className, String objectId,
                                     boolean allowed, String code, String reason) {}
    public record WorkflowStepAction(String actionId, String workflowId, String workflowName, int version,
                                     int stepNo, String stepName) {}

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Source(String type, String ownerId, String rule, String policyId,
                         @JsonProperty("roleIds") List<String> hitRoleIds, GrantScope scope, String workflowId, String workflowName,
                         Integer version, Integer stepNo) {
        static Source ownership(String ownerId) {
            return new Source("ownership", ownerId, null, null, null, null, null, null, null, null);
        }

        static Source distribution(String entitlement) {
            return new Source("distribution", null, entitlement, null, null, null, null, null, null, null);
        }

        static Source policy(String policyId, List<String> hitRoleIds, GrantScope scope) {
            return new Source("policy", null, null, policyId, hitRoleIds, scope, null, null, null, null);
        }

        static Source workflowStep(WorkflowStepAction step) {
            return new Source("workflow_step", null, null, null, null, null,
                    step.workflowId(), step.workflowName(), step.version(), step.stepNo());
        }
    }

    private final AuthorizationService authorization;
    private final AuthorizationStore store;
    private final AuthorizationSubjects subjects;
    private final AuthorizationPolicies policies;
    private final WorkflowDao workflows;
    private final CapabilityGrantLookup capabilityGrants;
    private final ActionDao actions;

    public AuthorizationAccessInspector(AuthorizationService authorization, AuthorizationStore store,
            AuthorizationSubjects subjects, AuthorizationPolicies policies, WorkflowDao workflows,
            CapabilityGrantLookup capabilityGrants, ActionDao actions) {
        this.authorization = authorization;
        this.store = store;
        this.subjects = subjects;
        this.policies = policies;
        this.workflows = workflows;
        this.capabilityGrants = capabilityGrants;
        this.actions = actions;
    }

    public InspectResult inspectAccess(SubjectContext caller, InspectRequest request) {
        var read = authorization.decide(caller, new Management(AuthorizationPolicies.READ));
        if (!read.allowed()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, read.reason());
        if (blank(request.subjectId()) || blank(request.entryId()))
            throw badRequest("A subject ID and entry ID are required.");

        var domainId = caller.identity().domainId();
        var items = request.items() == null ? List.<InspectItem>of() : request.items();
        var objectRequests = new ArrayList<Request>();
        var actionIds = new LinkedHashSet<String>();
        for (var item : items) {
            validateItem(item);
            if (isActionExecution(item)) actionIds.add(item.id());
            else objectRequests.add(objectRequest(domainId, item));
        }
        var targetChecks = actionTargets(request.optionalActionTargets(), actionIds);

        var subject = authorization.resolveSubject(new VerifiedIdentity(domainId, request.subjectId(),
                CredentialLimit.UNRESTRICTED));
        var entry = inspectEntry(subject, new ObjectTarget(domainId, Kind.ENTRY, request.entryId()));
        var decisions = authorization.decideBatch(subject, objectRequests).iterator();
        var steps = actionIds.isEmpty() ? Map.<String, List<ActiveStep>>of() :
                activeSteps(domainId).stream().filter(step -> actionIds.contains(step.action().actionId()))
                        .collect(Collectors.groupingBy(step -> step.action().actionId()));
        var workflowAdmissions = new HashMap<WorkflowRevision, Map<Integer, Admission>>();
        var actionResults = new HashMap<String, ItemResult>();
        var results = new ArrayList<ItemResult>();
        for (var item : items) {
            if (isActionExecution(item)) {
                results.add(actionResults.computeIfAbsent(item.id(), id -> inspectAction(subject, item,
                        steps.getOrDefault(id, List.of()), targetChecks.getOrDefault(id, List.of()), workflowAdmissions)));
            } else {
                results.add(inspectObject(subject, item, decisions.next()));
            }
        }
        var policyId = blank(request.targetPolicyId()) ? null : request.targetPolicyId();
        var policyRoles = policyId == null ? Set.<String>of() : policies.policyRoleIds(caller, policyId);
        return new InspectResult(request.subjectId(), request.entryId(), policyId, entry, results,
                policyRoles, subject.roles().effectiveRoleIds());
    }

    public List<WorkflowStepAction> workflowStepActions(String domainId) {
        return activeSteps(domainId).stream().map(ActiveStep::action).toList();
    }

    private record ActiveStep(WorkflowStepAction action, GrantScope.Kind scopeKind) {}

    private List<ActiveStep> activeSteps(String domainId) {
        var steps = new ArrayList<ActiveStep>();
        for (var workflow : workflows.queryList(Workflow.STATUS_ACTIVE, domainId)) {
            if (workflow.getVersion() == null || workflow.getSteps() == null) continue;
            for (var step : workflow.getSteps()) {
                if (step == null || blank(step.getActionId()) || step.getStepNo() == null) continue;
                var action = new WorkflowStepAction(step.getActionId(), workflow.getId(), workflow.getName(),
                        workflow.getVersion(), step.getStepNo(), step.getName());
                steps.add(new ActiveStep(action, step.getScope()));
            }
        }
        return steps;
    }

    private ItemResult inspectEntry(SubjectContext subject, ObjectTarget target) {
        var decision = authorization.decide(subject, new Entry(target));
        var sources = new ArrayList<Source>();
        if (decision.allowed()) {
            if (subjects.entryEntitlement(target)) sources.add(Source.distribution("entry_entitlement"));
            sources.addAll(policySources(subject, target, Verb.ENTER));
        }
        return itemResult(new InspectItem(Kind.ENTRY, target.id(), Verb.ENTER, null), decision, sources, null, null);
    }

    private ItemResult inspectObject(SubjectContext subject, InspectItem item, Decision decision) {
        var sources = new ArrayList<Source>();
        if (decision.allowed()) {
            var target = objectTarget(subject.identity().domainId(), item);
            addOwnership(sources, subject, target, item.verb(), item.ownerFacts());
            if (subjects.objectEntitlement(subject.identity().userId(), target, item.verb()))
                sources.add(Source.distribution("object_entitlement"));
            sources.addAll(policySources(subject, target, item.verb()));
        }
        return itemResult(item, decision, sources, null, null);
    }

    private ItemResult inspectAction(SubjectContext subject, InspectItem item, List<ActiveStep> steps,
            List<ActionTargetInput> targets, Map<WorkflowRevision, Map<Integer, Admission>> workflowAdmissions) {
        var target = objectTarget(subject.identity().domainId(), item);
        var row = actions.queryById(item.id());
        if (row == null || !target.domainId().equals(((Action) row[0]).getDomainId())) {
            var decision = Decision.denied("ACTION_NOT_FOUND", "The action was not found in this domain.");
            return itemResult(item, decision, List.of(), null, actionTargetResults(targets, decision, Admission.DENIED));
        }
        var action = (Action) row[0];
        var owner = new OwnerFacts(action.getCreatedBy(),
                Action.STATUS_PENDING_REVIEW.equals(action.getStatus())
                        ? DefinitionState.DRAFT : DefinitionState.PUBLISHED, action.getCoauthorIds());
        var standalone = authorization.decideAction(subject,
                new AuthorizationService.Action(target, new Standalone(), ExecutionTarget.LIVE, owner));
        if ("PRIVATE_DRAFT".equals(standalone.decision().code())) {
            return itemResult(item, standalone.decision(), List.of(), null,
                    actionTargetResults(targets, standalone.decision(), Admission.DENIED));
        }

        var sources = new ArrayList<Source>();
        var scopes = new LinkedHashSet<GrantScope>();
        if (standalone.decision().allowed()) {
            addOwnership(sources, subject, target, Verb.EXECUTE, owner);
            if (subjects.unrestrictedStandaloneActions()) sources.add(Source.distribution("unrestricted_standalone_actions"));
            var policySources = policySources(subject, target, Verb.EXECUTE);
            policySources.forEach(source -> scopes.add(source.scope()));
            sources.addAll(policySources);
        }
        var unrestricted = standalone.admission().unrestricted();
        var matches = new LinkedHashSet<>(standalone.admission().matches());
        for (var activeStep : steps) {
            var step = activeStep.action();
            var revision = new WorkflowRevision(step.workflowId(), step.version());
            var byStep = workflowAdmissions.computeIfAbsent(revision, key -> capabilityGrants.stepAdmissions(
                    subject.identity().userId(), target.domainId(), key.id(), key.version()));
            var admission = byStep.getOrDefault(step.stepNo(), Admission.DENIED);
            if (!admission.admitted()) continue;
            sources.add(Source.workflowStep(step));
            unrestricted |= admission.unrestricted();
            matches.addAll(admission.matches());
            if (activeStep.scopeKind() != null && activeStep.scopeKind() != GrantScope.Kind.all) {
                for (var match : admission.matches())
                    scopes.add(new GrantScope(activeStep.scopeKind(), match.className(), match.field()));
            }
        }

        var admission = new Admission(unrestricted, List.copyOf(matches));
        var decision = admission.admitted() ? Decision.ALLOWED : standalone.decision();
        var checked = actionTargetResults(targets, decision, admission);
        var effectiveScopes = checked != null ? null
                : unrestricted ? List.of(GrantScope.ALL) : scopes.isEmpty() ? null : List.copyOf(scopes);
        return itemResult(item, decision, sources, effectiveScopes, checked);
    }

    private record WorkflowRevision(String id, int version) {}

    private static List<ActionTargetResult> actionTargetResults(List<ActionTargetInput> targets, Decision decision,
            Admission admission) {
        if (targets.isEmpty()) return null;
        return targets.stream().map(target -> {
            var result = decision.allowed() ? decideTarget(target, admission) : decision;
            return new ActionTargetResult(target.actionId(), target.className(), target.objectId(),
                    result.allowed(), result.code(), result.reason());
        }).toList();
    }

    private static Decision decideTarget(ActionTargetInput target, Admission admission) {
        if (admission.unrestricted()) return Decision.ALLOWED;
        boolean missingField = false;
        for (var match : admission.matches()) {
            if (!target.className().equals(match.className())) continue;
            var value = target.fields() == null ? null : target.fields().get(match.field());
            if (value == null) missingField = true;
            else if (value instanceof String text && match.values().contains(text)
                    || value instanceof Collection<?> values && values.stream().anyMatch(match.values()::contains))
                return Decision.ALLOWED;
        }
        return missingField
                ? Decision.denied("ACTION_SCOPE_UNVERIFIABLE", "A field required to verify the action scope is missing.")
                : Decision.denied("ACTION_TARGET_OUT_OF_SCOPE", "The target is outside the authorized action scope.");
    }

    private List<Source> policySources(SubjectContext subject, ObjectTarget target, Verb verb) {
        var sources = new ArrayList<Source>();
        for (var grant : store.objectGrants(target, verb, subject.objectPolicyIds())) {
            var roles = subject.policyRefsByRole().entrySet().stream()
                    .filter(edge -> edge.getValue().stream().anyMatch(ref -> ref.kind() == PolicyKind.OBJECT
                            && ref.policyId().equals(grant.policyId())))
                    .map(Map.Entry::getKey)
                    .filter(role -> verb != Verb.EXECUTE || grant.scope().kind() == GrantScope.Kind.all
                            || !authorization.standaloneScopeValues(subject, target, grant.scope(), role).isEmpty())
                    .sorted().toList();
            if (verb != Verb.EXECUTE || !roles.isEmpty())
                sources.add(Source.policy(grant.policyId(), roles, grant.scope()));
        }
        return sources;
    }

    private static void addOwnership(List<Source> sources, SubjectContext subject, ObjectTarget target,
            Verb verb, OwnerFacts owner) {
        if (owner != null && OwnershipAdmission.decide(subject.identity().userId(), target.kind(), verb, owner, false)
                == OwnershipAdmission.Result.ALLOWED)
            sources.add(Source.ownership(owner.ownerId()));
    }

    private static Map<String, List<ActionTargetInput>> actionTargets(List<ActionTargetInput> targets, Set<String> actionIds) {
        if (targets == null) return Map.of();
        var byAction = new HashMap<String, List<ActionTargetInput>>();
        for (var target : targets) {
            if (target == null || blank(target.actionId()) || blank(target.className()) || blank(target.objectId())
                    || !actionIds.contains(target.actionId()))
                throw badRequest("Each action target requires a requested action ID, class name and object ID.");
            byAction.computeIfAbsent(target.actionId(), id -> new ArrayList<>()).add(target);
        }
        return byAction;
    }

    private static Request objectRequest(String domainId, InspectItem item) {
        return item.verb() == Verb.CREATE ? new Create(item.kind()) :
                new ObjectAccess(objectTarget(domainId, item), item.verb(), item.ownerFacts());
    }

    private static ObjectTarget objectTarget(String domainId, InspectItem item) {
        return new ObjectTarget(domainId, item.kind(), item.verb() == Verb.CREATE ? "" : item.id());
    }

    private static void validateItem(InspectItem item) {
        if (item == null || item.kind() == null || item.kind() == Kind.ENTRY || item.verb() == null
                || item.verb() != Verb.CREATE && blank(item.id()))
            throw badRequest("An object kind, ID and verb are required.");
        if (item.verb() == Verb.CREATE) AuthorizationPolicies.requireCreateDecision(item.kind());
        else if (!isActionExecution(item)) AuthorizationPolicies.requireObjectDecision(item.kind(), item.id(), item.verb());
    }

    private static boolean isActionExecution(InspectItem item) {
        return item.kind() == Kind.ACTION && item.verb() == Verb.EXECUTE;
    }

    private static ItemResult itemResult(InspectItem item, Decision decision, List<Source> sources, List<GrantScope> scopes,
            List<ActionTargetResult> targets) {
        return new ItemResult(item.kind(), item.verb() == Verb.CREATE ? "" : item.id(), item.verb(),
                decision.allowed(), decision.code(), decision.reason(), sources, scopes, targets);
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
