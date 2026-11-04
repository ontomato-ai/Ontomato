package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import org.junit.jupiter.api.Test;

/** Blind projection changes only the review input; candidates keep the exact frozen sources. */
class QueryBlindViewTest {
  private JSONObject bundle() throws Exception {
    try (var input = getClass().getResourceAsStream("/ontology-contracts/examples/query-packages.json")) {
      var bundle = JSON.parseObject(input.readAllBytes()).getJSONObject("pythonAggregate");
      var manifest = bundle.getJSONObject("manifest");
      manifest.getJSONArray("modules").add("helper.py");
      manifest.getJSONArray("parameterDefs").getJSONObject(0).put("description", "AUTHOR_HINT");
      manifest.getJSONObject("computation").getJSONArray("operations").getJSONObject(0).put("expression", "AUTHOR_HINT");
      var queryFile = bundle.getJSONArray("files").getJSONObject(0);
      var dsl = JSON.parseObject(queryFile.getString("content"));
      dsl.put("problem", "AUTHOR_HINT");
      queryFile.put("content", dsl.toJSONString());
      bundle.getJSONArray("files").getJSONObject(1).put("content",
          "# AUTHOR_HINT\nfrom helper import compute\nage_20_30_active_cnt = compute()  # AUTHOR_HINT\nprint(age_20_30_active_cnt)\n");
      bundle.getJSONArray("files").add(JSONObject.of("path", "helper.py", "content",
          "def compute():\n    \"\"\"AUTHOR_HINT\"\"\"\n    return {'stable_output': '在职 # literal'} # AUTHOR_HINT\n"));
      return bundle;
    }
  }

  @Test
  void blindViewContainsEveryDeclaredFileAndKeepsIdentifiersAndBusinessLiterals() throws Exception {
    var original = bundle();
    var program = new ABCHarnessProgram();
    program.setQuestion("USER_WORDS"); program.setQueryPackage(original);
    program.setParameterValues(JSONObject.of("threshold", 25));
    program.setSourceAnalysis(JSONObject.of("title", "AUTHOR_HINT"));
    var view = QueryBlindView.of(program);
    String text = view.toJSONString();
    assertFalse(text.contains("AUTHOR_HINT"));
    assertFalse(text.contains("USER_WORDS"));
    assertTrue(text.contains("age_20_30_active_cnt"));
    assertTrue(text.contains("stable_output"));
    assertTrue(text.contains("在职 # literal"));
    assertEquals(3, view.getJSONObject("package").getJSONArray("files").size());
    assertEquals(25, view.getJSONObject("parameters").getIntValue("threshold"));
    assertEquals("helper.py", view.getJSONObject("package").getJSONObject("manifest").getJSONArray("modules").getString(0));
    assertTrue(QuerySourceSnapshot.input(program).toJSONString().contains("AUTHOR_HINT"));
    assertEquals(original, program.getQueryPackage());
  }

  @Test
  void pythonRulesPreserveStringsAndRemoveCommentsWithoutAnAcceptabilityDecision() {
    String source = "# author note\n\"\"\"module explanation\"\"\"\n"
        + "u'prefixed explanation'\n"
        + "name = '# keep' # remove me\n"
        + "text = \"\"\"value\n# still a literal\"\"\"\n"
        + "values = [\n  'key # retained',\n]\n"
        + "def f():\n    'function explanation'\n    return \"escaped \\\" # retained\" # remove me\n";
    String projected = QueryBlindView.python(source);
    assertFalse(projected.contains("author note"));
    assertFalse(projected.contains("module explanation"));
    assertFalse(projected.contains("prefixed explanation"));
    assertFalse(projected.contains("function explanation"));
    assertFalse(projected.contains("remove me"));
    assertTrue(projected.contains("'# keep'"));
    assertTrue(projected.contains("# still a literal"));
    assertTrue(projected.contains("'key # retained'"));
    assertTrue(projected.contains("# retained"));
    assertDoesNotThrow(() -> QueryBlindView.python("value = 'unfinished # literal"));
  }

  @Test
  void historicalSourcesAreAdaptedAtReadTimeWithoutGeneratingPythonForDsl() {
    var dsl = JSONObject.of("problem", "AUTHOR_HINT", "answer", JSONObject.of("steps", new JSONArray()));
    var dataset = JSONObject.of("schema", "workbench.dataset.v1", "question", "USER_WORDS",
        "recipe", JSONObject.of("kind", "dsl", "dsl", dsl));
    var normalized = QuerySourceSnapshot.fromDataset(dataset).to(ABCHarnessProgram.class);
    assertEquals("dsl", normalized.getQueryPackage().getJSONObject("manifest").getJSONObject("entry").getString("kind"));
    assertNull(normalized.getCode());
    assertFalse(QueryBlindView.of(normalized).toJSONString().contains("AUTHOR_HINT"));
    var oldRecipe = JSONObject.of("kind", "metric", "executedCode", "# old\nprint('old source')\n", "parameters", JSONObject.of("limit", 4));
    dataset.put("recipe", oldRecipe);
    normalized = QuerySourceSnapshot.fromDataset(dataset).to(ABCHarnessProgram.class);
    assertEquals("ontomato.query-source.legacy", normalized.getQueryPackage().getJSONObject("manifest").getString("schema"));
    assertEquals(oldRecipe.getString("executedCode"), normalized.getQueryPackage().getJSONArray("files").getJSONObject(0).getString("content"));
    assertEquals(4, normalized.getParameterValues().getIntValue("limit"));
    dataset.put("schema", "workbench.dataset.v2");
    assertThrows(IllegalArgumentException.class, () -> QuerySourceSnapshot.fromDataset(dataset));
  }
}
