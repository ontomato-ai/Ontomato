package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.util.DslToPythonCodeUtil;
import java.util.*;
import org.springframework.stereotype.Service;

/** Final output interpretation remains in the ontology permission boundary. */
@Service
public class QueryOutputService {
  private final PythonExecuteService python;
  private final ABCProgramService programs;
  private final OntologyQueryService ontology;
  private final BusinessConfigService config;

  public QueryOutputService(
      PythonExecuteService python,
      ABCProgramService programs,
      OntologyQueryService ontology,
      BusinessConfigService config) {
    this.python = python;
    this.programs = programs;
    this.ontology = ontology;
    this.config = config;
  }

  public JSONObject execute(
      String id, JSONObject recipe, JSONArray sources, QueryAccessService.Access access, String lang)
      throws Exception {
    String kind = recipe.getString("kind"), code;
    JSONObject parameters = new JSONObject();
    if ("dsl".equals(kind)) code = DslToPythonCodeUtil.generate(recipe.getJSONObject("dsl"), "");
    else if ("python".equals(kind)) code = recipe.getString("code");
    else if ("metric".equals(kind)) {
      var metric =
          ontology.metric(recipe.getString("metricId"), recipe.getString("revision"), access);
      var function = metric.getFunction();
      code = function.getCode();
      JSONObject supplied = recipe.getJSONObject("parameters");
      if (function.getParameters() != null)
        for (Parameter parameter : function.getParameters()) {
          parameters.put(
              parameter.getName(),
              "STATIC".equals(metric.getType())
                  ? parameter.getValue()
                  : supplied.get(parameter.getName()));
        }
      sources = JSONArray.from(function.getReturnDef().getOutKeyRefs());
      if (code == null || !code.contains("# ontomato-python:2"))
        throw new IllegalArgumentException(
            "This saved Function uses the retired Python protocol. Convert or regenerate it before"
                + " execution (ontomato-python:2 required).");
      // Freeze the typed input for saved-program consumers without modifying the Function.
      if (!parameters.isEmpty())
        code =
            "# ontomato-python:2\n"
                + "from pathlib import Path as _OntomatoParameterPath\n"
                + "_OntomatoParameterPath('parameters.json').write_text("
                + JSON.toJSONString(
                    JSON.toJSONString(
                        parameters, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue))
                + ", encoding='utf-8')\nexec(compile("
                + JSON.toJSONString(code)
                + ", 'published_function.py', 'exec'))\n";

    } else throw new IllegalArgumentException("Unknown output recipe");
    if (code == null || code.isBlank() || sources == null)
      throw new IllegalArgumentException("Code and output field sources are required");
    if (!"python".equals(kind)) recipe.put("executedCode", code);
    recipe.put("sha256", hash(code));
    List<ABCHarnessProgramOutKeyRef> refs = sources.toJavaList(ABCHarnessProgramOutKeyRef.class);
    Set<String> keys = new HashSet<>();
    JSONArray classes = JSONArray.from(ontology.rule(access).get("classDef"));
    for (var ref : refs) {
      if (ref.getKey() == null
          || !keys.add(ref.getKey())
          || ref.getAsGroupBy() == null
          || ref.getStatCal() == null)
        throw new IllegalArgumentException("Invalid or duplicate output source");
      JSONObject clazz =
          classes.stream()
              .map(JSONObject::from)
              .filter(c -> Objects.equals(c.getString("className"), ref.getClassName()))
              .findFirst()
              .orElseThrow(
                  () ->
                      new IllegalArgumentException("Unknown source class: " + ref.getClassName()));
      if (clazz.getJSONArray("attrs").stream()
          .map(JSONObject::from)
          .noneMatch(
              a ->
                  Objects.equals(a.getString("name"), ref.getAttrName())
                      && !Boolean.FALSE.equals(a.getBoolean("enable"))))
        throw new IllegalArgumentException("Unknown source attribute: " + ref.getAttrName());
    }
    boolean exploring =
        access.grant() != null
            && "retrieval-exploration".equals(access.grant().getString("purpose"));
    PythonAuthority authority =
        exploring
            ? PythonAuthority.exploration(access.user().getDomainId())
                .withClasses(access.grant().getList("classNames", String.class))
            : PythonAuthority.read(access.user().getId(), access.user().getDomainId());
    authority = authority.forExecution(id);
    if (exploring)
      authority =
          authority.withParent(
              new PythonAuthority.ParentGrant(
                  access.credential(),
                  access.grant().getString("runId"),
                  access.grant().getLongValue("expiresAt")));
    int minutes =
        Math.max(1, (int) (config.get(access.user().getDomainId()).getDslCookerTimeout() / 60000));
    var result = python.execute(id, code, minutes, lang, authority, parameters, Map.of());
    var permission = access.permission();
    if (exploring) {
      permission = new io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission();
      permission.setFullData(true);
    }
    JSONArray rows =
        programs.dealPythonReturn(result.getResult(), result.getError(), refs, permission);
    List<JSONObject> columns =
        refs.stream()
            .map(
                ref -> {
                  JSONObject col = JSONObject.of("key", ref.getKey(), "label", ref.getKey());
                  col.put("type", null);
                  return col;
                })
            .toList();
    JSONObject output =
        JSONObject.of(
            "receiptId",
            id,
            "executedAt",
            java.time.Instant.now().toString(),
            "recipe",
            recipe,
            "outKeyRefs",
            refs,
            "columns",
            columns,
            "rows",
            rows);
    output.put("truncation", result.getPartialQuery());
    return output;
  }

  public static String hash(String code) {
    try {
      return java.util.HexFormat.of()
          .formatHex(
              java.security.MessageDigest.getInstance("SHA-256")
                  .digest(code.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
