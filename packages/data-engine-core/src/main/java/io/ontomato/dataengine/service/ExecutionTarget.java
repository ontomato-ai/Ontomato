package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;

/** Resolved by Java at the HTTP boundary; never bind this type from request data. */
public record ExecutionTarget(String contextId, String sandboxId, List<String> classNames, Long expiresAt, String executionUserId, String initiatorUserId, boolean actionTrial) {
  public ExecutionTarget(String contextId, String sandboxId, List<String> classNames, Long expiresAt,
      String executionUserId, String initiatorUserId) {
    this(contextId, sandboxId, classNames, expiresAt, executionUserId, initiatorUserId, false);
  }
  public static ExecutionTarget actionTrial(String sandboxId, List<String> classNames, long expiresAt) {
    return new ExecutionTarget(sandboxId, sandboxId, classNames, expiresAt, null, null, true);
  }
  public ExecutionTarget(String contextId, String sandboxId, List<String> classNames, Long expiresAt) {
    this(contextId,sandboxId,classNames,expiresAt,null,null);
  }
  public static final ExecutionTarget LIVE = new ExecutionTarget(null, null, List.of(), null);
  public ExecutionTarget { classNames = List.copyOf(classNames); }
  public static void failure(JSONObject response, Exception error) {
    if(error instanceof ResponseStatusException failure && failure.getReason()!=null && failure.getReason().startsWith("SANDBOX_"))
      response.put("code",failure.getReason().split(":",2)[0]);
  }
  public enum Mode { LIVE, SANDBOX }
  public Mode mode() { return sandboxId == null ? Mode.LIVE : Mode.SANDBOX; }
  public boolean testing() { return contextId != null; }
  public boolean allowsClasses(List<String> names) {
    return (!testing() && classNames.isEmpty()) || (names != null && !names.isEmpty() && classNames.containsAll(names));
  }
  public void requireClasses(List<String> names) {
    if (!allowsClasses(names)) {
      if(testing()) throw new SandboxException(HttpStatus.FORBIDDEN, "SANDBOX_FORBIDDEN: empty or out-of-context class declaration");
      throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Execution exceeds the caller class scope");
    }
  }
}
