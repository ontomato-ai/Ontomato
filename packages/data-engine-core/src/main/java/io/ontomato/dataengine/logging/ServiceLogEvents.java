package io.ontomato.dataengine.logging;

import java.util.HashMap;
import java.util.Map;
import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.MarkerManager;
import org.apache.logging.log4j.message.StringMapMessage;

public final class ServiceLogEvents {
  private ServiceLogEvents() {}
  static final class Fields extends StringMapMessage { Fields(Map<String, String> fields) { super(fields); } }
  public static void lifecycle(String event, String sessionId) {
    try (var ignored = ServiceLogContext.backend(sessionId, org.apache.logging.log4j.ThreadContext.get("domainId"))) {
      LogManager.getLogger("execution").info(event);
    }
  }
  public static void emit(String module, Level level, String kind, String message, Map<String, ?> fields, Throwable error) {
    Map<String, String> values = new HashMap<>();
    fields.forEach((key, value) -> { if (value != null) values.put(key, String.valueOf(value)); });
    values.put("kind", kind); values.put("message", message);
    LogManager.getLogger(module).log(level, new Fields(values), error);
  }
  public static void downstream(String module, String target, long started, String outcome) {
    emit(module, Level.INFO, "downstream", "downstream call completed", Map.of("target", target,
      "durationMs", (System.nanoTime() - started) / 1_000_000, "outcome", outcome), null);
  }
  public static void localWarning(String message) {
    LogManager.getLogger("logging").warn(MarkerManager.getMarker("LOGGING_LOCAL"), message);
  }
}
