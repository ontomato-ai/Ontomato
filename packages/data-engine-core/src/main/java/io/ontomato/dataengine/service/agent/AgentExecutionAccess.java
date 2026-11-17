package io.ontomato.dataengine.service.agent;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.schedules.ScheduleIdentity;
import io.ontomato.dataengine.service.identity.UserCredentials;
import org.springframework.stereotype.Service;

/** Restores a trusted execution reference from the edition's current member and shared key facts. */
@Service
public class AgentExecutionAccess {
  private final ScheduleIdentity identities;
  private final UserCredentials credentials;

  public AgentExecutionAccess(ScheduleIdentity identities, UserCredentials credentials) {
    this.identities = identities;
    this.credentials = credentials;
  }

  public User require(String domain, String userId) {
    var user = identities.creator(domain, userId);
    if (user == null || !user.isEnable() || !domain.equals(user.getDomainId()))
      throw new AgentHttpException(403, "EXECUTION_USER_INVALID", "Execution user is no longer an enabled domain member");
    credentials.forOwner(domain, userId);
    return user;
  }
}
