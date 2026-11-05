package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.schedules.ScheduleIdentity;
import org.springframework.stereotype.Component;

@Component
public class AnonymousScheduleIdentity implements ScheduleIdentity {
  public boolean permits(User user, FunctionOperation operation) {
    return true;
  }

  public String hostOwner(String owner) {
    return "system";
  }

  public String onlineToken() {
    return null;
  }

  public boolean interactiveLogin() {
    return true;
  }

  public String issueKey(User user) {
    return null;
  }

  public boolean accepts(String key, String domain, String owner) {
    return "1".equals(domain) && "admin".equals(owner);
  }
}
