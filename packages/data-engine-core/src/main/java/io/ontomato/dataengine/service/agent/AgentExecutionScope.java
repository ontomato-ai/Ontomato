package io.ontomato.dataengine.service.agent;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.agent.OntologyAgentAccess.CallerScope;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

/** Public business entries recover the same caller scope as ontology query entries. */
@Service
public class AgentExecutionScope {
  public static final String CALLER_HEADER = "X-Ontomato-Retrieval-Caller-Id";
  private final OntologyAgentAccess access;
  public AgentExecutionScope(OntologyAgentAccess access) { this.access = access; }

  public CallerScope captureCallerScope(String caller, User user) {
    return access.captureCallerScope(user, caller);
  }

  public ExecutionTarget target(HttpServletRequest request, User user, UserDataPermission permission, ExecutionTarget target) {
    String caller = request.getHeader(CALLER_HEADER);
    return caller == null ? target : scopedTarget(access.scopedQuery(targetAccess(user, permission, target), caller), target);
  }

  public ExecutionTarget callerTarget(CallerScope caller, User user, UserDataPermission permission) {
    var target = ExecutionTarget.LIVE;
    return scopedTarget(caller.queryAccess(targetAccess(user, permission, target)), target);
  }

  private static QueryAccessService.Access targetAccess(User user, UserDataPermission permission, ExecutionTarget target) {
    return new QueryAccessService.Access(user, permission, null, null, null).withTarget(target);
  }

  private static ExecutionTarget scopedTarget(QueryAccessService.Access scoped, ExecutionTarget target) {
    target.requireClasses(scoped.classNames());
    long expiresAt = target.expiresAt() == null ? scoped.expiresAt() : Math.min(target.expiresAt(), scoped.expiresAt());
    return new ExecutionTarget(target.contextId(),target.sandboxId(),scoped.classNames(),expiresAt,
        scoped.executionUserId(),scoped.initiatorUserId());
  }
}
