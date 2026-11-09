package io.ontomato.dataengine.service;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectReader;
import com.fasterxml.jackson.databind.node.ArrayNode;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.schedules.ScheduleForms;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The one owner of how a function's parameters become form fields and how the text in those fields becomes parameter
 * values, for an Action form a person fills in now and for a scheduled task alike. Each context keeps the input its
 * users already have instead of one becoming the other: an Action form takes JSON for structured values and keeps
 * text and times as typed; a scheduled task takes one item per line, reads a date without an offset in the task's time
 * zone and a blank time as the actual start. Parameters have no required marker: a scheduled task leaves a blank text
 * or number out, which then runs as null.
 */
public final class ParameterForms {
  private ParameterForms() {}

  /** Where the text is typed, and so what it means. */
  public enum Context {
    /** An Action form filled in now. One value fits in a request; an input larger than this belongs to a program. */
    INTERACTIVE(65_536),
    /** A scheduled task's saved content, within the platform's limit. */
    SCHEDULED(TEXT_MAX);

    private final int textMax;

    Context(int textMax) {
      this.textMax = textMax;
    }
  }

  /** The typed values by parameter name, and the errors of the fields that hold no valid value. */
  public record Values(JSONObject values, ArrayNode errors) {}

  private static final Set<String> SCHEDULED_TYPES =
      Set.of(
          Parameter.TYPE_STRING,
          Parameter.TYPE_NUMBER,
          Parameter.TYPE_TIME,
          Parameter.TYPE_STRING_ARRAY,
          Parameter.TYPE_NUMBER_ARRAY,
          Parameter.TYPE_TIME_ARRAY);

  /** Types whose value holds several items or fields, typed on several lines. */
  private static final Set<String> CONTAINERS =
      Set.of(
          Parameter.TYPE_STRING_ARRAY,
          Parameter.TYPE_NUMBER_ARRAY,
          Parameter.TYPE_TIME_ARRAY,
          Parameter.TYPE_ONTOOBJ,
          Parameter.TYPE_DATASET,
          Parameter.TYPE_VECTOR);

