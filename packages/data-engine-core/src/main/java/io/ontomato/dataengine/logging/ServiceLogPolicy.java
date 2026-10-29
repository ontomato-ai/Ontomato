package io.ontomato.dataengine.logging;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.*;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.config.plugins.Plugin;
import org.apache.logging.log4j.core.config.plugins.PluginFactory;
import org.apache.logging.log4j.core.impl.Log4jLogEvent;
import org.apache.logging.log4j.core.appender.rewrite.RewritePolicy;
import org.apache.logging.log4j.message.StringMapMessage;

/** Normalize before fan-out and before the PG queue. No arbitrary metadata is serialized. */
@Plugin(name = "ServiceLogPolicy", category = "Core", elementType = "rewritePolicy", printObject = true)
public final class ServiceLogPolicy implements RewritePolicy {
  private static final class NormalizedMessage extends StringMapMessage {
    NormalizedMessage(Map<String, String> fields) { super(fields); }
  }
  private static final String INSTANCE = instanceId();
  private static String instanceId() {
    String configured = System.getenv("ONTOMATO_INSTANCE_ID");
    if (configured != null && !configured.isBlank()) return configured;
    String host = System.getenv().getOrDefault("HOSTNAME", "localhost");
    return host + ":" + ProcessHandle.current().pid();
  }
  @PluginFactory public static ServiceLogPolicy create() { return new ServiceLogPolicy(); }
  @Override public LogEvent rewrite(LogEvent source) {
    if (source.getMessage() instanceof NormalizedMessage) return source;
    Map<String, Object> fields = new HashMap<>();
    fields.put("id", UUID.randomUUID().toString());
    fields.put("time", ServiceLogFormat.time(source.getTimeMillis()));
    fields.put("level", source.getLevel().name());
    fields.put("service", "ontology");
    fields.put("module", source.getLoggerName() == null ? "app" : source.getLoggerName());
    fields.put("instanceId", INSTANCE);
    for (String key : ServiceLogContext.KEYS) fields.put(key, source.getContextData().getValue(key));
    fields.put("kind", "app");
    fields.put("message", source.getMessage() == null || source.getMessage() instanceof StringMapMessage ? "structured event" : source.getMessage().getFormattedMessage());
    if (source.getMessage() instanceof ServiceLogEvents.Fields structured) {
      for (String group : List.of("httpFields", "downstreamFields"))
        for (String key : ServiceLogFormat.fields(group)) fields.put(key, structured.get(key));
      fields.put("kind", structured.get("kind"));
      fields.put("message", structured.get("message"));
    }
    if (source.getThrown() != null) {
      StringWriter stack = new StringWriter();
      source.getThrown().printStackTrace(new PrintWriter(stack));
      fields.put("errorName", source.getThrown().getClass().getSimpleName());
      fields.put("stack", stack.toString());
      if (source.getThrown() instanceof java.sql.SQLException sql) fields.put("errorCode", sql.getSQLState());
    }
    Map<String, Object> normalized = ServiceLogFormat.normalize(fields);
    Map<String, String> values = new HashMap<>();
    normalized.forEach((key, value) -> { if (value != null) values.put(key, String.valueOf(value)); });
    values.put("line", ServiceLogFormat.line(normalized));
    return new Log4jLogEvent.Builder(source).setMessage(new NormalizedMessage(values)).setThrown(null).setThrownProxy(null)
      .setContextData(new org.apache.logging.log4j.util.SortedArrayStringMap(values)).build();
  }
}
