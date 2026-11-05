package io.ontomato.dataengine.schedules;

import io.ontomato.dataengine.core.bean.User;

/**
 * Edition-specific identity only. Function operations retain their existing permission identifiers.
 */
public interface ScheduleIdentity {
  enum FunctionOperation {
    LIST("queryList"),
    READ("queryById"),
    RESULT("queryResultById"),
    SAVE("save"),
    DELETE("delete"),
    RUN("runOnce"),
    HISTORY("queryResultPageByTaskId");
    public final String permission;

    FunctionOperation(String operation) {
      permission = "/writeTask/" + operation;
    }
  }

  boolean permits(User user, FunctionOperation operation);

  default String hostOwner(String owner) {
    return owner;
  }

  String onlineToken();

  boolean interactiveLogin();

  String issueKey(User user);

  boolean accepts(String key, String domain, String owner);
}
