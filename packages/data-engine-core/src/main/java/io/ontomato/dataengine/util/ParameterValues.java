package io.ontomato.dataengine.util;

import io.ontomato.dataengine.bean.function.Parameter;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/** Normalize model-authored defaults by their declared type at the input boundary. */
public final class ParameterValues {
  private ParameterValues() {}

  public static Object normalize(String type, Object value) {
    if (type == null || value == null) return value;
    return switch (type) {
      case Parameter.TYPE_NUMBER -> number(value);
      case Parameter.TYPE_NUMBER_ARRAY -> numbers(value);
      default -> value;
    };
  }

  private static Object number(Object value) {
    if (value instanceof Number) return value;
    if (!(value instanceof String text) || text.isBlank()) return value;
    try { return new BigDecimal(text.trim()); }
    catch (NumberFormatException invalid) { return value; }
  }

  private static Object numbers(Object value) {
    if (!(value instanceof List<?> list)) return value;
    var result = new ArrayList<Object>(list.size());
    for (Object element : list) {
      Object normalized = number(element);
      if (!(normalized instanceof Number)) return value;
      result.add(normalized);
    }
    return result;
  }
}
