package io.ontomato.dataengine.schedules;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/** JSON boundary helpers. Application content remains text until its owner interprets it. */
public final class ScheduleJson {
  public static final ObjectMapper JSON =
      new ObjectMapper()
          .findAndRegisterModules()
          .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

  private ScheduleJson() {}

  public static ObjectNode object(Object... pairs) {
    var result = JSON.createObjectNode();
    for (int i = 0; i < pairs.length; i += 2)
      result.set((String) pairs[i], JSON.valueToTree(pairs[i + 1]));
    return result;
  }

  public static ArrayNode array() {
    return JSON.createArrayNode();
  }

  public static JsonNode parse(String value) {
    try {
      return JSON.readTree(value);
    } catch (Exception error) {
      throw new IllegalArgumentException("Invalid persisted schedule JSON", error);
    }
  }

  public static void keys(JsonNode value, String... allowed) {
    if (value == null || !value.isObject()) throw bad("Expected an object");
    var expected = Set.of(allowed);
    value
        .fieldNames()
        .forEachRemaining(
            key -> {
              if (!expected.contains(key)) throw bad("Unexpected field: " + key);
            });
  }

  public static String text(JsonNode value, String key) {
    if (!value.path(key).isTextual() || value.path(key).asText().isBlank())
      throw bad("Missing " + key);
    return value.get(key).asText();
  }

  public static void content(JsonNode value) {
    if (value == null
        || !value.isObject()
        || value.size() > 100
        || value.toString().getBytes(StandardCharsets.UTF_8).length > 65536)
      throw bad("Invalid form content");
    value
        .fields()
        .forEachRemaining(
            field -> {
              if (field.getKey().isEmpty()
                  || field.getKey().length() > 256
                  || !field.getValue().isTextual()
                  || field.getValue().asText().length() > 4000)
                throw bad("Invalid form value: " + field.getKey());
            });
  }

  public static Set<String> fieldNames(JsonNode value) {
    var keys = new HashSet<String>();
    value.fieldNames().forEachRemaining(keys::add);
    return keys;
  }

  public static String pointer(String value) {
    return value.replace("~", "~0").replace("/", "~1");
  }

  public static ScheduleException bad(String message) {
    return new ScheduleException(400, "INVALID_REQUEST", message);
  }
}
