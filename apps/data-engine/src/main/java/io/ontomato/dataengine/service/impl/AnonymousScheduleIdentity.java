package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.schedules.ScheduleIdentity;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import org.springframework.stereotype.Component;

@Component
public class AnonymousScheduleIdentity implements ScheduleIdentity {
  private final AnonymousIdentityService identities;

  public AnonymousScheduleIdentity(AnonymousIdentityService identities) {
    this.identities = identities;
  }

  public User creator(String domain, String creator) {
    return "1".equals(domain) && "admin".equals(creator) ? identities.getCurrentUser() : null;
  }

  public UserDataPermission dataPermission(String domain, String creator) {
    return identities.getCurrentUserDataPermission();
  }

  public String hostOwner(String creator) {
    return "system";
  }

  public String onlineToken() {
    return null;
  }

  public String onlineApiKey() {
    return null;
  }

  public boolean interactiveLogin() {
    return true;
  }

  public String issueKey(User user) {
    return null;
  }

  public boolean accepts(String key, String domain, String creator) {
    return creator(domain, creator) != null;
  }
}
