package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;

/** Resolved by Java at the HTTP boundary; never bind this type from request data. */
public record ExecutionTarget(String contextId, String sandboxId, List<String> classNames, Long expiresAt) {
  public static final ExecutionTarget LIVE = new ExecutionTarget(null, null, List.of(), null);
  public ExecutionTarget { classNames = List.copyOf(classNames); }
  public static void failure(JSONObject response, Exception error) {
    if(error instanceof ResponseStatusException failure && failure.getReason()!=null && failure.getReason().startsWith("BUILD_TEST_"))
      response.put("code",failure.getReason().split(":",2)[0]);
  }
  public boolean testing() { return contextId != null; }
  public void requireClasses(List<String> names) {
    if (testing() && (names == null || names.isEmpty() || !classNames.containsAll(names)))
      throw new ResponseStatusException(
          HttpStatus.FORBIDDEN, "BUILD_TEST_FORBIDDEN: empty or out-of-context class declaration");
  }
}
