package io.ontomato.dataengine.service.identity;

import io.ontomato.dataengine.service.agent.AgentHttpException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Objects;
import org.springframework.stereotype.Service;

@Service
public class AgentExecutionSettings {
  private final AgentExecutionIdentity identity;
  private final UserCredentials credentials;

  public AgentExecutionSettings(AgentExecutionIdentity identity, UserCredentials credentials) {
    this.identity = identity;
    this.credentials = credentials;
  }
  public record Setting(String domainId, String operatorId, String oldExecutionUserId, String executionUserId) {}
  public record Resolution(String domainId, String agentId, String executionUserId, String initiatorId) {}
  public record Options(boolean canSetExecutionUser, List<AgentExecutionIdentity.Option> users) {}
  public record Execution(String executionUserId, String apiKey) {}

  public Options options(HttpServletRequest request, String keyword, int pageNum, int pageSize) {
    var actor = identity.operator(request);
    boolean administrator = identity.administrator(actor);
    return new Options(administrator, administrator ? identity.options(actor.domainId(), keyword, pageNum, pageSize) : List.of());
  }
  private boolean check(Setting setting, HttpServletRequest request) {
    var actor = identity.operator(request);
    if (!Objects.equals(actor.userId(), setting.operatorId()) || !Objects.equals(actor.domainId(), setting.domainId()))
      throw new AgentHttpException(403, "FORBIDDEN", "Operator identity does not match");
    boolean administrator = identity.administrator(actor);
    if (!administrator && !Objects.equals(setting.oldExecutionUserId(), setting.executionUserId()))
      throw new AgentHttpException(403, "FORBIDDEN", "Domain governance administrator required");
    if (setting.executionUserId() != null) identity.requireTarget(actor.domainId(), setting.executionUserId());
    return administrator;
  }
  public void validate(Setting setting, HttpServletRequest request) { check(setting, request); }
  public void prepare(Setting setting, HttpServletRequest request) {
    boolean administrator = check(setting, request);
    if (administrator && setting.executionUserId() != null)
      credentials.prepareForExecutionSetting(identity.requireTarget(setting.domainId(), setting.executionUserId()));
  }
  public Execution resolve(Resolution resolution) {
    identity.requireInitiator(new AgentExecutionIdentity.Actor(resolution.initiatorId(), resolution.domainId()));
    if (resolution.executionUserId() == null) return new Execution(resolution.initiatorId(), null);
    var target = identity.requireTarget(resolution.domainId(), resolution.executionUserId());
    return new Execution(target.getId(), credentials.forOwner(resolution.domainId(), target.getId()));
  }
}
