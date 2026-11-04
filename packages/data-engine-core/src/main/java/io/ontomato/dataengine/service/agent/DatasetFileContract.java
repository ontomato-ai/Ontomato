package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import java.util.*;

/** Java boundary for packages/contracts/src/data-retrieval.ts; business sources stay Java-owned. */
final class DatasetFileContract {
  private DatasetFileContract() {}

  static void preparation(JSONObject body) {
    AgentJson.fields(
        body,
        "recipe",
        "sourceAnalysis",
        "title",
        "question",
        "assumptions",
        "decisionIds",
        "metricUses",
        "selfCheck");
    nonempty(body, "title");
    nonempty(body, "question");
    if (body.containsKey("sourceAnalysis")) throw AgentHttpException.invalid("sourceAnalysis is derived from the query package");
    JSONObject recipe = object(body, "recipe");
    at("recipe", () -> {
    switch (nonempty(recipe, "kind")) {
      case "package" -> {
        AgentJson.fields(recipe, "kind", "package", "parameters", "columnLabels");
        recipe.put("package", io.ontomato.dataengine.service.QueryPackage.accept(object(recipe, "package")));
        object(recipe, "parameters");
        var labels = object(recipe, "columnLabels");
        for (String key : labels.keySet()) nonempty(labels, key);
      }
      case "metric" -> {
        AgentJson.fields(
            recipe, "kind", "metricId", "revision", "parameters", "bindingId");
        string(recipe, "metricId", false);
        optionalText(recipe, "bindingId");
        string(recipe, "revision", false);
        object(recipe, "parameters");
      }
      default -> throw AgentHttpException.invalid("kind must be package or metric");
    }
    });
    var assumptions = array(body, "assumptions");
    for (int i = 0; i < assumptions.size(); i++)
      if (!(assumptions.get(i) instanceof String)) throw AgentHttpException.invalid("assumptions[" + i + "] must be text");
    var decisions = array(body, "decisionIds");
    for (int i = 0; i < decisions.size(); i++) {
      Object value = decisions.get(i);
      at("decisionIds[" + i + "]", () -> {
        if (!(value instanceof String id)) throw AgentHttpException.invalid("must be a UUID string");
        else AgentJson.id(id);
      });
    }
    var uses = array(body, "metricUses");
    for (int i = 0; i < uses.size(); i++) {
      Object value = uses.get(i);
      at("metricUses[" + i + "]", () -> {
      var use = element(value);
      AgentJson.fields(use, "id", "revision", "use", "reason");
      string(use, "id", false);
      string(use, "revision", false);
      nonempty(use, "reason");
      if (!List.of("direct", "derived", "not_used").contains(use.getString("use")))
        throw AgentHttpException.invalid("use must be direct, derived or not_used");
      });
    }
    var check = object(body, "selfCheck");
    at("selfCheck", () -> {
    AgentJson.fields(
        check, "scope", "filters", "grain", "denominator", "nullGroups", "comparisons");
    for (String key : List.of("scope", "filters", "grain", "denominator", "nullGroups"))
      string(check, key, false);
    var comparisons = array(check, "comparisons");
    for (int i = 0; i < comparisons.size(); i++) {
      Object value = comparisons.get(i);
      at("comparisons[" + i + "]", () -> {
      var comparison = element(value);
      AgentJson.fields(comparison, "metricId", "comparable", "explanation", "executionRef");
      string(comparison, "metricId", false);
      bool(comparison, "comparable");
      string(comparison, "explanation", false);
      string(comparison, "executionRef", true);
      });
    }
    });
  }

  private static void at(String path, Runnable validation) {
    try { validation.run(); }
    catch (AgentHttpException invalid) {
      if (invalid.status() != 400) throw invalid;
      throw AgentHttpException.invalid(path + ": " + invalid.getMessage());
    } catch (IllegalArgumentException invalid) {
      throw AgentHttpException.invalid(path + ": " + invalid.getMessage());
    }
  }

  private static String nonempty(JSONObject body,String key) {
    string(body,key,false);
    String value=body.getString(key);
    if(value.isEmpty()) throw AgentHttpException.invalid(key+" must not be empty");
    return value;
  }

  private static JSONObject element(Object value) {
    if (!(value instanceof Map<?, ?>)) throw AgentHttpException.invalid("Expected an object");
    return JSONObject.from(value);
  }

  private static JSONObject object(JSONObject body, String key) {
    if (!(body.get(key) instanceof Map<?, ?>))
      throw AgentHttpException.invalid(key + " must be an object");
    return body.getJSONObject(key);
  }

  private static List<?> array(JSONObject body, String key) {
    if (!(body.get(key) instanceof List<?> values))
      throw AgentHttpException.invalid(key + " must be an array");
    return values;
  }

  private static void string(JSONObject body, String key, boolean nullable) {
    if (!body.containsKey(key)
        || (!(body.get(key) instanceof String) && !(nullable && body.get(key) == null)))
      throw AgentHttpException.invalid(key + " must be text");
  }

  private static void optionalText(JSONObject body, String key) {
    if (body.containsKey(key)) string(body, key, false);
  }

  private static void bool(JSONObject body, String key) {
    if (!(body.get(key) instanceof Boolean))
      throw AgentHttpException.invalid(key + " must be a boolean");
  }
}
