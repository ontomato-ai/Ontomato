package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

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
      String callerId) {}

  public Context governance(HttpServletRequest request) {
    var context = authenticated(request);
    if (!identity.hasKnowledgeGovernanceAccess())
      throw new AgentHttpException(403, "FORBIDDEN", "Business knowledge permission is required");
    return context;
  }

  public Context authenticated(HttpServletRequest request) {
    if (request.getAttribute(QueryGrantService.ATTRIBUTE) != null)
      throw new AgentHttpException(403, "FORBIDDEN", "A current user credential is required");
    var user = identity.getCurrentUser();
    if (user == null || !user.isEnable() || user.getDomainId() == null || user.getDomainId().isBlank())
      throw new AgentHttpException(401, "UNAUTHENTICATED", "A current domain credential is required");
    return new Context(new OntologyAgentStore.Owner(user.getId(),user.getDomainId()), null,
      request.getHeader("tk"), request.getHeader("X-API-Key"),
      request.getHeader("Accept-Language") == null ? "en" : request.getHeader("Accept-Language"),
      identity.getCurrentCredentialExpiresAt(), null);
  }

  /** Build the same governance context for a verified persisted background creator. */
  public Context scheduledGovernance(io.ontomato.dataengine.core.bean.User user, String language) {
    if (user == null || !user.isEnable() || user.getDomainId() == null)
      throw new AgentHttpException(403, "FORBIDDEN", "A current domain member is required");
    if (!identity.hasKnowledgeGovernanceAccess(user.getId(), user.getDomainId()))
      throw new AgentHttpException(403, "FORBIDDEN", "Business knowledge permission is required");
    return new Context(new OntologyAgentStore.Owner(user.getId(), user.getDomainId()), null, null, null, language, null, null);
  }

  public boolean governanceAllowed() { return identity.hasKnowledgeGovernanceAccess(); }

  public Context forAgent(HttpServletRequest request, String agent) {
    return KnowledgeGovernanceService.AGENT.equals(agent) ? governance(request) : current(request);
  }

  public Context forSession(HttpServletRequest request, String session) {
    var owner = authenticated(request).owner();
    return forAgent(request, store.session(session,owner).getString("agent_id"));
  }

  public Context current(HttpServletRequest request) {
    var access = queries.access(request);
    if (access.grant() != null && !"retrieval-exploration".equals(access.grant().getString("purpose")))
      throw new AgentHttpException(403, "FORBIDDEN", "A current user credential is required");
    String caller = request.getHeader("X-Ontomato-Retrieval-Caller-Id");
    return new Context(
        new OntologyAgentStore.Owner(access.user().getId(), access.user().getDomainId()),
        access,
        request.getHeader("tk"),
        request.getHeader("X-API-Key"),
        request.getHeader("Accept-Language") == null ? "en" : request.getHeader("Accept-Language"),
        access.expiresAt(),
        caller == null ? null : AgentJson.id(caller));
  }

  /** Reuses the existing caller scope for assistant metadata and direct query commands. */
  public QueryAccessService.Access scopedQuery(QueryAccessService.Access access, String callerId) {
    var owner = new OntologyAgentStore.Owner(access.user().getId(), access.user().getDomainId());
    var caller = store.caller(AgentJson.id(callerId), owner, false);
    if (caller.getBooleanValue("closed")) throw new AgentHttpException(409, "RETRIEVAL_RUN_CLOSED", "Caller is closed");
    return new QueryAccessService.Access(access.user(), access.permission(), access.grant(), access.credential(),
        access.expiresAt(), caller.getJSONObject("input").getList("classNames", String.class));
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
    return OntologyAgentStore.owner(store.serviceCaller(caller, serviceDomain(request)));
  }

  /** The domain a workbench service request acts in; the service, not a user, is authenticated. */
  public String serviceDomain(HttpServletRequest request) {
    service(request);
    String domain = request.getHeader("X-Domain-Id");
    if (domain == null || domain.isBlank()) throw AgentHttpException.invalid("Domain is required");
    return domain;
  }

  public OntologyAgentStore.Owner reader(HttpServletRequest request, String session, String run) {
    if (request.getHeader("X-Ontomato-Query-Service-Token") == null)
      return forSession(request, session).owner();
    String caller = AgentJson.id(request.getHeader("X-Ontomato-Retrieval-Caller-Id"));
    var owner = callerOwner(request, caller);
    store.requireCallerResource(caller, session, run);
    return owner;
  }

  /**
   * A session read decision captured on the request thread. A long-lived SSE body runs off
   * that thread, where the edition's identity is not available, so the verified owner and
   * permissions are fixed here and only the per-session ownership lookup happens later.
   */
  public final class SessionReads {
    private final OntologyAgentStore.Owner owner;
    private final boolean governance;
    private final boolean query;

    private SessionReads(
        OntologyAgentStore.Owner owner, boolean governance, boolean query) {
      this.owner = owner;
      this.governance = governance;
      this.query = query;
    }

    public boolean readable(String session) {
      try {
        var row = store.session(session, owner);
        return KnowledgeGovernanceService.AGENT.equals(row.getString("agent_id"))
            ? governance
            : query;
      } catch (AgentHttpException error) {
        if (error.status() == 404 || error.status() == 403) return false;
        throw error;
      }
    }

    public OntologyAgentStore.Owner owner() {
      return owner;
    }
  }

  /** The user-level list connection; both list routes take the current user credential. */
  public SessionReads sessionReads(HttpServletRequest request) {
    var context = authenticated(request);
    return new SessionReads(
        context.owner(), identity.hasKnowledgeGovernanceAccess(), queryAllowed());
  }

  /** Only the capability's own 403 means no query permission; every other failure propagates. */
  private boolean queryAllowed() {
    try {
      identity.requireQueryAccess();
      return true;
    } catch (ResponseStatusException denied) {
      if (denied.getStatusCode().value() == 403) return false;
      throw denied;
    }
  }
}
