package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramDescription;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.dao.*;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.util.*;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public class OntologyGenerationPrompts {

  public static final String LANG = "{{LANG}}";

  public static final String DATASET_DESC = "{{DATASET_DESC}}";
  public static final String CLASS_DEF = "{{CLASS_DEF}}";
  public static final String BUSSINESS_KNOWLEDGE = "{{BUSSINESS_KNOWLEDGE}}";

  public static final String DSL_RULE = "{{DSL_RULE}}";
  public static final String USER_QUESTION = "{{USER_QUESTION}}";

  public static final String REPORT_CARD_PROGRAMMER_SERVER_PORT = "{{SERVER_PORT}}";

  public static final String ABC_PROGRAM_DESCRIBER_PROMPT = "abc_program_describer.md";
  public static final String QUERY_LOGIC = "{{QUERY_LOGIC}}";

  public static final String QUESTION_CHECKER_V2_PROMPT = "question_checker-v2.md";
  public static final String PROGRAM_DESCRIPTIONS = "{{PROGRAM_DESCRIPTIONS}}";


  public static final String METRIC_VIEW_MAKER_PROMPT = "metric_view_maker.md";

  public static final String ACTION_MAKER_PROMPT = "action_maker.md";
  public static final String STRUCTURED_SPEC = "{{STRUCTURED_SPEC}}";

  public static final String ACTION_CODE_EXPLAINER_PROMPT = "action_code_explainer.md";
  public static final String PARAMETERS = "{{PARAMETERS}}";

  public static String getABCProgramDescriberUserMessage(
      ABCHarnessProgram program,
      String lang,
      LangService langService,
      List<String> classNames,
      Map<String, Object> jsonRule) {
    String prompt = template(ABC_PROGRAM_DESCRIBER_PROMPT, lang);

    Map<String, String> mapDBSchema = DBSchemaUtil.getDBSchema(jsonRule, classNames);
    // dataset description
    String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
    prompt = prompt.replace(DATASET_DESC, datasetDesc);

    // class definition description
    String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, classNames);
    prompt = prompt.replace(CLASS_DEF, classDef);

    // DSL syntax
    String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
    prompt = prompt.replace(DSL_RULE, dslRule);

    // Only the independent describer receives the rule-based blind projection.
    prompt = prompt.replace(QUERY_LOGIC, JSON.toJSONString(
        io.ontomato.dataengine.service.QueryBlindView.of(program), Feature.PrettyFormat, Feature.WriteMapNullValue));

    // language
    String langValue = langService.get(lang, "lang");
    prompt = prompt.replace(LANG, langValue);

    return prompt;
  }

  public static String getQuestionCheckerV2UserMessage(
      String sessionId,
      String question,
      List<ABCHarnessProgramDescription> programDescriptions,
      List<String> userQuotes,
      List<String> confirmedDecisions,
      KnowledgeDao knowledgeDao,
      BusinessConfigService businessConfigService,
      String lang,
      LangService langService,
      String domainId) {
    String prompt = template(QUESTION_CHECKER_V2_PROMPT, lang);

    // overall query logic
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < programDescriptions.size(); i++) {
      ABCHarnessProgramDescription programDescription = programDescriptions.get(i);
      sb.append("- Sub-program logic " + (i + 1) + ":\n");
      sb.append("```\n");
      sb.append(programDescription.getMeaning() + "\n");
      sb.append("```\n\n");
    }
    prompt = prompt.replace(PROGRAM_DESCRIPTIONS, sb.toString());

    // business knowledge
    String bussinessKnowledge =
        BussinessKnowledgeUtil.getBussinessKnowledge(
            knowledgeDao,
            question,
            businessConfigService.get(domainId).getKnowledgeMaxResult(),
            domainId);
    prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);

    // The user's own messages and confirmed clarifications are the question to check.
    prompt = prompt.replace(USER_QUESTION, userQuestion(question, userQuotes, confirmedDecisions));

    // language
    String langValue = langService.get(lang, "lang");
    prompt = prompt.replace(LANG, langValue);

    return prompt;
  }

  public static String getMetricViewMakerUserMessage(
      String question,
      String serverPort,
      KnowledgeDao knowledgeDao,
      BusinessConfigService businessConfigService,
      String lang,
      LangService langService,
      Map<String, Object> jsonRule,
      String domainId) {
    String prompt = template(METRIC_VIEW_MAKER_PROMPT, lang);

    Map<String, String> mapDBSchema = DBSchemaUtil.getDBSchema(jsonRule, null);
    // dataset description
    String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
    prompt = prompt.replace(DATASET_DESC, datasetDesc);

    // class definition description
    String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
    prompt = prompt.replace(CLASS_DEF, classDef);

    // DSL syntax
    String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
    prompt = prompt.replace(DSL_RULE, dslRule);

    // user requirement
    prompt = prompt.replace(USER_QUESTION, question);

    // business knowledge
    String bussinessKnowledge =
        BussinessKnowledgeUtil.getBussinessKnowledge(
            knowledgeDao,
            question,
            businessConfigService.get(domainId).getKnowledgeMaxResult(),
            domainId);
    prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);

    // service port
    prompt = prompt.replace(REPORT_CARD_PROGRAMMER_SERVER_PORT, serverPort);

    // language
    String langValue = langService.get(lang, "lang");
    prompt = prompt.replace(LANG, langValue);

    return prompt;
  }

  public static String getActionMakerUserMessage(
      String question,
      String serverPort,
      KnowledgeDao knowledgeDao,
      BusinessConfigService businessConfigService,
      String lang,
      LangService langService,
      Map<String, Object> jsonRule,
      String domainId) {
    return getActionMakerUserMessage(
        question, serverPort, knowledgeDao, businessConfigService, lang, langService, jsonRule,
        domainId, null);
  }

  public static String getActionMakerUserMessage(
      String question,
      String serverPort,
      KnowledgeDao knowledgeDao,
      BusinessConfigService businessConfigService,
      String lang,
      LangService langService,
      Map<String, Object> jsonRule,
      String domainId,
      JSONObject structuredSpec) {
    String prompt = template(ACTION_MAKER_PROMPT, lang);

    Map<String, String> mapDBSchema = DBSchemaUtil.getDBSchema(jsonRule, null);
    // dataset description
    String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
    prompt = prompt.replace(DATASET_DESC, datasetDesc);

    // class definition description
    String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
    prompt = prompt.replace(CLASS_DEF, classDef);

    // DSL syntax
    String dslRule = DslRuleUtil.generateWholeDslRule(jsonRule);
    prompt = prompt.replace(DSL_RULE, dslRule);

    // user requirement
    prompt = prompt.replace(USER_QUESTION, question);

    // Structured intent from the creation wizard; authoritative when present.
    String structured =
        structuredSpec == null || structuredSpec.isEmpty()
            ? "Not provided. Derive the action from the user requirement and business knowledge."
            : JSON.toJSONString(structuredSpec, JSONWriter.Feature.PrettyFormat);
    prompt = prompt.replace(STRUCTURED_SPEC, structured);

    // business knowledge
    String bussinessKnowledge =
        BussinessKnowledgeUtil.getBussinessKnowledge(
            knowledgeDao,
            question,
            businessConfigService.get(domainId).getKnowledgeMaxResult(),
            domainId);
    prompt = prompt.replace(BUSSINESS_KNOWLEDGE, bussinessKnowledge);

    // service port
    prompt = prompt.replace(REPORT_CARD_PROGRAMMER_SERVER_PORT, serverPort);

    // language
    String langValue = langService.get(lang, "lang");
    prompt = prompt.replace(LANG, langValue);

    return prompt;
  }

  public static String getActionCodeExplainerUserMessage(
      List<Parameter> parameters,
      Map<String, Object> jsonRule,
      String lang,
      LangService langService) {
    String prompt = template(ACTION_CODE_EXPLAINER_PROMPT, lang);

    // dataset description
    Map<String, String> mapDBSchema = DBSchemaUtil.getDBSchema(jsonRule, null);
    String datasetDesc = mapDBSchema.get(DBSchemaUtil.KEY_DATASET_DESC);
    prompt = prompt.replace(DATASET_DESC, datasetDesc);

    // object class list
    String classDef = DBSchemaUtil.generateClassNameMarkDown(jsonRule, null);
    prompt = prompt.replace(CLASS_DEF, classDef);

    // parameter definition
    JSONArray paramsJson = new JSONArray();
    if (parameters != null) {
      for (Parameter parameter : parameters) {
        JSONObject p = new JSONObject();
        p.put("name", parameter.getName());
        p.put("type", parameter.getType());
        p.put("description", parameter.getDescription());
        p.put("sample", parameter.getSample());
        p.put("classNames", parameter.getClassNames());
        paramsJson.add(p);
      }
    }
    prompt =
        prompt.replace(
            PARAMETERS,
            JSON.toJSONString(
                paramsJson, Feature.WriteMapNullValue, JSONWriter.Feature.PrettyFormat));

    // language
    String langValue = langService.get(lang, "lang");
    prompt = prompt.replace(LANG, langValue);

    return prompt;
  }

  /** The checker compares against the user's words; the rewritten question is only a fallback. */
  static String userQuestion(
      String question, List<String> userQuotes, List<String> confirmedDecisions) {
    StringBuilder sb = new StringBuilder();
    List<String> quotes =
        userQuotes == null
            ? List.of()
            : userQuotes.stream().filter(text -> text != null && !text.isBlank()).toList();
    if (quotes.isEmpty()) sb.append(question);
    else {
      sb.append("The user's actual messages in this conversation (oldest first):\n");
      for (int i = 0; i < quotes.size(); i++)
        sb.append(i + 1).append(". ").append(quotes.get(i)).append("\n");
    }
    List<String> decisions =
        confirmedDecisions == null
            ? List.of()
            : confirmedDecisions.stream()
                .filter(text -> text != null && !text.isBlank())
                .toList();
    if (!decisions.isEmpty()) {
      sb.append("\nConfirmed clarifications from the user:\n");
      for (String decision : decisions) sb.append("- ").append(decision).append("\n");
    }
    return sb.toString();
  }

  private static String template(String name, String language) {
    String locale = language != null && language.startsWith("zh") ? "zh" : "en";
    String path = "/ontology-prompts/" + locale + "/generation/" + name;
    if (OntologyGenerationPrompts.class.getResource(path) == null)
      path = "/ontology-prompts/en/generation/" + name;
    try (var input = OntologyGenerationPrompts.class.getResourceAsStream(path)) {
      if (input == null) throw new IllegalStateException("Missing generation prompt: " + name);
      return new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
    } catch (java.io.IOException error) {
      throw new IllegalStateException(error);
    }
  }
}
