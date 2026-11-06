package io.ontomato.dataengine.service.scheduling;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.schedules.ScheduleException;
import java.math.BigDecimal;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.List;
import java.util.Map;

/** Only the ontology application interprets the text supplied for a saved function's parameters. */
public final class ScheduleParameters {
  private ScheduleParameters() {}

  public static String unsupported(Function function) {
    if (function == null || !Function.OPERATION_WRITE.equals(function.getOperation()))
      return "Expected a write function";
    var names = new java.util.HashSet<String>();
    if (function.getParameters() == null) return "Parameter definitions unavailable";
    if (function.getParameters().size() >= 100) return "Too many parameters for the scheduled form";
    for (var parameter : function.getParameters()) {
      if (parameter.getName() == null
          || parameter.getName().isBlank()
          || parameter.getName().length() > 246
          || !names.add(parameter.getName())) return "Invalid parameter names";
      if (parameter.getType() == null) return "Parameter type is missing";
      if (List.of(Parameter.TYPE_ONTOOBJ, Parameter.TYPE_DATASET, Parameter.TYPE_VECTOR)
          .contains(parameter.getType()))
        return "Object, dataset and vector parameters do not support scheduling";
      if (!List.of(
              Parameter.TYPE_STRING,
              Parameter.TYPE_NUMBER,
              Parameter.TYPE_TIME,
              Parameter.TYPE_STRING_ARRAY,
              Parameter.TYPE_NUMBER_ARRAY,
              Parameter.TYPE_TIME_ARRAY)
          .contains(parameter.getType())) return "Unsupported parameter type";
    }
    return null;
  }

  public static JSONObject values(
      Function function,
      com.fasterxml.jackson.databind.JsonNode content,
      String zone,
      Instant executionAt) {
    var result = new JSONObject();
    for (var parameter : function.getParameters()) {
      String key = "parameter:" + parameter.getName();
      String text = content.path(key).asText();
      try {
        result.put(
            parameter.getName(), value(parameter.getType(), text, ZoneId.of(zone), executionAt));
      } catch (RuntimeException error) {
        String code =
            parameter.getType().contains("TIME")
                ? "invalid_time"
                : parameter.getType().contains("NUMBER") ? "invalid_number" : "invalid_array";
        var field =
            io.ontomato.dataengine.schedules.ScheduleForms.error(
                "/content/" + io.ontomato.dataengine.schedules.ScheduleJson.pointer(key),
                code,
                "Invalid value for " + parameter.getName());
        throw new ScheduleException(
            422,
            "FIELD_VALIDATION_FAILED",
            "Check the parameter values",
            Map.of("fields", List.of(field)));
      }
    }
    return result;
  }

  private static Object value(String type, String text, ZoneId zone, Instant now) {
    return switch (type) {
      case Parameter.TYPE_STRING -> {
        if (text.isBlank()) throw new IllegalArgumentException();
        yield text;
      }
      case Parameter.TYPE_NUMBER -> number(text.trim());
      case Parameter.TYPE_TIME ->
          text.isBlank() ? now.toString() : time(text.trim(), zone).toString();
      case Parameter.TYPE_STRING_ARRAY, Parameter.TYPE_NUMBER_ARRAY, Parameter.TYPE_TIME_ARRAY -> {
        var lines = text.lines().map(String::trim).filter(line -> !line.isEmpty()).toList();
        if (lines.isEmpty()) throw new IllegalArgumentException();
        yield lines.stream()
            .map(
                line ->
                    switch (type) {
                      case Parameter.TYPE_NUMBER_ARRAY -> number(line);
                      case Parameter.TYPE_TIME_ARRAY -> time(line, zone).toString();
                      default -> line;
                    })
            .toList();
      }
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
              DateTimeFormatter.ofPattern("uuuu-MM-dd HH:mm")
                  .withResolverStyle(ResolverStyle.STRICT))
          .atZone(zone)
          .toInstant();
    return OffsetDateTime.parse(text, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant();
  }
}
