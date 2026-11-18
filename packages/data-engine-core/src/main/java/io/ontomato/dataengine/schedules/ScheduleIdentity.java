package io.ontomato.dataengine.schedules;

import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

/**
 * Edition-specific recovery of a persisted creator; application authorization stays with
 * IdentityService.
 */
public interface ScheduleIdentity extends io.ontomato.dataengine.service.identity.UserCredentialIdentity {
  UserDataPermission dataPermission(String domain, String creator);

  default String hostOwner(String creator) {
    return creator;
  }

  String onlineToken();

  String onlineApiKey();

}
