package io.ontomato.dataengine.service.agent;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

/** Public business entries recover the same caller scope as ontology query entries. */
@Service
public class AgentExecutionScope {
  public static final String CALLER_HEADER = "X-Ontomato-Retrieval-Caller-Id";
  private final OntologyAgentAccess access;
  public AgentExecutionScope(OntologyAgentAccess access) { this.access = access; }

  public QueryAccessService.Access queryAccess(String caller, QueryAccessService.Access query) {
    return access.scopedQuery(query, caller);
  }

  public ExecutionTarget target(HttpServletRequest request, User user, UserDataPermission permission, ExecutionTarget target) {
    String caller = request.getHeader(CALLER_HEADER);
    return caller == null ? target : target(caller, user, permission, target);
  }

  public ExecutionTarget callerTarget(String caller, User user, UserDataPermission permission) {
    return target(caller, user, permission, ExecutionTarget.LIVE);
  }

  private ExecutionTarget target(String caller, User user, UserDataPermission permission, ExecutionTarget target) {
    var scoped = queryAccess(caller, new QueryAccessService.Access(user,permission,null,null,null).withTarget(target));
    target.requireClasses(scoped.classNames());
    long expiresAt = target.expiresAt() == null ? scoped.expiresAt() : Math.min(target.expiresAt(), scoped.expiresAt());
    return new ExecutionTarget(target.contextId(),target.sandboxId(),scoped.classNames(),expiresAt,
        scoped.executionUserId(),scoped.initiatorUserId());
  }
}
