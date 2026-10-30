package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import java.util.*;
import org.springframework.stereotype.Service;

/** Formal execution and result authorization belong to the ontology, not the code runner. */
@Service
public class QueryOutputService {
  private final PythonExecuteService python;
  private final ABCProgramService programs;
  private final OntologyQueryService ontology;
  private final BusinessConfigService config;

  public QueryOutputService(PythonExecuteService python, ABCProgramService programs,
      OntologyQueryService ontology, BusinessConfigService config) {
    this.python = python; this.programs = programs; this.ontology = ontology; this.config = config;
  }

  public JSONObject execute(String id, JSONObject recipe, JSONObject analysis,
      QueryAccessService.Access access, String lang) throws Exception {
    return execute(id, recipe, analysis, access, lang, List.of());
  }

  @SuppressWarnings("unchecked")
  public JSONObject execute(String id, JSONObject recipe, JSONObject analysis,
      QueryAccessService.Access access, String lang, List<String> classNames) throws Exception {
    String kind = recipe.getString("kind");
    JSONArray rows;
    JSONArray legacySources = null;
    JSONObject truncation = null;
    if ("dsl".equals(kind)) {
      JSONObject declared = analysis;
      var result = JSONObject.from(ontology.execute(recipe.getJSONObject("dsl"), access));
      if (result.getJSONArray("data").size() != 1) throw new IllegalArgumentException("One output table is required");
      var datum = result.getJSONArray("data").getJSONObject(0);
      analysis = result.getJSONObject("sourceAnalysis");
      QuerySourceAnalysis.outputLabels(analysis, declared, lang);
      rows = datum.getJSONArray("answer");
      truncation = OntologyQueryService.partial(datum);
    } else {
      String code;
      JSONObject parameters = new JSONObject();
      if ("python".equals(kind)) code = recipe.getString("code");
      else if ("metric".equals(kind)) {
        var metric = ontology.metric(recipe.getString("metricId"), recipe.getString("revision"), access);
        var function = metric.getFunction();
        code = function.getCode();
        if (code == null || !code.contains("# ontomato-python:2")) throw new IllegalArgumentException("Saved program requires Python protocol 2");
        parameters = MetricViewBindings.resolve(metric, recipe.getString("bindingId"), recipe.getJSONObject("parameters"));
        recipe.put("parameters", parameters);
        var returns = function.getReturnDef();
        analysis = returns.getSourceAnalysis() != null ? returns.getSourceAnalysis() : QuerySourceAnalysis.fromStoredSources(returns.getOutKeyRefs());
        analysis = JSON.parseObject(JSON.toJSONString(analysis, JSONWriter.Feature.WriteMapNullValue));
        if (returns.getSourceAnalysis() == null) legacySources = JSONArray.from(returns.getOutKeyRefs());
        if (!parameters.isEmpty()) code = "# ontomato-python:2\nfrom pathlib import Path as _P\n_P('parameters.json').write_text("
            + JSON.toJSONString(JSON.toJSONString(parameters, JSONWriter.Feature.WriteMapNullValue))
            + ", encoding='utf-8')\nexec(compile(" + JSON.toJSONString(code) + ", 'published_function.py', 'exec'))\n";
        recipe.put("executedCode", code);
      } else throw new IllegalArgumentException("Unknown output recipe");
      if (code == null || !code.contains("# ontomato-python:2") || analysis == null)
        throw new IllegalArgumentException("Python protocol 2 and sourceAnalysis are required");
      recipe.put("sha256", hash(code));
      var definitions = (List<Map<String, Object>>) ontology.rule(access).get("classDef");
      QueryPermissions.authorizeInputs(analysis, access.permission(), definitions);
      List<String> requested = classNames;
      if (!access.classNames().isEmpty()) {
        if (requested == null || requested.isEmpty()) requested = access.classNames();
        else {
          requested = requested.stream().filter(access.classNames()::contains).toList();
          if (requested.isEmpty()) throw new IllegalArgumentException("No classes remain in the task scope");
        }
      }
      var scope = QueryAccessService.classScope(access.permission(), requested);
      var authority = PythonAuthority.read(access.user().getId(), access.user().getDomainId()).withClasses(scope).forExecution(id);
      if (access.grant() != null) authority = authority.withParent(new PythonAuthority.ParentGrant(
          access.credential(), access.grant().getString("runId"), access.grant().getLongValue("expiresAt")));
      int minutes = Math.max(1, (int) (config.get(access.user().getDomainId()).getDslCookerTimeout() / 60000));
      var result = python.execute(id, code, minutes, lang, authority, parameters, Map.of());
      rows = programs.parsePythonReturn(result.getResult(), result.getError());
      rows = QueryPermissions.mask(rows, analysis, access.permission());
      truncation = result.getPartialQuery();
    }
    var columns = analysis.getJSONArray("nodes").stream().map(JSONObject::from)
        .filter(node -> "output".equals(node.getString("kind"))).map(node ->
            JSONObject.of("key", node.getString("key"), "label", node.getString("label"), "type", null)).toList();
    var output = JSONObject.of("receiptId", id, "executedAt", java.time.Instant.now().toString(),
        "recipe", recipe, "columns", columns, "rows", rows, "truncation", truncation);
    // A legacy permission conversion is not a complete, declared display subgraph.
    if (legacySources == null) output.put("sourceAnalysis", analysis);
    else output.put("outKeyRefs", legacySources);
    return output;
  }

  public static String hash(String code) {
    try { return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
        .digest(code.getBytes(java.nio.charset.StandardCharsets.UTF_8))); }
    catch (Exception error) { throw new IllegalStateException(error); }
  }
}
