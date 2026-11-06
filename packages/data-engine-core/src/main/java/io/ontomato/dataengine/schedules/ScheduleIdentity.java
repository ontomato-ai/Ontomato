package io.ontomato.dataengine.schedules;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/**
 * Edition-specific recovery of a persisted creator; application authorization stays with
 * IdentityService.
 */
public interface ScheduleIdentity {
  User creator(String domain, String creator);

  UserDataPermission dataPermission(String domain, String creator);

  default String hostOwner(String creator) {
    return creator;
  }

  String onlineToken();

  String onlineApiKey();

  boolean interactiveLogin();

  String issueKey(User user);

  boolean accepts(String key, String domain, String creator);
}