  private static final ObjectReader JSON_VALUE =
      JSON.readerFor(Object.class)
          .with(
              DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS,
              DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

  /** Whether a context takes parameters of a type: an Action form every type, a scheduled task no object, dataset or vector. */
  public static boolean supports(String type, Context context) {
    return SCHEDULED_TYPES.contains(type)
        || context == Context.INTERACTIVE && CONTAINERS.contains(type);
  }

  /** One text field per parameter, keyed {@code keyPrefix + name}, in the definition's order. */
  public static ArrayNode fields(
      List<Parameter> parameters, Context context, String keyPrefix, String locale) {
    boolean zh = locale.startsWith("zh");
    var fields = array();
    for (var parameter : parameters)
      fields.add(
          ScheduleForms.text(
              keyPrefix + parameter.getName(),
              parameter.getName(),
              false,
              CONTAINERS.contains(parameter.getType()),
              help(parameter, context, zh),
              context.textMax));
    return fields;
  }

  private static String help(Parameter parameter, Context context, boolean zh) {
    String type = parameter.getType();
    if (context == Context.SCHEDULED) {
      if (Parameter.TYPE_TIME.equals(type))
        return zh
            ? "留空使用实际开始时刻；日期与日期时间按任务时区解释，也可填写 RFC3339"
            : "Leave blank for the actual start time; local dates use the task time zone;"
                + " RFC3339 is also accepted";
      if (CONTAINERS.contains(type))
        return zh ? "每行一项，空行忽略" : "One item per line; blank lines are ignored";
      return parameter.getDescription();
    }
    return switch (type) {
      case Parameter.TYPE_STRING_ARRAY -> zh ? "JSON 数组，如 [\"A\", \"B\"]" : "A JSON array, e.g. [\"A\", \"B\"]";
      case Parameter.TYPE_NUMBER_ARRAY -> zh ? "JSON 数组，如 [1, 2.5]" : "A JSON array, e.g. [1, 2.5]";
      case Parameter.TYPE_TIME_ARRAY ->
          zh ? "JSON 数组，如 [\"2026-11-09\"]" : "A JSON array, e.g. [\"2026-11-09\"]";
      case Parameter.TYPE_DATASET ->
          zh ? "由对象组成的 JSON 数组，如 [{\"id\": 1}]" : "A JSON array of objects, e.g. [{\"id\": 1}]";
      case Parameter.TYPE_ONTOOBJ, Parameter.TYPE_VECTOR ->
          zh ? "JSON 对象，如 {\"id\": 1}" : "A JSON object, e.g. {\"id\": 1}";
      default -> parameter.getDescription();
    };
  }

  /** The text an Action form starts with for a value the page binds: a string as it is, any other value as JSON. */
  public static String text(Object value) {
    return value == null ? "" : value instanceof String text ? text : JSON.valueToTree(value).toString();
  }

  /**
   * What an Action form's fields mean, keyed by parameter name. Every parameter gets a value: text and time as typed,
   * any other type as JSON of that type; a read-only parameter keeps the value the page binds, which must fit its type.
   */
  public static Values interactive(
      List<Parameter> parameters,
      JsonNode texts,
      Map<String, Object> bound,
      Collection<String> readOnly,
      String locale) {
    boolean zh = locale.startsWith("zh");
    var values = new JSONObject();
    var errors = array();
    for (var parameter : parameters) {
      String name = parameter.getName(), type = parameter.getType(), field = "/values/" + pointer(name);
      if (readOnly.contains(name)) {
        Object value = bound.get(name);
        if (value == null || MetricViewBindings.accepts(type, value)) values.put(name, value);
        else
          errors.add(
              ScheduleForms.error(
                  field,
                  code(type, Context.INTERACTIVE),
                  zh ? name + " 的绑定值无效" : "The bound value of " + name + " is invalid"));
        continue;
      }
      String text = texts.path(name).asText();
      if (text.length() > Context.INTERACTIVE.textMax) errors.add(tooLong(field, zh));
      else if (Parameter.TYPE_STRING.equals(type) || Parameter.TYPE_TIME.equals(type)) values.put(name, text);
      else {
        Object value = json(text);
        if (value != null && MetricViewBindings.accepts(type, value) && finite(value)) values.put(name, value);
        else errors.add(invalid(field, type, Context.INTERACTIVE, name, zh));
      }
    }
    return new Values(values, errors);
  }

  /**
   * What a scheduled task's fields mean when it starts at {@code start}, its fields keyed {@code keyPrefix + name} and
   * its errors pointing under {@code pointerPrefix}. A blank text or number is left out; a blank time is {@code start};
   * a list is one item per line, blank lines ignored; a date or minute time without an offset is read in {@code zone}.
   */
  public static Values scheduled(
      List<Parameter> parameters,
      String keyPrefix,
      JsonNode texts,
      ZoneId zone,
      Instant start,
      String pointerPrefix,
      String locale) {
    boolean zh = locale.startsWith("zh");
    var values = new JSONObject();
    var errors = array();
    for (var parameter : parameters) {
      String key = keyPrefix + parameter.getName(), type = parameter.getType();
      String text = texts.path(key).asText();
      if (text.isBlank()
          && (Parameter.TYPE_STRING.equals(type) || Parameter.TYPE_NUMBER.equals(type))) continue;
      try {
        values.put(parameter.getName(), scheduledValue(type, text, zone, start));
      } catch (RuntimeException invalid) {
        errors.add(
            invalid(pointerPrefix + pointer(key), type, Context.SCHEDULED, parameter.getName(), zh));
      }
    }
    return new Values(values, errors);
  }

  private static Object scheduledValue(String type, String text, ZoneId zone, Instant start) {
    return switch (type) {
      case Parameter.TYPE_STRING -> text;
      case Parameter.TYPE_NUMBER -> number(text.trim());
      case Parameter.TYPE_TIME -> text.isBlank() ? start.toString() : time(text.trim(), zone).toString();
      case Parameter.TYPE_STRING_ARRAY, Parameter.TYPE_NUMBER_ARRAY, Parameter.TYPE_TIME_ARRAY ->
          text.lines()
              .map(String::trim)
              .filter(line -> !line.isEmpty())
              .map(
                  line ->
                      switch (type) {
                        case Parameter.TYPE_NUMBER_ARRAY -> (Object) number(line);
                        case Parameter.TYPE_TIME_ARRAY -> time(line, zone).toString();
                        default -> line;
                      })
              .toList();
      default -> throw new IllegalArgumentException("Unsupported parameter");
    };
  }

  private static BigDecimal number(String text) {
    if (!text.matches("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?"))
      throw new IllegalArgumentException();
    var value = new BigDecimal(text);
    if (!Double.isFinite(value.doubleValue())) throw new IllegalArgumentException();
    return value;
  }

  private static Instant time(String text, ZoneId zone) {
    if (text.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
      return LocalDate.parse(text).atStartOfDay(zone).toInstant();
    if (text.matches("[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}"))
      return LocalDateTime.parse(
              text,
              DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm").withResolverStyle(ResolverStyle.STRICT))
          .atZone(zone)
          .toInstant();
    return OffsetDateTime.parse(text, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant();
  }

  /** The JSON value of a text, or null when the text is not one JSON value. */
  private static Object json(String text) {
    try {
      return JSON_VALUE.readValue(text);
    } catch (java.io.IOException invalid) {
      return null;
    }
  }

  /** JSON numbers too large for a double are refused, as a scheduled task refuses them. */
  private static boolean finite(Object value) {
    if (value instanceof BigDecimal || value instanceof BigInteger)
      return Double.isFinite(((Number) value).doubleValue());
    if (value instanceof List<?> items) return items.stream().allMatch(ParameterForms::finite);
    return true;
  }

  private static String code(String type, Context context) {
    if (context == Context.SCHEDULED)
      return type.contains("TIME")
          ? "invalid_time"
          : type.contains("NUMBER") ? "invalid_number" : "invalid_array";
    return switch (type) {
      case Parameter.TYPE_NUMBER -> "invalid_number";
      case Parameter.TYPE_ONTOOBJ, Parameter.TYPE_VECTOR -> "invalid_object";
      default -> "invalid_array";
    };
  }

  private static JsonNode invalid(String field, String type, Context context, String name, boolean zh) {
    return ScheduleForms.error(
        field, code(type, context), zh ? name + " 的值无效" : "Invalid value for " + name);
  }

  private static JsonNode tooLong(String field, boolean zh) {
    int max = Context.INTERACTIVE.textMax;
    return ScheduleForms.error(
        field, "value_too_long", zh ? "最多 " + max + " 个字符" : "At most " + max + " characters");
  }
}
