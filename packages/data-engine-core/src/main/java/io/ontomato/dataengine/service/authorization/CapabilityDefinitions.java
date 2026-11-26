package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CapabilityDefinitions {
    private final AuthorizationService authorization;
    private final IdentityService identity;

    public CapabilityDefinitions(AuthorizationService authorization, IdentityService identity) {
        this.authorization = authorization;
        this.identity = identity;
    }

    public SubjectContext current() {
        return subject(identity.getCurrentUser());
    }

    public SubjectContext subject(User user) {
        return authorization.resolveSubject(new VerifiedIdentity(user.getDomainId(), user.getId(), CredentialLimit.UNRESTRICTED));
    }

    public boolean canRead(SubjectContext subject, ObjectAccess use) {
        return readDecision(subject, use).allowed();
    }

    public void requireRead(SubjectContext subject, ObjectAccess use) {
        var decision = readDecision(subject, use);
        if (!decision.allowed()) throw new Denied(decision);
    }

    private Decision readDecision(SubjectContext subject, ObjectAccess use) {
        var decision = authorization.decide(subject, use);
        if (decision.allowed()) return decision;
        var view = authorization.decide(subject, new ObjectAccess(use.target(), Verb.VIEW, use.ownerFacts()));
        if (view.allowed()) return view;
        var edit = authorization.decide(subject, new ObjectAccess(use.target(), Verb.EDIT, use.ownerFacts()));
        return edit.allowed() ? edit : decision;
    }

    public boolean allows(SubjectContext subject, Request request) {
        return authorization.decide(subject, request).allowed();
    }

    public void require(SubjectContext subject, Request request) {
        var decision = authorization.decide(subject, request);
        if (!decision.allowed()) throw new Denied(decision);
    }

    public static ObjectAccess access(MetricView metric, Verb verb) {
        return access(metric.getDomainId(), Kind.METRIC, metric.getId(), metric.getCreatedBy(),
                metric.getStatus(), MetricView.STATUS_PENDING_REVIEW, verb);
    }

    public static Kind functionKind(String operation) {
        return Function.OPERATION_WRITE.equals(operation) ? Kind.WRITE_FUNCTION : Kind.READ_FUNCTION;
    }

    public static ObjectAccess access(Function function, Verb verb) {
        return new ObjectAccess(new ObjectTarget(function.getDomainId(), functionKind(function.getOperation()), function.getId()),
                verb, new OwnerFacts(author(function.getCreatedBy()), function.isPublished() ? DefinitionState.PUBLISHED : DefinitionState.DRAFT));
    }

    public static ObjectAccess access(Trigger trigger, Verb verb) {
        var state = Trigger.PENDING_REVIEW.equals(trigger.status()) ? DefinitionState.DRAFT : DefinitionState.PUBLISHED;
        return new ObjectAccess(new ObjectTarget(trigger.domain(), Kind.TRIGGER, trigger.id()), verb,
                new OwnerFacts(trigger.creator(), state, trigger.coauthors()));
    }

    public static ObjectAccess access(Workflow workflow, Verb verb) {
        var state = Workflow.STATUS_DRAFT.equals(workflow.getStatus()) ? DefinitionState.DRAFT : DefinitionState.PUBLISHED;
        return new ObjectAccess(new ObjectTarget(workflow.getDomainId(), Kind.WORKFLOW, workflow.getId()), verb,
                new OwnerFacts(author(workflow.getCreatedBy()), state, workflow.getCoauthorIds()));
    }

    private static ObjectAccess access(String domainId, Kind kind, String id, String owner, String status,
                                       String draftStatus, Verb verb) {
        return new ObjectAccess(new ObjectTarget(domainId, kind, id), verb,
                new OwnerFacts(author(owner), status == null || draftStatus.equals(status) ? DefinitionState.DRAFT : DefinitionState.PUBLISHED));
    }

    private static String author(String stored) {
        return stored == null || stored.isBlank() ? null : stored;
    }

    public static final class Denied extends ResponseStatusException {
        private final String code;

        public Denied(Decision decision) {
            super(HttpStatus.FORBIDDEN, decision.reason());
            this.code = decision.code();
            getBody().setProperty("code", code);
        }

        public String code() { return code; }
    }
}
