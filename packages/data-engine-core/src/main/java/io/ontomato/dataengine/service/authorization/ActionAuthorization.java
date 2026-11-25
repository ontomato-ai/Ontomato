package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.CapabilityGrantLookup.Admission;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import org.springframework.stereotype.Service;

@Service
public class ActionAuthorization {
    private final AuthorizationService authorization;
    private final AdminService admin;

    public ActionAuthorization(AuthorizationService authorization, AdminService admin) {
        this.authorization = authorization;
        this.admin = admin;
    }

    public SubjectContext subject(User user) {
        return subject(user.getDomainId(), user.getId());
    }

    public SubjectContext subject(String domain, String user) {
        return authorization.resolveSubject(new VerifiedIdentity(domain, user, CredentialLimit.UNRESTRICTED));
    }

    public void requireCreate(SubjectContext subject) {
        require(authorization.decide(subject, new Create(Kind.ACTION)));
    }

    public boolean allowsDefinition(SubjectContext subject, Action action) {
        return authorization.decide(subject, object(action, Verb.VIEW)).allowed()
                || authorization.decide(subject, object(action, Verb.EDIT)).allowed();
    }

    public void requireEdit(SubjectContext subject, Action action) {
        require(authorization.decide(subject, object(action, Verb.EDIT)));
    }

    public void requireDefinition(SubjectContext subject, Action action) {
        if (!allowsDefinition(subject, action))
            throw new Denied("OBJECT_FORBIDDEN", "You do not have permission to read this action definition.");
    }

    public Admission standalone(SubjectContext subject, Action action, ExecutionTarget target) {
        return decide(subject, action, new Standalone(), target).admission();
    }

    public Admission requireExecution(SubjectContext subject, Action action, ActionPath path, ExecutionTarget target) {
        var result = decide(subject, action, path, target);
        require(result.decision());
        return result.admission();
    }

    private ActionDecision decide(SubjectContext subject, Action action, ActionPath path, ExecutionTarget target) {
        var result = authorization.decideAction(subject,
                new AuthorizationService.Action(target(action), path, target, ownership(action)));
        if (!result.decision().allowed() || result.admission().unrestricted()) return result;
        if (action.getTarget() == null) return outsideScope();
        var definition = action.getTarget().definition(admin.getJSONRule(action.getDomainId()));
        var fields = ((java.util.List<java.util.Map<String, Object>>) definition.get("attrs")).stream()
                .filter(field -> !Boolean.FALSE.equals(field.get("enable")))
                .map(field -> field.get("name")).collect(java.util.stream.Collectors.toSet());
        var matches = result.admission().matches().stream()
                .filter(match -> action.getTarget().className().equals(match.className()) && fields.contains(match.field()))
                .toList();
        return matches.isEmpty() ? outsideScope() : new ActionDecision(result.decision(), new Admission(false, matches));
    }

    private static ActionDecision outsideScope() {
        return new ActionDecision(Decision.denied("ACTION_TARGET_OUT_OF_SCOPE",
                "This action has no applicable target scope."), Admission.DENIED);
    }

    private static ObjectAccess object(Action action, Verb verb) {
        return new ObjectAccess(target(action), verb, ownership(action));
    }

    private static ObjectTarget target(Action action) {
        return new ObjectTarget(action.getDomainId(), Kind.ACTION, action.getId());
    }

    private static OwnerFacts ownership(Action action) {
        var state = Action.STATUS_PENDING_REVIEW.equals(action.getStatus()) ? DefinitionState.DRAFT : DefinitionState.PUBLISHED;
        return new OwnerFacts(action.getCreatedBy(), state, action.getCoauthorIds());
    }

    private static void require(Decision decision) {
        if (!decision.allowed()) throw new Denied(decision.code(), decision.reason());
    }

    public static final class Denied extends OwnerRefusal {
        public Denied(String code, String message) {
            super(code, message);
        }
    }
}
