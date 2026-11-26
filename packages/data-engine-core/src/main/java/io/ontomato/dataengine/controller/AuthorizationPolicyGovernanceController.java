package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.applications.PolicyEntryCatalog;
import io.ontomato.dataengine.applications.PolicyEntryCatalog.EntryRoot;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.dao.TriggerDao;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import io.ontomato.dataengine.core.bean.R;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.AuthorizationAccessInspector;
import io.ontomato.dataengine.service.authorization.AuthorizationAccessInspector.InspectRequest;
import io.ontomato.dataengine.service.authorization.AuthorizationAccessInspector.InspectResult;
import io.ontomato.dataengine.service.authorization.AuthorizationAccessInspector.WorkflowStepAction;
import io.ontomato.dataengine.service.authorization.AuthorizationPolicies;
import io.ontomato.dataengine.service.authorization.ManagementEndpoint;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.stream.Collectors;
import java.util.List;
import java.util.Set;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@Owned
@RequestMapping("/authorization/policies")
public class AuthorizationPolicyGovernanceController {
    public record EntryRootsRequest(String policyId, Set<String> entryIds) {}
    public record EntryRootsResult(String policyId, List<EntryRoot> entries, List<ExistingGrant> existingGrants,
                                   Set<String> targetPolicyRoleIds, List<PublishedAction> publishedActions,
                                   List<WorkflowStepAction> workflowStepActions) {}
    public record PublishedAction(String id, String name, String targetClass, String targetKeyField) {}
    public record GrantItem(Kind kind, String id, Verb verb, GrantScope scope) {}
    public record ExistingGrant(String policyId, Kind kind, String id, Verb verb, GrantScope scope) {}
    public record GrantEntriesRequest(String policyId, List<String> entryIds, List<GrantItem> acceptedObjects) {}
    public record GrantEntriesResult(String policyId, int grantedEntryCount, int grantedObjectCount) {}
    public record PolicyRequest(String policyId) {}
    public record PendingItem(long id, String source, String changeKey, String actorId, String entryId,
                              Kind kind, String targetId, Verb verb, GrantScope scope) {}
    public record PendingResult(String policyId, boolean canManage, Set<String> targetPolicyRoleIds,
                                List<PendingItem> items) {}
    public record Resolution(Long id, Boolean confirm, GrantScope scope) {}
    public record ResolvePendingRequest(String policyId, List<Resolution> resolutions) {}
    public record ResolvePendingResult(String policyId, int resolvedCount) {}
    public record PolicyGrantFact(String policyId, Kind targetKind, String targetKey, Verb verb, GrantScope scope) {}
    public record GraphFacts(List<PolicyRef> rolePolicies, String domainPolicyId,
                             List<ApplicationCatalog.VisibleEntry> entries,
                             List<PolicyGrantFact> policyGrants) {}

    private final WorkbenchServiceAuthentication workbench;
    private final IdentityService identity;
    private final AuthorizationService authorization;
    private final AuthorizationPolicies policies;
    private final AuthorizationAccessInspector inspector;
    private final ApplicationCatalog catalog;
    private final AuthorizationSubjects subjects;
    private final AuthorizationStore store;
    private final ActionDao actions;
    private final WorkflowDao workflows;
    private final TriggerDao triggers;

    public AuthorizationPolicyGovernanceController(WorkbenchServiceAuthentication workbench, IdentityService identity,
            AuthorizationService authorization, AuthorizationPolicies policies, AuthorizationAccessInspector inspector,
            ApplicationCatalog catalog, AuthorizationSubjects subjects, AuthorizationStore store,
            ActionDao actions, WorkflowDao workflows, TriggerDao triggers) {
        this.workbench = workbench;
        this.identity = identity;
        this.authorization = authorization;
        this.policies = policies;
        this.inspector = inspector;
        this.catalog = catalog;
        this.subjects = subjects;
        this.store = store;
        this.actions = actions;
        this.workflows = workflows;
        this.triggers = triggers;
    }

