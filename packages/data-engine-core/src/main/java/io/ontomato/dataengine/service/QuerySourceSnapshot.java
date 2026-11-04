package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.function.Parameter;
import java.util.List;

/** Normalize stored source formats only at the dataset and saved-program read boundaries. */
public final class QuerySourceSnapshot {
  private QuerySourceSnapshot() {}

  public static JSONObject legacy(String code, List<Parameter> definitions) {
    if (code == null || code.isBlank()) throw new IllegalArgumentException("Stored query source is missing");
    return JSONObject.of("manifest", JSONObject.of("schema", "ontomato.query-source.legacy",
        "entry", JSONObject.of("kind", "python", "path", "legacy.py"),
        "queries", new JSONObject(), "modules", new JSONArray(),
        "parameterDefs", JSON.parseArray(JSON.toJSONString(definitions == null ? List.of() : definitions, JSONWriter.Feature.WriteMapNullValue)),
        "parameterBindings", new JSONArray()),
        "files", JSONArray.of(JSONObject.of("path", "legacy.py", "content", code)));
  }

  public static JSONObject fromProgram(ABCHarnessProgram program) {
    return program.getQueryPackage() != null ? QueryPackage.copy(program.getQueryPackage())
        : legacy(program.getCode(), List.of());
  }

  public static JSONObject fromDataset(JSONObject dataset) {
    var recipe = dataset.getJSONObject("recipe");
    JSONObject source;
    if ("workbench.dataset.v1".equals(dataset.getString("schema"))) {
      source = readV1(recipe);
    } else {
      source = recipe.getJSONObject("package");
      if (source == null) source = recipe.getJSONObject("legacySource");
      if (source == null) throw new IllegalArgumentException("Dataset has no frozen query source");
    }
    return JSONObject.of("question", dataset.getString("question"),
        "queryPackage", QueryPackage.copy(source),
        "parameterValues", recipe.getJSONObject("parameters") == null ? new JSONObject() : QueryPackage.copy(recipe.getJSONObject("parameters")),
        "sourceAnalysis", dataset.get("sourceAnalysis"));
  }

  private static JSONObject readV1(JSONObject recipe) {
    return switch (recipe.getString("kind")) {
      case "dsl" -> QueryPackage.fromDsl(recipe.getJSONObject("dsl").toJSONString());
      case "python" -> legacy(recipe.getString("code"), List.of());
      case "metric" -> legacy(recipe.getString("executedCode"), List.of());
      default -> throw new IllegalArgumentException("Unknown historical recipe");
    };
  }

  public static JSONObject input(ABCHarnessProgram program) {
    if (program.getQueryPackage() == null) throw new IllegalArgumentException("Complete query source is required");
    return JSONObject.of("package", QueryPackage.copy(program.getQueryPackage()),
        "parameters", program.getParameterValues() == null ? new JSONObject() : QueryPackage.copy(program.getParameterValues()));
  }
}
