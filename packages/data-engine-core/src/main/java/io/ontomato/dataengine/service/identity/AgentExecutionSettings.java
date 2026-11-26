package io.ontomato.dataengine.service.identity;

import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
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
  public record Options(boolean canSetExecutionUser, List<AgentExecutionIdentity.Option> users,
      @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
      AgentExecutionIdentity.Selected selected) {}
  public record Execution(String executionUserId, String apiKey) {}

  public Options options(HttpServletRequest request, String keyword, int pageNum, int pageSize, String selected) {
    var actor = identity.operator(request);
    boolean effectiveDomainAdministrator = identity.administrator(actor);
    return new Options(effectiveDomainAdministrator,
      selectableUsers(actor.domainId(), effectiveDomainAdministrator, keyword, pageNum, pageSize),
      selected == null ? null : identity.selected(actor.domainId(), selected));
  }

  public List<AgentExecutionIdentity.Option> options(SubjectContext subject, String keyword, int pageNum, int pageSize) {
    return selectableUsers(subject.identity().domainId(), canSetExecutionUser(subject),
      keyword, pageNum, pageSize);
  }

  public static boolean canSetExecutionUser(SubjectContext subject) {
    return subject.roles().effectiveDomainAdministrator();
  }

  private List<AgentExecutionIdentity.Option> selectableUsers(String domainId, boolean effectiveDomainAdministrator,
      String keyword, int pageNum, int pageSize) {
    return effectiveDomainAdministrator ? identity.options(domainId, keyword, pageNum, pageSize) : List.of();
  }

  public List<AgentExecutionIdentity.Selected> selected(SubjectContext subject, List<String> ids) {
    String domainId = subject.identity().domainId();
    return ids.stream().map(id -> identity.selected(domainId, id)).toList();
  }
  private boolean check(Setting setting, HttpServletRequest request) {
    var actor = identity.operator(request);
    if (!Objects.equals(actor.userId(), setting.operatorId()) || !Objects.equals(actor.domainId(), setting.domainId()))
      throw new AgentHttpException(403, "FORBIDDEN", "Operator identity does not match");
    boolean administrator = identity.administrator(actor);
    validateTarget(actor.domainId(), administrator, setting.oldExecutionUserId(), setting.executionUserId());
    return administrator;
  }

  public void validate(SubjectContext subject, String oldExecutionUserId, String executionUserId) {
    validateTarget(subject.identity().domainId(), canSetExecutionUser(subject), oldExecutionUserId, executionUserId);
  }

  private void validateTarget(String domainId, boolean administrator, String oldExecutionUserId, String executionUserId) {
    if (Objects.equals(oldExecutionUserId, executionUserId)) return;
    if (!administrator)
      throw new AgentHttpException(403, "FORBIDDEN", "Domain governance administrator required");
    if (executionUserId != null) identity.requireTarget(domainId, executionUserId);
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