    @PostMapping("/entry-roots")
    public EntryRootsResult entryRoots(HttpServletRequest request, @RequestBody EntryRootsRequest input) {
        var ctx = authorization.resolveSubject(actor(request));
        requireRead(ctx);
        var domainId = ctx.identity().domainId();
        var selected = input.entryIds() == null ? Set.<String>of() : input.entryIds();
        var entries = PolicyEntryCatalog.list(catalog, subjects, domainId, selected);
        var policyId = blank(input.policyId()) ? null : input.policyId();
        var existing = List.<ExistingGrant>of();
        var roles = Set.<String>of();
        if (policyId != null) {
            existing = policies.listObjectGrants(ctx, policyId).stream()
                    .map(grant -> new ExistingGrant(grant.policyId(), grant.target().kind(),
                            grant.target().id(), grant.verb(), grant.scope()))
                    .toList();
            roles = policies.policyRoleIds(ctx, policyId);
        }
        return new EntryRootsResult(policyId, entries, existing, roles,
                publishedActions(domainId), inspector.workflowStepActions(domainId));
    }

    @PostMapping("/entries:grant")
    public GrantEntriesResult grantEntries(HttpServletRequest request, @RequestBody GrantEntriesRequest input) {
        var ctx = authorization.resolveSubject(actor(request));
        var policyId = requirePolicyId(input.policyId());
        if (input.entryIds() == null || input.acceptedObjects() == null)
            throw badRequest("Entry IDs and accepted objects are required.");

        var domainId = ctx.identity().domainId();
        var entries = input.entryIds().stream().map(id -> {
            if (blank(id)) throw badRequest("Each entry requires an ID.");
            return new ObjectTarget(domainId, Kind.ENTRY, id);
        }).distinct().toList();
        var grants = input.acceptedObjects().stream().map(item -> {
            if (item == null || item.kind() == null || item.kind() == Kind.ENTRY || item.verb() == null || item.id() == null)
                throw badRequest("Each accepted object requires a kind, ID and verb.");
            return new ObjectGrant(policyId, new ObjectTarget(domainId, item.kind(), item.id()), item.verb(), item.scope());
        }).distinct().toList();
        policies.grantEntries(ctx, policyId, entries, grants);
        return new GrantEntriesResult(policyId, entries.size(), grants.size());
    }

    @PostMapping("/pending:list")
    public PendingResult listPending(HttpServletRequest request, @RequestBody PolicyRequest input) {
        var ctx = authorization.resolveSubject(actor(request));
        var policyId = requirePolicyId(input.policyId());
        var items = policies.listPending(ctx, policyId).stream().map(item -> {
            var grant = item.grant();
            return new PendingItem(item.id(), item.source(), item.changeKey(), item.actorId(),
                    item.entry() == null ? null : item.entry().id(), grant.target().kind(), grant.target().id(),
                    grant.verb(), grant.scope());
        }).toList();
        var roles = policies.policyRoleIds(ctx, policyId);
        var canManage = authorization.decide(ctx, new Management(AuthorizationPolicies.CHANGE)).allowed();
        return new PendingResult(policyId, canManage, roles, items);
    }

    @Transactional
    @PostMapping("/pending:resolve")
    public ResolvePendingResult resolvePending(HttpServletRequest request, @RequestBody ResolvePendingRequest input) {
        var ctx = authorization.resolveSubject(actor(request));
        var policyId = requirePolicyId(input.policyId());
        if (input.resolutions() == null || input.resolutions().isEmpty())
            throw badRequest("At least one pending resolution is required.");
        for (var resolution : input.resolutions()) {
            if (resolution == null || resolution.id() == null || resolution.id() <= 0 || resolution.confirm() == null)
                throw badRequest("Each resolution requires a pending ID and a confirm flag.");
        }
        for (var resolution : input.resolutions()) {
            policies.resolvePending(ctx, policyId, resolution.id(), resolution.confirm(), resolution.scope());
        }
        return new ResolvePendingResult(policyId, input.resolutions().size());
    }

