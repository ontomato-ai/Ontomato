package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

/** Authenticated request context is captured before leaving the servlet thread. */
@Service
public class OntologyAgentAccess {
  private final QueryAccessService queries;
  private final IdentityService identity;
  private final QueryGrantService grants;
  private final OntologyAgentStore store;

  public OntologyAgentAccess(
      QueryAccessService queries,
      IdentityService identity,
      QueryGrantService grants,
      OntologyAgentStore store) {
    this.queries = queries;
    this.identity = identity;
    this.grants = grants;
    this.store = store;
  }

  public record Context(
      OntologyAgentStore.Owner owner,
      QueryAccessService.Access access,
      String token,
      String apiKey,
      String language,
      Long expiresAt,
      String callerId) {
    public JSONObject modelCredential() {
      return token != null && !token.isBlank()
          ? JSONObject.of("kind", "token", "value", token)
          : apiKey != null && !apiKey.isBlank()
              ? JSONObject.of("kind", "api_key", "value", apiKey)
              : JSONObject.of("kind", "none");
    }
  }

  public Context current(HttpServletRequest request) {
    var access = queries.access(request);
    if (access.grant() != null)
      throw new AgentHttpException(403, "FORBIDDEN", "A current user credential is required");
    String caller = request.getHeader("X-Ontomato-Retrieval-Caller-Id");
    return new Context(
        new OntologyAgentStore.Owner(access.user().getId(), access.user().getDomainId()),
        access,
        request.getHeader("tk"),
        request.getHeader("X-API-Key"),
        request.getHeader("Accept-Language") == null ? "en" : request.getHeader("Accept-Language"),
        identity.getCurrentCredentialExpiresAt(),
        caller == null ? null : AgentJson.id(caller));
  }

  public String exploration(
      Context context,
      String retrievalId,
      String sessionId,
      String runId,
      long deadline,
      java.util.List<String> classes) {
    return queries.issueExploration(
        context.access(),
        JSONObject.of(
            "retrievalId",
            retrievalId,
            "runtimeSessionId",
            sessionId,
            "runtimeRunId",
            runId,
            "expiresAt",
            java.time.Instant.ofEpochMilli(deadline).toString(),
            "classNames",
            classes));
  }

  public void service(HttpServletRequest request) {
    grants.requireWorkbench(request);
  }

  public OntologyAgentStore.Owner callerOwner(HttpServletRequest request, String caller) {
    if (request.getHeader("X-Ontomato-Query-Service-Token") == null)
      return current(request).owner();
    service(request);
    String domain = request.getHeader("X-Domain-Id");
    if (domain == null || domain.isBlank()) throw AgentHttpException.invalid("Domain is required");
    return OntologyAgentStore.owner(store.serviceCaller(caller, domain));
  }

  public OntologyAgentStore.Owner reader(HttpServletRequest request, String session, String run) {
    if (request.getHeader("X-Ontomato-Query-Service-Token") == null)
      return current(request).owner();
    String caller = AgentJson.id(request.getHeader("X-Ontomato-Retrieval-Caller-Id"));
    var owner = callerOwner(request, caller);
    store.requireCallerResource(caller, session, run);
    return owner;
  }
}
