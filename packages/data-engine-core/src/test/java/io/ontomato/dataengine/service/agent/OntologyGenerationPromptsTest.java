package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import java.util.Map;
import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.QuerySourceSnapshot;
import io.ontomato.dataengine.util.DslRuleUtil;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import org.junit.jupiter.api.Test;

/** The checker compares against the user's own words, not the rewritten retrieval question. */
class OntologyGenerationPromptsTest {
  @Test
  void describerReceivesAllBlindFilesAndCandidateReceivesAllOriginalFiles() throws Exception {
    JSONObject bundle;
    try (var in = getClass().getResourceAsStream("/ontology-contracts/examples/query-packages.json")) {
      bundle = JSON.parseObject(in.readAllBytes()).getJSONObject("pythonAggregate");
    }
    bundle.getJSONObject("manifest").getJSONArray("modules").add("helper.py");
    bundle.getJSONArray("files").add(JSONObject.of("path", "helper.py", "content", "# AUTHOR_HINT\nhelper_value = 7\n"));
    var dslFile = bundle.getJSONArray("files").getJSONObject(0);
    var dsl = JSON.parseObject(dslFile.getString("content")); dsl.put("problem", "AUTHOR_HINT");
    dslFile.put("content", dsl.toJSONString());
    var program = new ABCHarnessProgram(); program.setQueryPackage(bundle); program.setQuestion("USER_WORDS");
    program.setParameterValues(JSONObject.of("threshold", 25));
    var lang = mock(LangService.class); when(lang.get(anyString(), anyString())).thenReturn("English");
    Map<String, Object> rule = Map.of("datasetdesc", "Dataset", "classDef", List.of(), "relationship_rule", Map.of());
    try (var syntax = mockStatic(DslRuleUtil.class)) {
      syntax.when(() -> DslRuleUtil.generateWholeDslRule(any())).thenReturn("DSL syntax");
      String blind = OntologyGenerationPrompts.getABCProgramDescriberUserMessage(program, "en", lang, List.of(), rule);
      assertTrue(blind.contains("helper.py")); assertTrue(blind.contains("helper_value = 7"));
      assertTrue(blind.contains("queries/employees.json")); assertTrue(blind.contains("calculate.py"));
      assertFalse(blind.contains("AUTHOR_HINT")); assertFalse(blind.contains("USER_WORDS"));
      String candidate = OntologyGenerationPrompts.getReadFunctionMakerUserMessage("USER_WORDS", QuerySourceSnapshot.input(program), "en", lang, rule);
      assertTrue(candidate.contains("AUTHOR_HINT")); assertTrue(candidate.contains("helper_value = 7"));
      assertTrue(candidate.contains("queries/employees.json")); assertTrue(candidate.contains("calculate.py"));
      assertFalse(candidate.contains("{{QUERY_LOGIC}}"));
    }
  }

  @Test
  void usesUserQuotesAndConfirmedDecisionsInsteadOfTheRewrittenQuestion() {
    String question =
        OntologyGenerationPrompts.userQuestion(
            "How many active employees?",
            List.of("How many staff do we have?", "Only active ones, aged 20 to 30."),
            List.of("Active means currently employed."));

    assertTrue(question.contains("How many staff do we have?"));
    assertTrue(question.contains("Only active ones, aged 20 to 30."));
    assertTrue(question.contains("Active means currently employed."));
    assertFalse(question.contains("How many active employees?"));
  }

  @Test
  void fallsBackToTheRetrievalQuestionWhenThereAreNoQuotes() {
    String question =
        OntologyGenerationPrompts.userQuestion(
            "How many active employees?", List.of(), List.of("Active means currently employed."));

    assertTrue(question.contains("How many active employees?"));
    assertTrue(question.contains("Active means currently employed."));
  }

  @Test
  void blankQuotesAlsoFallBackToTheRetrievalQuestion() {
    String question =
        OntologyGenerationPrompts.userQuestion(
            "How many active employees?", List.of("  "), null);

    assertEquals("How many active employees?", question);
  }
}