    @PostMapping("/access:inspect")
    public InspectResult inspectAccess(HttpServletRequest request, @RequestBody InspectRequest input) {
        return inspector.inspectAccess(authorization.resolveSubject(actor(request)), input);
    }

    public record RegistrationTarget(Kind kind, String key) {}
    public record RegistrationRequest(List<RegistrationTarget> targets) {}

    @ManagementEndpoint(AuthorizationPolicies.READ)
    @PostMapping("/registered-targets/check")
    public R<Set<RegistrationTarget>> registeredTargets(@RequestBody RegistrationRequest input) {
        if (input.targets() == null || input.targets().stream()
                .anyMatch(target -> target == null || target.kind() == null || blank(target.key())))
            throw badRequest("Each target requires a kind and a stable key");
        var keysByKind = input.targets().stream().collect(Collectors.groupingBy(RegistrationTarget::kind,
                Collectors.mapping(RegistrationTarget::key, Collectors.toSet())));
        var domainId = identity.getCurrentUser().getDomainId();
        var matches = new java.util.LinkedHashSet<RegistrationTarget>();
        for (Map.Entry<Kind, Set<String>> group : keysByKind.entrySet()) {
            var keys = group.getValue();
            var registered = switch (group.getKey()) {
                case ENTRY -> catalog.registeredEntryIds(domainId, keys);
                case APPLICATION -> catalog.registeredApplicationIds(domainId, keys);
                case WORKFLOW -> workflows.queryList(null, domainId).stream().map(Workflow::getId)
                        .filter(keys::contains).collect(Collectors.toSet());
                case TRIGGER -> triggers.queryList(domainId, null).stream().map(trigger -> trigger.getId())
                        .filter(keys::contains).collect(Collectors.toSet());
                case AGENT -> keys.contains(OntologyAgentStore.RETRIEVER) ? Set.of(OntologyAgentStore.RETRIEVER) : Set.<String>of();
                default -> throw badRequest("This runtime does not own registrations for " + group.getKey());
            };
            registered.forEach(key -> matches.add(new RegistrationTarget(group.getKey(), key)));
        }
        return R.ok(matches);
    }

    @PostMapping("/graph-facts")
    public GraphFacts graphFacts(HttpServletRequest request) {
        var domainId = actor(request).domainId();
        var policyGrants = store.domainObjectGrants(domainId).stream().map(grant ->
                new PolicyGrantFact(grant.policyId(), grant.target().kind(), grant.target().id(),
                        grant.verb(), grant.scope())).toList();
        return new GraphFacts(store.domainRolePolicies(domainId), store.domainPolicy(domainId).policyId(),
                catalog.visibleEntries(identity.getCurrentUser()), policyGrants);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public void malformedBody() {}

    private List<PublishedAction> publishedActions(String domainId) {
        return actions.queryList(null, null, null, domainId).stream()
                .map(row -> (Action) row[0])
                .filter(action -> Action.STATUS_PUBLISHED.equals(action.getStatus()))
                .map(action -> {
                    var target = action.getTarget();
                    return new PublishedAction(action.getId(), action.getName(), target == null ? null : target.className(),
                            target == null ? null : target.keyParameter());
                }).toList();
    }

    private VerifiedIdentity actor(HttpServletRequest request) {
        workbench.authenticate(request);
        if (request.getAttribute(QueryGrantService.ATTRIBUTE) != null)
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Normal user authentication is required.");
        var user = identity.getCurrentUser();
        if (user == null || !user.isEnable() || blank(user.getId()) || blank(user.getDomainId()))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "An active user in a domain is required.");
        return new VerifiedIdentity(user.getDomainId(), identity.workbenchSubjectId(user), CredentialLimit.UNRESTRICTED);
    }

    private void requireRead(SubjectContext ctx) {
        var decision = authorization.decide(ctx, new Management(AuthorizationPolicies.READ));
        if (!decision.allowed()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, decision.reason());
    }

    private static String requirePolicyId(String policyId) {
        if (blank(policyId)) throw badRequest("A policy ID is required.");
        return policyId;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
