package io.ontomato.dataengine.logging;

import io.ontomato.dataengine.core.bean.User;
import java.util.*;
import org.apache.logging.log4j.CloseableThreadContext;
import org.apache.logging.log4j.ThreadContext;

public final class ServiceLogContext {
  public static final List<String> KEYS = List.of("correlationId", "domainId", "userId", "runId", "sessionId");
  private ServiceLogContext() {}
  public static String correlation(String incoming) {
    return incoming != null && incoming.matches(ServiceLogFormat.DEFINITION.getString("correlationIdPattern")) ? incoming : UUID.randomUUID().toString();
  }
  public static String header(String name) { return ServiceLogFormat.DEFINITION.getJSONObject("headers").getString(name); }
  public static Map<String, String> capture() {
    Map<String, String> result = new HashMap<>();
    for (String key : KEYS) { String value = ThreadContext.get(key); if (value != null) result.put(key, value); }
    return result;
  }
  public static CloseableThreadContext.Instance open(Map<String, String> values) { return CloseableThreadContext.putAll(values); }
  public static CloseableThreadContext.Instance backend(String sessionId, String domainId) {
    Map<String, String> fields = new HashMap<>();
    if (sessionId != null) {
      fields.put("backendSessionId", sessionId);
      if (ThreadContext.get("sessionId") == null) fields.put("sessionId", sessionId);
    }
    if (domainId != null) fields.put("domainId", domainId);
    return open(fields);
  }
  public static void user(User user) {
    if (user != null) { put("userId", user.getId()); put("domainId", user.getDomainId()); }
  }
  public static void put(String key, String value) {
    if (value == null) ThreadContext.remove(key); else ThreadContext.put(key, value);
  }
  public static Runnable wrap(Runnable action) {
    Map<String, String> captured = capture();
    return () -> {
      Map<String, String> previous = capture(); ThreadContext.removeAll(KEYS);
      try (var ignored = open(captured)) { action.run(); }
      finally { ThreadContext.removeAll(KEYS); ThreadContext.putAll(previous); }
    };
  }
  public static void outbound(java.net.http.HttpRequest.Builder request) {
    for (String key : List.of("correlationId", "runId", "sessionId")) {
      String value = ThreadContext.get(key);
      if (value != null) request.setHeader(header(key), value);
    }
  }
}
