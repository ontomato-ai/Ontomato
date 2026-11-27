package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.*;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Authenticated request context is captured before leaving the servlet thread. */
@Service
public class OntologyAgentAccess {
  /**
   * The narrowing header a run's callback always carries (Node's callback proxy sets it after authenticating the run). It
   * never grants anything; a caller that adds it only narrows itself.
   */
  public static final String AGENT_EXECUTION_HEADER = "X-Ontomato-Agent-Execution";

  /**
   * A run starts agents only through its own agent channel, which keeps its classes, identity and delegation: through its
   * callback it never opens a top-level conversation or an external caller's command as its user.
   */
  public static void refuseAgentExecution(HttpServletRequest request) {
    if (request.getHeader(AGENT_EXECUTION_HEADER) != null)
      throw new AgentHttpException(403, "FORBIDDEN", "A run starts agents through its own agent channel");
  }

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
      String callerId,
      String executionUserId) {
    public Context(OntologyAgentStore.Owner owner, QueryAccessService.Access access, String token, String apiKey,
        String language, Long expiresAt, String callerId) {
      this(owner, access, token, apiKey, language, expiresAt, callerId, null);
    }
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

  public Context forAgent(HttpServletRequest request, String agent) {
    if (!OntologyAgentStore.isKnownAgent(agent)) throw AgentHttpException.missing();
    return current(request);
  }

  public Context forSession(HttpServletRequest request, String session) {
    var owner = authenticated(request).owner();
    return forAgent(request, store.session(session,owner).getString("agent_id"));
  }

  public Context forAgentUse(HttpServletRequest request, String agent) {
    return OntologyAgentStore.RETRIEVER.equals(agent)
        ? current(request, queries.forRetrievalAdmission(request))
        : forAgent(request, agent);
  }

  public Context forSessionUse(HttpServletRequest request, String session) {
    var owner = authenticated(request).owner();
    return forAgentUse(request, store.session(session, owner).getString("agent_id"));
  }

  public Context current(HttpServletRequest request) {
    return current(request, queries.access(request));
  }

  private Context current(HttpServletRequest request, QueryAccessService.Access access) {
    if (access.grant() != null && !"retrieval-exploration".equals(access.grant().getString("purpose")))
      throw new AgentHttpException(403, "FORBIDDEN", "A current user credential is required");
    String caller = request.getHeader("X-Ontomato-Retrieval-Caller-Id");
    String initiator = access.initiatorUserId() == null ? access.user().getId() : access.initiatorUserId();
    return new Context(new OntologyAgentStore.Owner(initiator,access.user().getDomainId()),access,
        request.getHeader("tk"),request.getHeader("X-API-Key"),
        request.getHeader("Accept-Language") == null ? "en" : request.getHeader("Accept-Language"),
        access.expiresAt(),caller==null?null:AgentJson.id(caller),access.executionUserId());
  }

  /** Retrieval operations consume an existing caller; ordinary authentication only captures its reference. */
  public Context executionContext(HttpServletRequest request) {
    return scopedExecution(request, current(request));
  }

  public Context retrievalAdmission(HttpServletRequest request) {
    return scopedExecution(request, current(request, queries.forRetrievalAdmission(request)));
  }

  private Context scopedExecution(HttpServletRequest request, Context context) {
    if(context.callerId()==null)return context;
    var row=executionCaller(context.access(),context.callerId());
    if(!row.getString("user_id").equals(context.access().user().getId()))service(request);
    var scoped=scopedQuery(context.access(),row,false).withExecution(row.getJSONObject("input").getString("executionUserId"),row.getString("user_id"));
    return new Context(OntologyAgentStore.owner(row),scoped,context.token(),context.apiKey(),context.language(),
        scoped.expiresAt(),context.callerId(),row.getJSONObject("input").getString("executionUserId"));
  }

  private JSONObject executionCaller(QueryAccessService.Access access, String callerId) {
    var row = store.serviceCaller(AgentJson.id(callerId), access.user().getDomainId());
    if (!(row.get("input") instanceof JSONObject input)
        || !(row.get("user_id") instanceof String initiator) || initiator.isBlank())
      throw invalidCallerScope();
    var storedExecutor = input.get("executionUserId");
    if (storedExecutor != null && (!(storedExecutor instanceof String executorId) || executorId.isBlank()))
      throw invalidCallerScope();
    String executor = (String) storedExecutor;
    if (!access.user().getId().equals(executor == null ? initiator : executor))
      throw new AgentHttpException(403, "FORBIDDEN", "Caller belongs to another execution user");
    return row;
  }

  /** Reuses the existing caller scope for assistant metadata and direct query commands. */
  public QueryAccessService.Access scopedQuery(QueryAccessService.Access access, String callerId) {
    var caller = executionCaller(access,callerId);
    return scopedQuery(access,caller,true);
  }
  private QueryAccessService.Access scopedQuery(QueryAccessService.Access access, JSONObject caller, boolean useStoredClasses) {
    if (!(caller.get("closed") instanceof Boolean closed) || !(caller.get("deadline") instanceof String expires))
      throw invalidCallerScope();
    if (closed) throw new AgentHttpException(409, "RETRIEVAL_RUN_CLOSED", "Caller is closed");
    long deadline;
    try {
      deadline = Instant.parse(expires).toEpochMilli();
    } catch (DateTimeParseException | ArithmeticException invalidDeadline) {
      throw invalidCallerScope();
    }
    if(deadline<=System.currentTimeMillis())throw new AgentHttpException(403,"CALLER_EXPIRED","Caller has expired");
    // Access normalizes null to an empty list. Only an explicit stored list may represent no extra restriction.
    if (!(caller.getJSONObject("input").get("classNames") instanceof List<?> storedClasses)
        || storedClasses.stream().anyMatch(value -> !(value instanceof String name) || name.isBlank()))
      throw invalidCallerScope();
    var classes = useStoredClasses ? storedClasses.stream().map(String.class::cast).toList() : access.classNames();
    return new QueryAccessService.Access(access.user(), access.permission(), access.grant(), access.credential(),
        access.expiresAt()==null?deadline:Math.min(access.expiresAt(),deadline), classes, access.target(),
        caller.getJSONObject("input").getString("executionUserId"), access.initiatorUserId()==null?access.user().getId():access.initiatorUserId());
  }

  private static AgentHttpException invalidCallerScope() {
    return new AgentHttpException(403, "FORBIDDEN", "The stored caller scope is invalid");
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
    private final boolean query;

    private SessionReads(
        OntologyAgentStore.Owner owner, boolean query) {
      this.owner = owner;
      this.query = query;
    }

    public boolean readable(String session) {
      try {
        var row = store.session(session, owner);
        String agent=row.getString("agent_id");
        return query && OntologyAgentStore.isKnownAgent(agent);
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
        context.owner(), queryAllowed());
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
