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
  private final OntologyAgentAccess access;
  public AgentExecutionScope(OntologyAgentAccess access) { this.access = access; }

  public ExecutionTarget target(HttpServletRequest request, User user, UserDataPermission permission, ExecutionTarget target) {
    String caller = request.getHeader("X-Ontomato-Retrieval-Caller-Id");
    if (caller == null) return target;
    var scoped = access.scopedQuery(new QueryAccessService.Access(user,permission,null,null,null).withTarget(target),caller);
    target.requireClasses(scoped.classNames());
    return new ExecutionTarget(target.contextId(),target.sandboxId(),scoped.classNames(),target.expiresAt(),
        scoped.executionUserId(),scoped.initiatorUserId());
  }
}
