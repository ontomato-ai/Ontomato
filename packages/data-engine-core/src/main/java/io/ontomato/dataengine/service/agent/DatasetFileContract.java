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
        "selfCheck");
    nonempty(body, "title");
    nonempty(body, "question");
    if (body.containsKey("sourceAnalysis")) throw AgentHttpException.invalid("sourceAnalysis is derived from the query package");
    JSONObject recipe = object(body, "recipe");
    at("recipe", () -> {
      AgentJson.fields(recipe, "kind", "package", "parameters", "columnLabels");
      if (!"package".equals(nonempty(recipe, "kind")))
        throw AgentHttpException.invalid("The retriever submits query packages; metric deliveries take their own entrance");
      recipe.put("package", io.ontomato.dataengine.service.QueryPackage.accept(object(recipe, "package")));
      object(recipe, "parameters");
      var labels = object(recipe, "columnLabels");
      for (String key : labels.keySet()) nonempty(labels, key);
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
    var check = object(body, "selfCheck");
    at("selfCheck", () -> {
    AgentJson.fields(check, "scope", "filters", "grain", "denominator", "nullGroups");
    for (String key : List.of("scope", "filters", "grain", "denominator", "nullGroups"))
      string(check, key, false);
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

}
