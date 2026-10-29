package io.ontomato.dataengine.logging;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** The shared resource owns the grammar and budgets; this class only applies them. */
public final class ServiceLogFormat {
  public static final JSONObject DEFINITION = load();
  public static final JSONObject DEFAULTS = DEFINITION.getJSONObject("defaults");
  private static final JSONObject LIMITS = DEFINITION.getJSONObject("limits");
  private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
  private ServiceLogFormat() {}
  private static JSONObject load() {
    try (InputStream in = ServiceLogFormat.class.getResourceAsStream("/service-logging-format.json")) {
      if (in == null) throw new IllegalStateException("Shared service logging contract is missing");
      return JSON.parseObject(new String(in.readAllBytes(), StandardCharsets.UTF_8));
    } catch (java.io.IOException error) { throw new ExceptionInInitializerError(error); }
  }
  public static List<String> fields(String key) { return DEFINITION.getList(key, String.class); }
  public static String time(long millis) { return TIME.format(Instant.ofEpochMilli(millis)); }
  public static int bytes(String value) { return value.getBytes(StandardCharsets.UTF_8).length; }
  public static String wellFormed(String value) {
    StringBuilder out = new StringBuilder(value.length());
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (Character.isHighSurrogate(c) && i + 1 < value.length() && Character.isLowSurrogate(value.charAt(i + 1))) {
        out.append(c).append(value.charAt(++i));
      } else out.append(Character.isSurrogate(c) ? '\ufffd' : c);
    }
    return out.toString();
  }
  public static String quote(String value) {
    return JSON.toJSONString(wellFormed(value)).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
  }
  public static String bound(String value, int limit) {
    String text = wellFormed(value);
    if (bytes(quote(text)) <= limit) return text;
    int available = limit - 2 - LIMITS.getIntValue("truncationMarkerReserveBytes");
    int headBudget = available / 2, tailBudget = available - headBudget;
    int head = 0, tail = text.length(), used = 0;
    while (head < text.length()) {
      int next = head + Character.charCount(text.codePointAt(head));
      int size = bytes(quote(text.substring(head, next))) - 2;
      if (used + size > headBudget) break;
      used += size; head = next;
    }
    used = 0;
    while (tail > head) {
      int next = tail - Character.charCount(text.codePointBefore(tail));
      int size = bytes(quote(text.substring(next, tail))) - 2;
      if (used + size > tailBudget) break;
      used += size; tail = next;
    }
    String marker = LIMITS.getString("truncationMarker").replace("{bytes}", String.valueOf(bytes(text.substring(head, tail))));
    return text.substring(0, head) + marker + text.substring(tail);
  }
  public static Map<String, Object> normalize(Map<String, ?> input) {
    Map<String, Object> event = new LinkedHashMap<>();
    List<String> invalid = new ArrayList<>();
    Set<String> fields = new LinkedHashSet<>(fields("prefixFields"));
    for (String group : List.of("baseFields", "httpFields", "downstreamFields", "errorFields")) fields.addAll(fields(group));
    for (String field : fields) {
      Object value = input.get(field);
      String choices = Map.of("service", "services", "kind", "kinds", "outcome", "outcomes").get(field);
      if (choices != null && !fields(choices).contains(String.valueOf(value))) value = null;
      if (value instanceof String text && !fields("prefixFields").contains(field) && !fields("tokenFields").contains(field)) {
        if (fields("identityFields").contains(field)) {
          if (bytes(quote(text)) > LIMITS.getIntValue("encodedIdentityBytes")) { value = null; invalid.add(field); }
          else value = wellFormed(text);
        } else {
          Integer limit = LIMITS.getJSONObject("encodedFieldBytes").getInteger(field);
          value = bound(text, limit == null ? LIMITS.getIntValue("encodedTextBytes") : limit);
        }
      }
      event.put(field, value);
    }
    if (!invalid.isEmpty()) event.put("message", bound(event.get("message") + "; invalid log context: " + String.join(",", invalid), LIMITS.getJSONObject("encodedFieldBytes").getIntValue("message")));
    return event;
  }
  public static String line(Map<String, ?> event) {
    List<String> keys = new ArrayList<>(fields("baseFields"));
    if ("http".equals(event.get("kind"))) keys.addAll(fields("httpFields"));
    if ("downstream".equals(event.get("kind"))) keys.addAll(fields("downstreamFields"));
    if (fields("errorFields").stream().anyMatch(key -> event.get(key) != null)) keys.addAll(fields("errorFields"));
    List<String> parts = new ArrayList<>();
    for (String key : fields("prefixFields")) parts.add(String.valueOf(event.get(key)));
    for (String key : keys) {
      Object value = event.get(key);
      parts.add(key + "=" + (value == null ? DEFINITION.getString("missingValue")
        : fields("tokenFields").contains(key) || fields("integerFields").contains(key) ? value : quote(String.valueOf(value))));
    }
    return String.join(DEFINITION.getString("separator"), parts);
  }
}
