package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.AuthorizationPolicies;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import io.ontomato.dataengine.service.authorization.DefinitionFirstPublication.Selection;
import io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@Owned
public final class ObjectAuthorizationController {
    public static final String DECIDE_BATCH = "/authorization/objects/decide-batch";
    public static final String READ_RANGES = "/authorization/objects/read-ranges";
    private static final Set<Kind> CATALOGUE_KINDS = Set.of(Kind.PANEL, Kind.PROJECTION, Kind.AGENT);
    public static final String FIRST_PUBLICATION = "/authorization/objects/first-publication";
    public static final String AGENT_ACCESS = "/authorization/objects/agent-access";
    public static final String AGENT_LEVEL = "/authorization/objects/agent-level";
    public static final String DOMAIN_USE = "/authorization/objects/domain-use";
    public static final String RETIRE = "/authorization/objects/retire";
    public static final String PRODUCT_ACCESS = "/authorization/objects/product-access";
    public static final String PRODUCT_GRANT = "/authorization/objects/product-grant";
    public static final String PRODUCT_DOMAIN_USE = "/authorization/objects/product-domain-use";

    public record DecisionInput(ObjectTarget target, Verb verb, OwnerFacts ownerFacts, Kind create) {}
    public record BatchInput(List<DecisionInput> requests) {}
    public record BatchResult(List<Decision> decisions) {}
    public record RangesInput(Kind kind, Set<Verb> verbs) {}
    public record RangesResult(Map<Verb, ObjectVisibilityRange> ranges) {}
    public record PublicationInput(ObjectTarget target, OwnerFacts ownerFacts, Selection access) {}
    public record PublicationResult(AuthorizationPolicies.PublicationStatus status) {}
    public record AgentInput(ObjectTarget target, OwnerFacts ownerFacts) {}
    public record AgentLevelInput(ObjectTarget target, OwnerFacts ownerFacts, String policyId,
                                  @JsonProperty(value = "level", required = true) Verb level) {}
    public record DomainUseInput(ObjectTarget target, OwnerFacts ownerFacts, Boolean shared) {}
    public record ProductGrantInput(ObjectTarget target, OwnerFacts ownerFacts, String policyId, Verb verb, Boolean remove) {}

    private final WorkbenchServiceAuthentication workbench;
    private final IdentityService identity;
    private final AuthorizationService authorization;
    private final AuthorizationPolicies policies;

    public ObjectAuthorizationController(WorkbenchServiceAuthentication workbench, IdentityService identity,
            AuthorizationService authorization, AuthorizationPolicies policies) {
        this.workbench = workbench;
        this.identity = identity;
        this.authorization = authorization;
        this.policies = policies;
    }

    @PostMapping(DECIDE_BATCH)
    public BatchResult decideBatch(HttpServletRequest request, @RequestBody BatchInput input) {
        var actor = actor(request);
        if (input.requests() == null) throw badRequest("A requests array is required.");
        var operations = input.requests().stream().map(item -> operation(actor, item)).toList();
        return new BatchResult(authorization.decideBatch(authorization.resolveSubject(actor), operations));
    }

    @Owned
    @PostMapping(READ_RANGES)
    public RangesResult readRanges(HttpServletRequest request, @RequestBody RangesInput input) {
        var actor = actor(request);
        if (input.kind() == null || !CATALOGUE_KINDS.contains(input.kind()) || input.verbs() == null || input.verbs().isEmpty())
            throw badRequest("A catalogue object kind and its access verbs are required.");
        input.verbs().forEach(verb -> AuthorizationPolicies.requireObjectReadVerb(input.kind(), verb));
        return new RangesResult(authorization.readObjectRanges(authorization.resolveSubject(actor), input.kind(), input.verbs()));
    }

    @PostMapping(FIRST_PUBLICATION)
    public PublicationResult firstPublication(HttpServletRequest request, @RequestBody PublicationInput input) {
        var actor = actor(request);
        requireFacts(actor, input.target(), input.ownerFacts());
        var access = input.access();
        if (access == null) throw badRequest("Select domain access or supply an object policy ID.");
        return new PublicationResult(policies.firstPublication(authorization.resolveSubject(actor),
                input.target(), input.ownerFacts(), access.policyId()));
    }

    @PostMapping(AGENT_ACCESS)
    public AuthorizationPolicies.AgentAccess agentAccess(HttpServletRequest request, @RequestBody AgentInput input) {
        var actor = actor(request);
        requireFacts(actor, input.target(), input.ownerFacts());
        return policies.agentAccess(authorization.resolveSubject(actor), input.target(), input.ownerFacts());
    }

