package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.authorization.AuthorizationService.*;
import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import org.springframework.stereotype.Service;

/** Authorization for the published retriever in the verified caller's domain. */
@Service
public class RetrieverAccess {
  private final AuthorizationService authorization;
  private final AuthorizationStore policies;

  public RetrieverAccess(AuthorizationService authorization, AuthorizationStore policies) {
    this.authorization = authorization;
    this.policies = policies;
  }

  /** Called only by domain creation and the one-time upgrade of the former shared default. */
  public void initializeDefaultUse(String domainId) {
    var policy = policies.domainPolicy(domainId);
    policies.grantObject(new ObjectGrant(policy.policyId(), target(domainId), Verb.USE, null));
  }

  private static ObjectTarget target(String domainId) {
    return new ObjectTarget(domainId, Kind.AGENT, OntologyAgentStore.RETRIEVER);
  }

  public SubjectContext subject(OntologyAgentStore.Owner caller) {
    return authorization.resolveSubject(
        new VerifiedIdentity(caller.domainId(), caller.userId(), CredentialLimit.UNRESTRICTED));
  }

  public Decision decide(SubjectContext subject, Verb verb) {
    return authorization.decide(subject, new ObjectAccess(
        target(subject.identity().domainId()), verb, new OwnerFacts(null, DefinitionState.PUBLISHED)));
  }

  public void require(SubjectContext subject, Verb verb) {
    var decision = decide(subject, verb);
    if (!decision.allowed()) throw new AgentHttpException(403, decision.code(), decision.reason());
  }
}
