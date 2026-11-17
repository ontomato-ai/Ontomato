package io.ontomato.dataengine.service.identity;

import io.ontomato.dataengine.core.bean.User;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;

/** User settings use original credentials, never an agent principal identity. */
public interface AgentExecutionIdentity {
  record Actor(String userId, String domainId) {}
  record Option(String id, String name) {}
  record Selected(String id, String name, boolean available,
      @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) String reason) {}
  Actor operator(HttpServletRequest request);
  void requireInitiator(Actor actor);
  boolean administrator(Actor actor);
  List<Option> options(String domainId, String keyword, int pageNum, int pageSize);
  Selected selected(String domainId, String userId);
  User requireTarget(String domainId, String userId);
}
