package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.type.LogicalType;
import io.ontomato.dataengine.applications.ApplicationCatalog;
import io.ontomato.dataengine.applications.PolicyEntryCatalog;
import io.ontomato.dataengine.applications.PolicyEntryCatalog.EntryRoot;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.ActionTarget;
import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.WorkflowDao;
import io.ontomato.dataengine.schedules.TaskStore;
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
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.authorization.PolicyTypes;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Objects;
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
    private final TaskStore triggers;

    public AuthorizationPolicyGovernanceController(WorkbenchServiceAuthentication workbench, IdentityService identity,
            AuthorizationService authorization, AuthorizationPolicies policies, AuthorizationAccessInspector inspector,
            ApplicationCatalog catalog, AuthorizationSubjects subjects, AuthorizationStore store,
            ActionDao actions, WorkflowDao workflows, TaskStore triggers) {
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
    public record RegistrationRequest(List<RegistrationTarget> targets, JsonNode snapshot) {}

    private record GrantSnapshot(List<SnapshotPolicy> policies, List<SnapshotPolicyLink> policyLinks,
                                 List<SnapshotManagementGrant> managementGrants, List<String> businessDataPolicyIds,
                                 List<JsonNode> grants, List<JsonNode> actions, String ontologyRule) {}
    private record SnapshotPolicy(String id, Integer type) {}
    private record SnapshotPolicyLink(String policyId, Integer type) {}
    private record SnapshotManagementGrant(String policyId, String operationId) {}
    private record SnapshotGrant(String policyId, Kind kind, String key, Verb verb, GrantScope scope) {}
    private record SnapshotAction(String id, String status, String target) {}

    private static final JsonMapper SNAPSHOT_JSON = JsonMapper.builder()
            .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, DeserializationFeature.FAIL_ON_NUMBERS_FOR_ENUMS,
                    DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .withCoercionConfig(LogicalType.Textual, coercions -> coercions
                    .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail)
                    .setCoercion(CoercionInputShape.Float, CoercionAction.Fail)
                    .setCoercion(CoercionInputShape.Boolean, CoercionAction.Fail))
            .build();

    @ManagementEndpoint(AuthorizationPolicies.READ)
    @PostMapping("/registered-targets/check")
    public R<Set<RegistrationTarget>> registeredTargets(@RequestBody RegistrationRequest input) {
        if (input.targets() == null || input.targets().stream()
                .anyMatch(target -> target == null || target.kind() == null || blank(target.key())))
            throw badRequest("Each target requires a kind and a stable key");
        if (input.snapshot() != null && !input.snapshot().isNull()) validateSnapshot(input.snapshot());
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
                case TRIGGER -> triggers.registeredIds(domainId, keys);
                case AGENT -> keys.contains(OntologyAgentStore.RETRIEVER) ? Set.of(OntologyAgentStore.RETRIEVER) : Set.<String>of();
                default -> throw badRequest("This runtime does not own registrations for " + group.getKey());
            };
            registered.forEach(key -> matches.add(new RegistrationTarget(group.getKey(), key)));
        }
        return R.ok(matches);
    }

    private void validateSnapshot(JsonNode body) {
        GrantSnapshot snapshot;
        try {
            snapshot = SNAPSHOT_JSON.treeToValue(body, GrantSnapshot.class);
        } catch (JsonProcessingException invalid) {
            throw badRequest("Invalid policy snapshot");
        }
        if (snapshot.grants() == null || snapshot.actions() == null || snapshot.policies() == null
                || snapshot.policyLinks() == null || snapshot.managementGrants() == null || snapshot.businessDataPolicyIds() == null)
            throw badRequest("Policy snapshot requires policies, role links, management grants, business data policies, grants and actions");
        var policyTypes = validateSnapshotPolicies(snapshot);
        var actionsById = snapshot.actions().stream().collect(Collectors.groupingBy(action -> action.path("id").asText()));
        Map<String, Object> rule = null;
        for (var input : snapshot.grants()) {
            String location = "policy " + input.path("policyId").asText() + ", " + input.path("kind").asText()
                    + ", key " + input.path("key").asText();
            try {
                var grant = SNAPSHOT_JSON.treeToValue(input, SnapshotGrant.class);
                if (grant == null || blank(grant.policyId())) throw badRequest("A policy ID is required");
                requireSnapshotPolicyType(policyTypes, grant.policyId(), PolicyTypes.OBJECT);
                SnapshotAction action = null;
                ActionTarget target = null;
                if (grant.kind() == Kind.ACTION && grant.verb() == Verb.EXECUTE) {
                    var candidates = actionsById.getOrDefault(grant.key(), List.of());
                    if (candidates.size() != 1) throw badRequest("The snapshot must contain exactly one matching Action");
                    action = SNAPSHOT_JSON.treeToValue(candidates.getFirst(), SnapshotAction.class);
                    if (action.target() != null) {
                        target = SNAPSHOT_JSON.readValue(action.target(), ActionTarget.class);
                        if (target == null || blank(target.className()) || blank(target.keyParameter()))
                            throw badRequest("The snapshot Action target requires a class and key parameter");
                        if (rule == null) rule = snapshotRule(snapshot.ontologyRule());
                    }
                }
                policies.validateSnapshotGrant(grant.kind(), grant.key(), grant.verb(), grant.scope(),
                        action == null ? null : action.status(), target, rule);
            } catch (JsonProcessingException invalid) {
                throw badRequest("Invalid grant, scope or Action in " + location + ": " + invalid.getOriginalMessage());
            } catch (ResponseStatusException invalid) {
                throw badRequest(location + ": " + invalid.getReason());
            } catch (IllegalArgumentException invalid) {
                throw badRequest(location + ": " + invalid.getMessage());
            }
        }
    }

    private Map<String, Integer> validateSnapshotPolicies(GrantSnapshot snapshot) {
        Map<String, Integer> types = new HashMap<>();
        var knownTypes = Set.of(PolicyTypes.MANAGEMENT, PolicyTypes.BUSINESS_DATA, PolicyTypes.OBJECT);
        for (var policy : snapshot.policies()) {
            if (policy == null || blank(policy.id()) || policy.type() == null || !knownTypes.contains(policy.type()))
                throw badRequest("Invalid snapshot policy: " + policy);
            if (types.putIfAbsent(policy.id(), policy.type()) != null)
                throw badRequest("Duplicate snapshot policy: " + policy.id());
        }
        for (var link : snapshot.policyLinks()) {
            if (link == null || link.type() == null) throw badRequest("A role link requires a policy and its type: " + link);
            requireSnapshotPolicyType(types, link.policyId(), link.type());
        }
        var operationIds = policies.managementCatalog().stream()
                .map(ManagementOperations.Operation::id).collect(Collectors.toSet());
        for (var grant : snapshot.managementGrants()) {
            if (grant == null || !operationIds.contains(grant.operationId()))
                throw badRequest("Unknown snapshot management operation: " + grant);
            requireSnapshotPolicyType(types, grant.policyId(), PolicyTypes.MANAGEMENT);
        }
        for (var policyId : snapshot.businessDataPolicyIds()) requireSnapshotPolicyType(types, policyId, PolicyTypes.BUSINESS_DATA);
        return types;
    }

    private static void requireSnapshotPolicyType(Map<String, Integer> types, String policyId, int expected) {
        if (!Objects.equals(types.get(policyId), expected))
            throw badRequest("Snapshot policy " + policyId + " requires policy type " + expected);
    }

    private static Map<String, Object> snapshotRule(String content) throws JsonProcessingException {
        if (content == null) throw badRequest("The snapshot ontology rule is required");
        var rule = SNAPSHOT_JSON.readTree(content);
        if (rule == null || !rule.isObject() || !rule.path("classDef").isArray())
            throw badRequest("The snapshot ontology rule requires a classDef array");
        for (var definition : rule.path("classDef")) {
            if (!definition.path("className").isTextual() || !definition.path("attrs").isArray())
                throw badRequest("Each snapshot class requires a className and attrs");
            for (var attribute : definition.path("attrs")) {
                var enable = attribute.get("enable");
                if (!attribute.path("name").isTextual() || enable != null && !enable.isNull() && !enable.isBoolean())
                    throw badRequest("Each snapshot attribute requires a name and a boolean enable when specified");
            }
        }
        return SNAPSHOT_JSON.convertValue(rule, new TypeReference<Map<String, Object>>() {});
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
