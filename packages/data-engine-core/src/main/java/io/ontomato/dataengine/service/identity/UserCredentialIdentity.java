package io.ontomato.dataengine.service.identity;

import io.ontomato.dataengine.core.bean.User;

/** Edition-owned member recovery and internal key operations. */
public interface UserCredentialIdentity {
  User creator(String domain, String userId);
  boolean interactiveLogin();
  String issueKey(User user);
  boolean accepts(String key, String domain, String userId);
}
