package io.ontomato.dataengine.util;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

public final class JsonSchemaError {
  private JsonSchemaError() {}

  public static String explain(JSONObject schema, Object value, String fallback) {
    SchemaFailure failure = inspect(schema, value, "");
    if (failure.messages.isEmpty()) return fallback;
    return String.join("; ", failure.messages.stream().distinct().limit(8).toList());
  }

  private static final class SchemaFailure {
    int score;
    final List<String> messages = new ArrayList<>();
    void add(int weight, String path, String detail) {
      score += weight;
      messages.add((path.isEmpty() ? "package" : path) + ": " + detail);
    }
    void addAll(SchemaFailure nested) {
      score += nested.score;
      messages.addAll(nested.messages);
    }
    boolean success() { return messages.isEmpty(); }
  }

  private static SchemaFailure inspect(JSONObject schema, Object value, String path) {
    if (schema.containsKey("oneOf") || schema.containsKey("allOf") || schema.containsKey("not") || schema.containsKey("$ref"))
      return new SchemaFailure();
    JSONArray anyOf = schema.getJSONArray("anyOf");
    if (anyOf != null) return chooseBranch(anyOf, value, path);
    SchemaFailure failure = new SchemaFailure();
    Object type = schema.get("type");
    if (type != null && !typeMatches(type, value)) {
      failure.add(10, path, "expected " + typeName(type) + " but got " + valueType(value));
      return failure;
    }
    if (schema.containsKey("const") && !Objects.equals(schema.get("const"), value))
      failure.add(4, path, "expected `" + schema.get("const") + "` but got `" + value + "`");
    JSONArray enumeration = schema.getJSONArray("enum");
    if (enumeration != null && !enumeration.contains(value))
      failure.add(4, path, "expected one of " + enumeration + " but got `" + value + "`");
    if (value instanceof String text) {
      Integer minLength = schema.getInteger("minLength");
      if (minLength != null && text.length() < minLength) failure.add(2, path, "must contain at least " + minLength + " characters");
      Integer maxLength = schema.getInteger("maxLength");
      if (maxLength != null && text.length() > maxLength) failure.add(2, path, "must contain at most " + maxLength + " characters");
      String pattern = schema.getString("pattern");
      if (pattern != null && !Pattern.compile(pattern).matcher(text).find()) failure.add(2, path, "must match /" + pattern + "/");
      String format = schema.getString("format");
      if (format != null && !validFormat(format, text)) failure.add(2, path, "must be a valid " + format);
    }
    if (value instanceof Number number) {
      Double minimum = schema.getDouble("minimum");
      if (minimum != null && number.doubleValue() < minimum) failure.add(2, path, "must be at least " + minimum);
      Double maximum = schema.getDouble("maximum");
      if (maximum != null && number.doubleValue() > maximum) failure.add(2, path, "must be at most " + maximum);
      Object exclusiveMinimum = schema.get("exclusiveMinimum");
      if (exclusiveMinimum instanceof Number bound && number.doubleValue() <= bound.doubleValue())
        failure.add(2, path, "must be greater than " + bound);
      Object exclusiveMaximum = schema.get("exclusiveMaximum");
      if (exclusiveMaximum instanceof Number bound && number.doubleValue() >= bound.doubleValue())
        failure.add(2, path, "must be less than " + bound);
    }
    if (value instanceof Map<?, ?> object) {
      JSONObject properties = schema.getJSONObject("properties");
      Set<String> allowed = properties == null ? Set.of() : properties.keySet();
      JSONArray required = schema.getJSONArray("required");
      if (required != null) for (Object key : required)
        if (!object.containsKey(key)) failure.add(2, path, "missing required key `" + key + "`");
      if (properties != null) for (String key : properties.keySet())
        if (object.containsKey(key)) failure.addAll(inspect(properties.getJSONObject(key), object.get(key), child(path, key)));
      Object additional = schema.get("additionalProperties");
      if (Boolean.FALSE.equals(additional)) {
        for (Object key : object.keySet()) if (!allowed.contains(key))
          failure.add(1, child(path, key.toString()), allowed.isEmpty()
              ? "unexpected key; no keys are allowed here"
              : "unexpected key; allowed keys here are `" + String.join("`, `", allowed) + "`");
      } else if (additional instanceof JSONObject additionalSchema) {
        for (Object key : object.keySet()) if (!allowed.contains(key))
          failure.addAll(inspect(additionalSchema, object.get(key), child(path, key.toString())));
      }
    }
    if (value instanceof List<?> array) {
      Integer minItems = schema.getInteger("minItems");
      if (minItems != null && array.size() < minItems) failure.add(2, path, "requires at least " + minItems + " item");
      Integer maxItems = schema.getInteger("maxItems");
      if (maxItems != null && array.size() > maxItems) failure.add(2, path, "requires at most " + maxItems + " items");
      if (Boolean.TRUE.equals(schema.getBoolean("uniqueItems")) && array.stream().distinct().count() != array.size())
        failure.add(2, path, "items must be unique");
      JSONObject items = schema.getJSONObject("items");
      if (items != null) for (int i = 0; i < array.size(); i++)
        failure.addAll(inspect(items, array.get(i), path + "[" + i + "]"));
    }
    return failure;
  }

  private static SchemaFailure chooseBranch(JSONArray branches, Object value, String path) {
    SchemaFailure best = null;
    for (int i = 0; i < branches.size(); i++) {
      SchemaFailure branch = inspect(branches.getJSONObject(i), value, path);
      if (branch.success()) return branch;
      if (best == null || branch.score < best.score) best = branch;
      else if (branch.score == best.score) {
        best.score += branch.score;
        for (String message : branch.messages) if (!best.messages.contains(message)) best.messages.add(message);
      }
    }
    return best == null ? new SchemaFailure() : best;
  }

  private static String child(String path, String key) { return path.isEmpty() ? key : path + "." + key; }

  private static boolean typeMatches(Object type, Object value) {
    if (type instanceof JSONArray types) return types.stream().anyMatch(one -> typeMatches(one, value));
    return switch ((String) type) {
      case "object" -> value instanceof Map<?, ?>;
      case "array" -> value instanceof List<?>;
      case "string" -> value instanceof String;
      case "number" -> value instanceof Number;
      case "integer" -> value instanceof Number number && number.doubleValue() == Math.rint(number.doubleValue());
      case "boolean" -> value instanceof Boolean;
      case "null" -> value == null;
      default -> true;
    };
  }

  private static String typeName(Object type) { return type instanceof JSONArray types ? types.toJSONString() : "`" + type + "`"; }

  private static String valueType(Object value) {
    if (value == null) return "null";
    if (value instanceof Map<?, ?>) return "an object";
    if (value instanceof List<?>) return "an array";
    if (value instanceof String) return "a string";
    if (value instanceof Number) return "a number";
    if (value instanceof Boolean) return "a boolean";
    return value.getClass().getSimpleName();
  }

  private static boolean validFormat(String format, String text) {
    try {
      return switch (format) {
        case "uuid" -> { UUID.fromString(text); yield true; }
        case "date-time" -> { OffsetDateTime.parse(text); yield true; }
        default -> true;
      };
    } catch (Exception error) {
      return false;
    }
  }
}
