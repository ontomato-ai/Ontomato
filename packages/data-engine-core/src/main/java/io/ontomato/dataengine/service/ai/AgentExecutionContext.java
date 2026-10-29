package io.ontomato.dataengine.service.ai;

import io.ontomato.dataengine.logging.ServiceLogContext;
import org.apache.logging.log4j.CloseableThreadContext;

/** Business context still used by legacy tools until their owning capability migrates. */
public final class AgentExecutionContext implements AutoCloseable {
  private static final ThreadLocal<AgentExecutionContext> CURRENT = new ThreadLocal<>();
  private final String sessionId, agentName, domainId;
  private final AgentExecutionContext previous;
  private final CloseableThreadContext.Instance logging;
  private AgentExecutionContext(String sessionId, String agentName, String domainId) {
    this.sessionId = sessionId; this.agentName = agentName; this.domainId = domainId;
    previous = CURRENT.get(); logging = ServiceLogContext.backend(sessionId, domainId); CURRENT.set(this);
  }
  public static AgentExecutionContext open(String sessionId, String agentName, String domainId) {
    return new AgentExecutionContext(sessionId, agentName, domainId);
  }
  public static AgentExecutionContext current() { return CURRENT.get(); }
  public String getSessionId() { return sessionId; }
  public String getAgentName() { return agentName; }
  public String getDomainId() { return domainId; }
  @Override public void close() {
    logging.close();
    if (previous == null) CURRENT.remove(); else CURRENT.set(previous);
  }
}
