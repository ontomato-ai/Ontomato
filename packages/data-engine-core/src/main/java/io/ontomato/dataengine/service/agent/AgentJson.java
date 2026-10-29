package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.QueryOutputService;
import java.math.BigDecimal;
import java.util.*;

/** Deterministic fingerprints for ontology-owned admission and dataset receipts. */
public final class AgentJson {
  private AgentJson() {}

  public static String json(Object value) {
    return JSON.toJSONString(value, JSONWriter.Feature.WriteMapNullValue);
  }

  public static String hash(Object value) {
    return QueryOutputService.hash(canonical(value));
  }

  public static String canonical(Object value) {
    if (value instanceof Map<?, ?> map) {
      var keys = map.keySet().stream().map(Object::toString).sorted().toList();
      return "{"
          + String.join(",", keys.stream().map(k -> json(k) + ":" + canonical(map.get(k))).toList())
          + "}";
    }
    if (value instanceof Collection<?> values)
      return "[" + String.join(",", values.stream().map(AgentJson::canonical).toList()) + "]";
    if (value instanceof Number number)
      return new BigDecimal(number.toString()).stripTrailingZeros().toPlainString();
    return json(value);
  }

  public static String id(String value) {
    try {
      return UUID.fromString(value).toString();
    } catch (RuntimeException e) {
      throw AgentHttpException.invalid("A UUID is required");
    }
  }

  public static String text(JSONObject input, String name) {
    if (!(input.get(name) instanceof String s) || s.isBlank())
      throw AgentHttpException.invalid(name + " is required");
    return s;
  }

  public static void fields(JSONObject input, String... names) {
    if (!Set.of(names).containsAll(input.keySet()))
      throw AgentHttpException.invalid("Unsupported request fields");
  }

  public static JSONObject copy(JSONObject value) {
    return JSON.parseObject(json(value), JSONReader.Feature.DisableReferenceDetect);
  }
}
