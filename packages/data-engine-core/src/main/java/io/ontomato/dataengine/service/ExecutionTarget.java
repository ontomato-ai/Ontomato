package io.ontomato.dataengine.service;

import java.util.List;

/** Resolved by Java at the HTTP boundary; never bind this type from request data. */
public record ExecutionTarget(String contextId, String sandboxId, List<String> classNames, Long expiresAt) {
  public static final ExecutionTarget LIVE = new ExecutionTarget(null, null, List.of(), null);
  public ExecutionTarget { classNames = List.copyOf(classNames); }
  public static void failure(com.alibaba.fastjson2.JSONObject response, Exception error) {
    if(error instanceof org.springframework.web.server.ResponseStatusException failure && failure.getReason()!=null && failure.getReason().startsWith("BUILD_TEST_"))
      response.put("code",failure.getReason().split(":",2)[0]);
  }
  public boolean testing() { return contextId != null; }
  public void requireClasses(List<String> names) {
    if (testing() && (names == null || names.isEmpty() || !classNames.containsAll(names)))
      throw new org.springframework.web.server.ResponseStatusException(
          org.springframework.http.HttpStatus.FORBIDDEN, "BUILD_TEST_FORBIDDEN: empty or out-of-context class declaration");
  }
}