    @PostMapping(AGENT_LEVEL)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void agentLevel(HttpServletRequest request, @RequestBody AgentLevelInput input) {
        var actor = actor(request);
        requireFacts(actor, input.target(), input.ownerFacts());
        if (blank(input.policyId())) throw badRequest("An object policy ID is required.");
        policies.replaceAgentLevel(authorization.resolveSubject(actor), input.policyId(), input.target(),
                input.level(), input.ownerFacts());
    }

    @PostMapping(DOMAIN_USE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void domainUse(HttpServletRequest request, @RequestBody DomainUseInput input) {
        var actor = actor(request);
        requireFacts(actor, input.target(), input.ownerFacts());
        if (input.shared() == null) throw badRequest("A shared flag is required.");
        policies.setAgentDomainUse(authorization.resolveSubject(actor), input.target(), input.ownerFacts(), input.shared());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public void malformedBody() {}

    @PostMapping(RETIRE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void retire(HttpServletRequest request, @RequestBody AgentInput input) {
        var actor = actor(request);
        requireFacts(actor, input.target(), input.ownerFacts());
        policies.retireObject(authorization.resolveSubject(actor), input.target(), input.ownerFacts());
    }

    @PostMapping(PRODUCT_ACCESS)
    public AuthorizationPolicies.ObjectAccessPolicies productAccess(HttpServletRequest request, @RequestBody AgentInput input) {
        var actor = actor(request);
        requireFacts(actor, input.target(), input.ownerFacts());
        return policies.productAccess(authorization.resolveSubject(actor), input.target(), input.ownerFacts());
    }

    @PostMapping(PRODUCT_GRANT)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void productGrant(HttpServletRequest request, @RequestBody ProductGrantInput input) {
        var actor = actor(request);
        requireFacts(actor, input.target(), input.ownerFacts());
        if (blank(input.policyId()) || input.remove() == null)
            throw badRequest("The policy ID and removal intent are required.");
        policies.changeProductAccess(authorization.resolveSubject(actor), input.target(), input.ownerFacts(),
                input.policyId(), input.verb(), input.remove());
    }

    @PostMapping(PRODUCT_DOMAIN_USE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void productDomainUse(HttpServletRequest request, @RequestBody DomainUseInput input) {
        var actor = actor(request);
        requireFacts(actor, input.target(), input.ownerFacts());
        if (input.shared() == null) throw badRequest("A shared flag is required.");
        policies.setProductDomainUse(authorization.resolveSubject(actor), input.target(), input.ownerFacts(), input.shared());
    }

    private VerifiedIdentity actor(HttpServletRequest request) {
        workbench.authenticate(request);
        if (request.getAttribute(QueryGrantService.ATTRIBUTE) != null)
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Normal user authentication is required.");
        var user = identity.getCurrentUser();
        if (user == null || !user.isEnable() || blank(user.getId()) || blank(user.getDomainId()))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "An active user in a domain is required.");
        return new VerifiedIdentity(user.getDomainId(), identity.workbenchSubjectId(user), QueryGrantService.limit(request));
    }

    private static Request operation(VerifiedIdentity actor, DecisionInput item) {
        if (item == null) throw badRequest("An object operation is required.");
        if (item.create() != null) {
            if (item.target() != null || item.verb() != null || item.ownerFacts() != null)
                throw badRequest("A create operation cannot include an object target, verb or owner facts.");
            AuthorizationPolicies.requireCreateDecision(item.create());
            return new Create(item.create());
        }
        requireFacts(actor, item.target(), item.ownerFacts());
        AuthorizationPolicies.requireObjectDecision(item.target().kind(), item.target().id(), item.verb());
        return new ObjectAccess(item.target(), item.verb(), item.ownerFacts());
    }

    private static void requireFacts(VerifiedIdentity actor, ObjectTarget target, OwnerFacts facts) {
        if (target == null || blank(target.domainId()) || target.kind() == null || blank(target.id()) || facts == null)
            throw badRequest("An object target with its domain and owner facts is required.");
        if (!actor.domainId().equals(target.domainId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "The object must be in your domain.");
        if ((facts.ownerId() != null && facts.ownerId().isBlank()) || facts.coauthorIds().stream().anyMatch(String::isBlank)
                || (facts.state() == DefinitionState.DRAFT && facts.ownerId() == null && facts.coauthorIds().isEmpty()))
            throw badRequest("Invalid object owner facts.");
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static ResponseStatusException badRequest(String reason) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
    }
}
