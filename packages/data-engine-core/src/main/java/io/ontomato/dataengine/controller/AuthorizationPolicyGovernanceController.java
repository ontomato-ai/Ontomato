package io.ontomato.dataengine.controller;

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
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.AuthorizationAccessInspector;
import io.ontomato.dataengine.service.authorization.AuthorizationAccessInspector.InspectRequest;
import io.ontomato.dataengine.service.authorization.AuthorizationAccessInspector.InspectResult;
import io.ontomato.dataengine.service.authorization.AuthorizationAccessInspector.WorkflowStepAction;
import io.ontomato.dataengine.service.authorization.AuthorizationPolicies;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Set;
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
    public record RoleActionGrant(String roleId, String actionId, String policyId, GrantScope.Kind scopeKind) {}
    public record RoleWorkflowAuthoring(String roleId, String workflowId, String policyId, Verb verb) {}
    public record GraphFacts(List<PolicyGrantFact> policyGrants, List<RoleActionGrant> roleActionGrants,
                             List<RoleWorkflowAuthoring> roleWorkflowAuthoring) {}

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

    public AuthorizationPolicyGovernanceController(WorkbenchServiceAuthentication workbench, IdentityService identity,
            AuthorizationService authorization, AuthorizationPolicies policies, AuthorizationAccessInspector inspector,
            ApplicationCatalog catalog, AuthorizationSubjects subjects, AuthorizationStore store,
            ActionDao actions, WorkflowDao workflows) {
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

    @PostMapping("/graph-facts")
    public GraphFacts graphFacts(HttpServletRequest request) {
        var domainId = actor(request).domainId();
        var policyGrants = new ArrayList<PolicyGrantFact>();
        var actionGrants = new ArrayList<RoleActionGrant>();
        var workflowGrants = new ArrayList<RoleWorkflowAuthoring>();
        var rolesByPolicy = new HashMap<String, Set<String>>();
        List<String> workflowIds = null;
        for (var grant : store.domainObjectGrants(domainId)) {
            var target = grant.target();
            var verb = grant.verb();
            var policyId = grant.policyId();
            policyGrants.add(new PolicyGrantFact(policyId, target.kind(), target.id(), verb, grant.scope()));
            var roleIds = rolesByPolicy.computeIfAbsent(policyId, id -> store.policyRoleIds(domainId, id));
            if (target.kind() == Kind.ACTION && verb == Verb.EXECUTE) {
                for (var roleId : roleIds)
                    actionGrants.add(new RoleActionGrant(roleId, target.id(), policyId, grant.scope().kind()));
            }
            if (target.kind() == Kind.WORKFLOW && (verb == Verb.EDIT || verb == Verb.CREATE)) {
                if (verb == Verb.CREATE && workflowIds == null)
                    workflowIds = workflows.queryList(null, domainId).stream().map(Workflow::getId).toList();
                var ids = verb == Verb.CREATE ? workflowIds : List.of(target.id());
                for (var roleId : roleIds) {
                    for (var id : ids) workflowGrants.add(new RoleWorkflowAuthoring(roleId, id, policyId, verb));
                }
            }
        }
        return new GraphFacts(policyGrants, actionGrants, workflowGrants);
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
