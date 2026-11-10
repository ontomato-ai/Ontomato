package io.ontomato.dataengine.service;

import java.util.List;

/** Resolved by Java at the HTTP boundary; never bind this type from request data. */
public record ExecutionTarget(String contextId, String sandboxId, List<String> classNames, Long expiresAt) {
  public static final ExecutionTarget LIVE = new ExecutionTarget(null, null, List.of(), null);
  public ExecutionTarget { classNames = List.copyOf(classNames); }
  public boolean testing() { return contextId != null; }
  public void requireClasses(List<String> names) {
    if (testing() && (names == null || names.isEmpty() || !classNames.containsAll(names)))
      throw new org.springframework.web.server.ResponseStatusException(
          org.springframework.http.HttpStatus.FORBIDDEN, "BUILD_TEST_FORBIDDEN: empty or out-of-context class declaration");
  }
}
