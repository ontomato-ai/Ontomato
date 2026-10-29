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

  private String prompt(String language, String path) {
    String locale = language != null && language.startsWith("zh") ? "zh" : "en";
    String name = "ontology-prompts/" + locale + "/data-retrieval/" + path + ".md";
    if (getClass().getResource("/" + name) == null)
      name = "ontology-prompts/en/data-retrieval/" + path + ".md";
    return resource(name).trim();
  }

  public void publish() throws Exception {
    code.registerSkill();
    var files = new ArrayList<Map<String, String>>();
    for (String path : List.of("SKILL.md", "scripts/dataset.mjs", "references/dataset.md"))
      files.add(
          Map.of("path", path, "content", resource("ontology-skills/data-retrieval/" + path)));
    runtime.json(
        null,
        "ontology-retrieval-skills",
        "/v1/skills",
        "POST",
        Map.of("skill", DATASET_SKILL, "files", files),
        null);
  }

  public JSONObject definition(String language, long remainingMs) {
    String markdown =
        JSON.parseObject(
            resource("ontology-contracts/agent-artifact-markdown-prompt.json"), String.class);
    return JSONObject.of(
        "systemPrompt",
        prompt(language, "system") + "\n\n" + markdown,
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
            prompt(language, "compaction/system"),
            "summarizePrompt",
            prompt(language, "compaction/summarize"),
            "updatePrompt",
            prompt(language, "compaction/update")));
  }
}
