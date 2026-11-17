package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.identity.AgentExecutionIdentity;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import org.springframework.stereotype.Component;

/** The public workbench's existing anonymous actor has no selectable domain members. */
@Component
public class AnonymousAgentExecutionIdentity implements AgentExecutionIdentity {
  public Actor operator(HttpServletRequest request) { return new Actor("system", "1"); }
  public void requireInitiator(Actor actor) {
    if (!"system".equals(actor.userId()) || !"1".equals(actor.domainId()))
      throw new AgentHttpException(403, "FORBIDDEN", "Invalid anonymous actor");
  }
  public boolean administrator(Actor actor) { return false; }
  public List<Option> options(String domain, String keyword, int pageNum, int pageSize) { return List.of(); }
  public Selected selected(String domain, String userId) { return null; }
  public User requireTarget(String domain, String userId) {
    throw new AgentHttpException(403, "FORBIDDEN", "The public edition executes as the initiator");
  }
}
