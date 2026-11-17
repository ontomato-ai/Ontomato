package io.ontomato.dataengine.service.identity;

import io.ontomato.dataengine.core.bean.User;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;

/** User settings use original credentials, never an agent principal identity. */
public interface AgentExecutionIdentity {
  record Actor(String userId, String domainId) {}
  record Option(String id, String name) {}
  Actor operator(HttpServletRequest request);
  void requireInitiator(Actor actor);
  boolean administrator(Actor actor);
  List<Option> options(String domainId, String keyword, int pageNum, int pageSize);
  User requireTarget(String domainId, String userId);
}
