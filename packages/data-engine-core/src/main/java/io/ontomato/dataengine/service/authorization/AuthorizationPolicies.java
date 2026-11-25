package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.workflow.GrantScope;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Management;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public final class AuthorizationPolicies implements DefinitionFirstPublication {
    public static final String READ = "authorization.policies.read";
    public static final String CHANGE = "authorization.policies.change";

    private static final Set<Kind> FIRST_PUBLICATION_KINDS = Set.of(Kind.PANEL, Kind.PROJECTION, Kind.COMPONENT,
            Kind.METRIC, Kind.READ_FUNCTION, Kind.AGENT);

    public enum PublicationStatus { granted, pending }

    private final AuthorizationStore store;
    private final ManagementOperations operations;
    private final AuthorizationService authorization;
    private final ActionDao actions;
    private final AdminService admin;

    public AuthorizationPolicies(AuthorizationStore store,
            ManagementOperations operations, AuthorizationService authorization,
            ActionDao actions, AdminService admin) {
        this.store = store;
        this.operations = operations;
        this.authorization = authorization;
        this.actions = actions;
        this.admin = admin;
    }

    @org.springframework.stereotype.Component
    static final class Operations implements ManagementOperations.Contributor {
        @Override
        public List<ManagementOperations.Operation> managementOperations() {
            return List.of(new ManagementOperations.Operation(READ, ManagementOperations.Access.READ),
                    new ManagementOperations.Operation(CHANGE, ManagementOperations.Access.CHANGE));
        }
    }

    public void grantObject(SubjectContext ctx, ObjectGrant grant) {
        requireManagement(ctx, CHANGE);
        if (!ctx.identity().domainId().equals(grant.target().domainId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "The policy and object must be in your domain.");
        requireGrant(grant.target().kind(), grant.target().id(), grant.verb(), grant.scope(), false);
        requireActionScope(grant);
        store.grantObject(grant);
    }

    public void revokeObject(SubjectContext ctx, ObjectGrant grant) {
        requireManagement(ctx, CHANGE);
        if (!ctx.identity().domainId().equals(grant.target().domainId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "The policy and object must be in your domain.");
        store.revokeObject(grant);
    }

    @Override
    public boolean requiresSelection() {
        return store.requiresFirstPublicationAudience();
    }

    @Override
    public void grantUse(SubjectContext subject, ObjectTarget target, Selection selection) {
        requireSelection(selection);
        if (selection != null) applyFirstPublication(subject, target, selection.policyId());
    }

    private PublicationStatus applyFirstPublication(SubjectContext ctx, ObjectTarget target, String policyId) {
        if (!FIRST_PUBLICATION_KINDS.contains(target.kind()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "This object kind has no initial use grant.");
        if (!ctx.identity().domainId().equals(target.domainId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "The policy and object must be in your domain.");
        var grant = new ObjectGrant(policyId == null ? store.domainPolicy(target.domainId()).policyId() : policyId,
                target, Verb.USE, null);
        if (policyId != null && !authorization.decide(ctx, new Management(CHANGE)).allowed()) {
            store.addPendingGrant(new PendingGrant(0, "first-publication", target.id(), ctx.identity().userId(), null, grant));
            return PublicationStatus.pending;
        }
        store.grantObject(grant);
        return PublicationStatus.granted;
    }

    public record ObjectAccessPolicies(boolean shared, List<ObjectGrantView> grants) {}

    public ObjectAccessPolicies productAccess(SubjectContext ctx, ObjectTarget target, OwnerFacts facts) {
        requireProductEdit(ctx, target, facts);
        var domain = store.domainPolicy(target.domainId()).policyId();
        var granted = !store.objectGrants(target, Verb.USE, Set.of(domain)).isEmpty();
        var others = store.objectGrantViews(target).stream().filter(grant -> !domain.equals(grant.policyId())).toList();
        return new ObjectAccessPolicies(granted, others);
    }

    public void changeProductAccess(SubjectContext ctx, ObjectTarget target, OwnerFacts facts,
            String policyId, Verb verb, boolean remove) {
        requireProductEdit(ctx, target, facts);
        if (verb != Verb.USE && verb != Verb.EDIT)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid product object access verb.");
        if (verb == Verb.EDIT && store.domainPolicy(target.domainId()).policyId().equals(policyId))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The domain policy only grants product use.");
        var grant = new ObjectGrant(policyId, target, verb, null);
        if (remove) revokeObject(ctx, grant);
        else grantObject(ctx, grant);
    }

    public void setProductDomainUse(SubjectContext ctx, ObjectTarget target, OwnerFacts facts, boolean shared) {
        requireProductEdit(ctx, target, facts);
        var grant = new ObjectGrant(store.domainPolicy(target.domainId()).policyId(), target, Verb.USE, null);
        if (shared) grantObject(ctx, grant);
        else revokeObject(ctx, grant);
    }

    private void requireProductEdit(SubjectContext ctx, ObjectTarget target, OwnerFacts facts) {
        if (target.kind() != Kind.PANEL && target.kind() != Kind.PROJECTION && target.kind() != Kind.COMPONENT)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a registered product definition.");
        var result = authorization.decide(ctx, new AuthorizationService.ObjectAccess(target, Verb.EDIT, facts));
        if (!result.allowed()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, result.reason());
    }

    public void grantManagement(SubjectContext ctx, String policyId, String operationId) {
        requireManagement(ctx, CHANGE);
        operations.require(operationId);
        store.grantManagement(ctx.identity().domainId(), policyId, operationId);
    }

    public void revokeManagement(SubjectContext ctx, String policyId, String operationId) {
        requireManagement(ctx, CHANGE);
        store.revokeManagement(ctx.identity().domainId(), policyId, operationId);
    }

    public List<PendingGrant> listPending(SubjectContext ctx, String policyId) {
        requireManagement(ctx, READ);
        return store.pendingGrants(ctx.identity().domainId(), policyId);
    }

    public void resolvePending(SubjectContext ctx, String policyId, long id, boolean confirm, GrantScope selection) {
        requireManagement(ctx, CHANGE);
        var domainId = ctx.identity().domainId();
        GrantScope scope = null;
        if (confirm) {
            var grant = store.pendingGrant(domainId, policyId, id).grant();
            scope = grant.scope() == null ? selection : grant.scope();
            if (selection != null && !selection.equals(scope))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The selected scope differs from the proposed scope.");
            requireGrant(grant.target().kind(), grant.target().id(), grant.verb(), scope, false);
            requireActionScope(new ObjectGrant(policyId, grant.target(), grant.verb(), scope));
        }
        store.resolvePendingGrant(domainId, policyId, id, confirm, scope);
    }

    private void requireManagement(SubjectContext ctx, String operation) {
        var decision = authorization.decide(ctx, new Management(operation));
        if (!decision.allowed()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, decision.reason());
    }

    private void requireActionScope(ObjectGrant grant) {
        if (grant.verb() != Verb.EXECUTE) return;
        var target = grant.target();
        var row = actions.queryById(target.id());
        if (row == null || !target.domainId().equals(((Action) row[0]).getDomainId()))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The action must exist in the policy domain.");
        grant.scope().requireTarget(((Action) row[0]).getTarget(), admin.getJSONRule(target.domainId()));
    }

    static void requireGrant(Kind kind, String id, Verb verb, GrantScope scope, boolean candidate) {
        boolean validVerb = switch (kind) {
            case ENTRY -> verb == Verb.ENTER;
            case PANEL, PROJECTION, COMPONENT, APPLICATION -> Set.of(Verb.USE, Verb.EDIT, Verb.CREATE).contains(verb);
            case AGENT, METRIC, READ_FUNCTION, WORKFLOW, WRITE_FUNCTION, TRIGGER, SKILL -> Set.of(Verb.USE, Verb.VIEW, Verb.EDIT, Verb.CREATE).contains(verb);
            case ACTION -> Set.of(Verb.VIEW, Verb.EDIT, Verb.CREATE, Verb.EXECUTE).contains(verb);
        };
        if (!validVerb || id == null || (verb == Verb.CREATE ? !id.isEmpty() : id.isBlank())
                || (verb == Verb.EXECUTE ? scope == null && !candidate : scope != null))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid object permission");
    }
}
