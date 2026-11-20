package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.RuntimeCodeClient;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient.SkillVersion;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.stereotype.Service;

/** Ontology owns definitions and standard skill packages; runtime only executes them. */
@Service
public class OntologyAgentDefinitions {
  private final AgentRuntimeClient runtime;
  private final RuntimeCodeClient code;
  private final OntologyAgentModelSettings models;
  public static final Map<String, Object> DATASET_SKILL =
      Map.of(
          "namespace",
          Map.of("kind", "provider", "provider", "ontology"),
          "name",
          "data-retrieval");

  public OntologyAgentDefinitions(AgentRuntimeClient runtime, RuntimeCodeClient code, OntologyAgentModelSettings models) {
    this.runtime = runtime;
    this.code = code;
    this.models = models;
  }

  /** Applies the provider entry's reader to the prepared run. Auxiliary callers use the definitions directly. */
  public static JSONObject withVisibility(JSONObject prepared, AgentVisibilityPrompt.Reader reader) {
    if (reader != null) {
      var definition = prepared.getJSONObject("definition");
      definition.put("systemPrompt", definition.getString("systemPrompt") + "\n\n" + AgentVisibilityPrompt.forReader(reader));
    }
    return prepared;
  }

  public String resource(String path) {
    try (var in = getClass().getResourceAsStream("/" + path)) {
      if (in == null) throw new IllegalStateException("Missing ontology resource: " + path);
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (java.io.IOException e) {
      throw new IllegalStateException("Cannot read ontology resource", e);
    }
  }

  private String prompt(String language, String topic, String path) {
    String locale = language != null && language.startsWith("zh") ? "zh" : "en";
    String name = "ontology-prompts/" + locale + "/" + topic + "/" + path + ".md";
    if (getClass().getResource("/" + name) == null)
      name = "ontology-prompts/en/" + topic + "/" + path + ".md";
    return resource(name).trim();
  }

  private void sourceContract(List<Map<String, String>> files) throws Exception {
    files.add(Map.of("path", "references/query-package.md", "content", resource("ontology-contracts/query-package.md")));
    files.add(Map.of("path", "references/query-package.schema.json", "content", resource("ontology-contracts/query-package.schema.json")));
    files.add(Map.of("path", "references/query-subgraph.md", "content", resource("ontology-contracts/query-subgraph.md")));
    files.add(Map.of("path", "references/query-subgraphs.json", "content", resource("ontology-contracts/examples/query-subgraphs.json")));
    files.add(Map.of("path", "references/query-subgraph.schema.json", "content", resource("ontology-contracts/query-subgraph.schema.json")));
  }

  public List<SkillVersion> publish() throws Exception {
    var analyst = code.registerSkill();
    var files = new ArrayList<Map<String, String>>();
    for (String path : List.of("SKILL.md", "scripts/dataset.mjs", "scripts/query-package.mjs", "references/dataset.md"))
      files.add(
          Map.of("path", path, "content", resource("ontology-skills/data-retrieval/" + path)));
    sourceContract(files);
    var dataset = runtime.publishSkill("ontology-retrieval-skills", DATASET_SKILL, files);
    return List.of(analyst, dataset);
  }

  public static final Map<String, Object> GENERATION_SKILL =
      Map.of(
          "namespace",
          Map.of("kind", "provider", "provider", "ontology"),
          "name",
          "ontology-generation");

  public List<SkillVersion> publishGeneration() throws Exception {
    return publishGenerationSkills(GENERATION_SKILL);
  }

  public List<SkillVersion> publishActionCreation() throws Exception {
    return List.of(code.registerSkill(), publishGenerator(GENERATION_SKILL));
  }

  private List<SkillVersion> publishGenerationSkills(Map<String, Object> generator) throws Exception {
    var skills = new ArrayList<>(publish());
    skills.add(publishGenerator(generator));
    return skills;
  }

  private SkillVersion publishGenerator(Map<String, Object> skill) throws Exception {
    var files = new ArrayList<Map<String, String>>();
    for (String path : List.of("SKILL.md", "scripts/generation.mjs"))
      files.add(Map.of("path", path, "content", resource("ontology-skills/" + skill.get("name") + "/" + path)));
    sourceContract(files);
    return runtime.publishSkill("ontology-generation-skills", skill, files);
  }

  /**
   * Generation agents have no step limit of their own, so a model can spin on the same command; the runtime stops
   * such a run. The values are the ones the former host-side loop guard used.
   */
  static final Map<String, Object> TOOL_LOOP_POLICY = Map.of("maxCalls", 100, "maxSameShape", 12);

  public JSONObject generation(String domain, String kind, String prompt, String language, long remainingMs, List<SkillVersion> skills) {
    var definition = definition(domain, language, remainingMs, skills);
    definition.put("toolCallPolicy", TOOL_LOOP_POLICY);
    definition.put("agentId", OntologyGenerationService.agentId(kind));
    definition.put(
        "modelId", models.modelId(domain, OntologyGenerationService.agentId(kind)));
    definition.put(
        "systemPrompt",
        prompt
            + "\n\n"
            + resource("ontology-skills/ontology-generation/SKILL.md")
            + "\n\n"
            + JSON.parseObject(
                resource("ontology-contracts/agent-artifact-markdown-prompt.json"), String.class));
    return definition;
  }

  /** The MetricView generator is the retrieval companion agent; it owns its prompt and skill. */
  public static final String METRICVIEW_AGENT = "2b25aca0-869c-4644-8783-4a53894068bc";

  public static final Map<String, Object> METRICVIEW_SKILL =
      Map.of(
          "namespace",
          Map.of("kind", "provider", "provider", "ontology"),
          "name",
          "metricview-generation");

  public List<SkillVersion> publishMetricView() throws Exception {
    return publishGenerationSkills(METRICVIEW_SKILL);
  }

  public JSONObject metricView(String domain, String prompt, String language, long remainingMs, List<SkillVersion> skills) {
    var definition = definition(domain, language, remainingMs, skills);
    definition.put("toolCallPolicy", TOOL_LOOP_POLICY);
    definition.put("agentId", METRICVIEW_AGENT);
    definition.put("modelId", models.modelId(domain, METRICVIEW_AGENT));
    definition.put(
        "systemPrompt",
        prompt
            + "\n\n"
            + resource("ontology-skills/metricview-generation/SKILL.md")
            + "\n\n"
            + JSON.parseObject(
                resource("ontology-contracts/agent-artifact-markdown-prompt.json"), String.class));
    return definition;
  }

  public JSONObject definition(String domain, String language, long remainingMs, List<SkillVersion> skills) {
    String markdown =
        JSON.parseObject(
            resource("ontology-contracts/agent-artifact-markdown-prompt.json"), String.class);
    return JSONObject.of(
        "agentId", OntologyAgentStore.RETRIEVER,
        "systemPrompt",
        prompt(language, "data-retrieval", "system") + "\n\n" + markdown,
        "modelId",
        models.modelId(domain, OntologyAgentStore.RETRIEVER),
        "skills",
        skills,
        "externalMcp",
        List.of(),
        "sandbox",
        Map.of(
            "limits",
            Map.of(
                "memoryBytes",
                16L * 1024 * 1024 * 1024,
                "wallTimeMs",
                Math.max(1, remainingMs),
                "cpuSeconds",
                Math.max(1, (remainingMs + 999) / 1000))),
        "compaction",
        Map.of(
            "systemPrompt",
            prompt(language, "data-retrieval", "compaction/system"),
            "summarizePrompt",
            prompt(language, "data-retrieval", "compaction/summarize"),
            "updatePrompt",
            prompt(language, "data-retrieval", "compaction/update")));
  }
  /**
   * The conversational action creator: the action maker task prompt plus the generation skill, in
   * a persistent session. It has a write sandbox and can revise the files from the previous turn.
   */
  public JSONObject actionCreation(String domain, String prompt, String language, long remainingMs, List<SkillVersion> skills) {
    var value = definition(domain, language, remainingMs, skills);
    value.put("toolCallPolicy", TOOL_LOOP_POLICY);
    value.put("agentId", ActionCreationService.AGENT);
    value.put("modelId", models.modelId(domain, ActionCreationService.AGENT));
    // The conversation guardrails go last: they are the rules the model must apply after reading
    // the action-maker task and the generation skill, not before them.
    value.put(
        "systemPrompt",
        prompt
            + "\n\n"
            + resource("ontology-skills/ontology-generation/SKILL.md")
            + "\n\n"
            + JSON.parseObject(
                resource("ontology-contracts/agent-artifact-markdown-prompt.json"), String.class)
            + "\n\n"
            + prompt(language, "generation", "action_creation"));
    return value;
  }

}
