package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.RuntimeCodeClient;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.stereotype.Service;

/** Ontology owns definitions and standard skill packages; runtime only executes them. */
@Service
public class OntologyAgentDefinitions {
  private final AgentRuntimeClient runtime;
  private final RuntimeCodeClient code;
  public static final Map<String, Object> DATASET_SKILL =
      Map.of(
          "namespace",
          Map.of("kind", "provider", "provider", "ontology"),
          "name",
          "data-retrieval");

  public OntologyAgentDefinitions(AgentRuntimeClient runtime, RuntimeCodeClient code) {
    this.runtime = runtime;
    this.code = code;
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
    files.add(Map.of("path", "references/query-subgraph.md", "content", resource("ontology-contracts/query-subgraph.md")));
    files.add(Map.of("path", "references/query-subgraphs.json", "content", resource("ontology-contracts/examples/query-subgraphs.json")));
    files.add(Map.of("path", "references/query-subgraph.schema.json", "content", resource("ontology-contracts/query-subgraph.schema.json")));
  }

  public void publish() throws Exception {
    code.registerSkill();
    var files = new ArrayList<Map<String, String>>();
    for (String path : List.of("SKILL.md", "scripts/dataset.mjs", "references/dataset.md"))
      files.add(
          Map.of("path", path, "content", resource("ontology-skills/data-retrieval/" + path)));
    sourceContract(files);
    runtime.json(
        null,
        "ontology-retrieval-skills",
        "/v1/skills",
        "POST",
        Map.of("skill", DATASET_SKILL, "files", files),
        null);
  }

  public static final Map<String, Object> GENERATION_SKILL =
      Map.of(
          "namespace",
          Map.of("kind", "provider", "provider", "ontology"),
          "name",
          "ontology-generation");

  public void publishGeneration() throws Exception {
    code.registerSkill();
    var files = new ArrayList<Map<String, String>>();
    for (String path : List.of("SKILL.md", "scripts/generation.mjs"))
      files.add(
          Map.of("path", path, "content", resource("ontology-skills/ontology-generation/" + path)));
    sourceContract(files);
    runtime.json(
        null,
        "ontology-generation-skills",
        "/v1/skills",
        "POST",
        Map.of("skill", GENERATION_SKILL, "files", files),
        null);
  }

  public JSONObject generation(String kind, String prompt, String language, long remainingMs) {
    var definition = definition(language, remainingMs);
    definition.put("agentId", OntologyGenerationService.agentId(kind));
    definition.put(
        "modelRole",
        List.of("knowledge", "describe", "quality").contains(kind) ? "query" : "coding");
    definition.put("skills", List.of(RuntimeCodeClient.SKILL, GENERATION_SKILL));
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

  public void publishMetricView() throws Exception {
    code.registerSkill();
    var files = new ArrayList<Map<String, String>>();
    for (String path : List.of("SKILL.md", "scripts/generation.mjs"))
      files.add(
          Map.of(
              "path", path, "content", resource("ontology-skills/metricview-generation/" + path)));
    sourceContract(files);
    runtime.json(
        null,
        "metricview-generation-skills",
        "/v1/skills",
        "POST",
        Map.of("skill", METRICVIEW_SKILL, "files", files),
        null);
  }

  public JSONObject metricView(String prompt, String language, long remainingMs) {
    var definition = definition(language, remainingMs);
    definition.put("agentId", METRICVIEW_AGENT);
    definition.put("modelRole", "coding");
    definition.put("skills", List.of(RuntimeCodeClient.SKILL, METRICVIEW_SKILL));
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

  public JSONObject definition(String language, long remainingMs) {
    String markdown =
        JSON.parseObject(
            resource("ontology-contracts/agent-artifact-markdown-prompt.json"), String.class);
    return JSONObject.of(
        "agentId", OntologyAgentStore.RETRIEVER,
        "systemPrompt",
        prompt(language, "data-retrieval", "system") + "\n\n" + markdown,
        "modelRole",
        "coding",
        "skills",
        List.of(RuntimeCodeClient.SKILL, DATASET_SKILL),
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
  public static final Map<String,Object> GOVERNANCE_SKILL = Map.of(
    "namespace", Map.of("kind","provider","provider","ontology"), "name","knowledge-governance");

  public void publishGovernance() throws Exception {
    var files = new ArrayList<Map<String,String>>();
    for (String path : List.of("SKILL.md", "scripts/governance.mjs", "references/commands.md"))
      files.add(Map.of("path",path,"content",resource("ontology-skills/knowledge-governance/"+path)));
    runtime.json(null,"ontology-governance-skills","/v1/skills","POST",
      Map.of("skill",GOVERNANCE_SKILL,"files",files),null);
  }

  /**
   * The conversational action creator: the action maker task prompt plus the generation skill, in
   * a persistent session. It has a write sandbox and can revise the files from the previous turn.
   */
  public JSONObject actionCreation(String prompt, String language, long remainingMs) {
    var value = definition(language, remainingMs);
    value.put("agentId", ActionCreationService.AGENT);
    value.put("modelRole", "coding");
    value.put("skills", List.of(RuntimeCodeClient.SKILL, GENERATION_SKILL));
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

  public JSONObject governance(String language, long remainingMs) {
    var value = definition(language,remainingMs);
    value.put("agentId",KnowledgeGovernanceService.AGENT);
    value.put("modelRole","knowledgeGovernance");
    value.put("skills",List.of(GOVERNANCE_SKILL));
    value.put("systemPrompt",prompt(language,"knowledge-governance","main/system") + "\n\n" +
      JSON.parseObject(resource("ontology-contracts/agent-artifact-markdown-prompt.json"),String.class));
    value.put("compaction",Map.of(
      "systemPrompt",prompt(language,"knowledge-governance","compaction/system"),
      "summarizePrompt",prompt(language,"knowledge-governance","compaction/summarize/user"),
      "updatePrompt",prompt(language,"knowledge-governance","compaction/update/user")));
    return value;
  }

}
