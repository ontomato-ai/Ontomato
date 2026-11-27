package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient.SkillVersion;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** HTTP-only connection from the ontology host to the platform runtime. */
@Service
public class RuntimeCodeClient {
  public static final Map<String, Object> SKILL = skillRef("ontology-query");
  private static final Map<String, List<String>> SKILL_FILES =
      Map.of(
          "ontology-query",
              List.of("SKILL.md", "scripts/ontomato.mjs", "application.yml", "references/dsl.md"),
          "ontomato-analyst-assistant", List.of("SKILL.md"),
          "knowledge-submit", List.of("SKILL.md", "scripts/submit.mjs"),
          "knowledge-governance",
              List.of(
                  "SKILL.md",
                  "scripts/governance.mjs",
                  "references/commands.md",
                  "references/extraction.md"));

  private static Map<String, Object> skillRef(String name) {
    return Map.of("namespace", Map.of("kind", "provider", "provider", "ontology"), "name", name);
  }
  private final AgentRuntimeClient runtime;

  public RuntimeCodeClient(AgentRuntimeClient runtime) {
    this.runtime = runtime;
  }

  @org.springframework.context.event.EventListener(
      org.springframework.boot.context.event.ApplicationReadyEvent.class)
  public void publishAtStartup() {
    Thread.ofPlatform()
        .daemon()
        .name("ontology-skill-publication")
        .start(
            () -> {
              for (int attempt = 0; attempt < 30; attempt++) {
                try {
                  registerSkill();
                  return;
                } catch (Exception error) {
                  if (attempt == 29)
                    org.slf4j.LoggerFactory.getLogger(RuntimeCodeClient.class)
                        .warn(
                            "Ontology skill publication failed; query admission will retry"
                                + " publication",
                            error);
                  try {
                    Thread.sleep(1000);
                  } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return;
                  }
                }
              }
            });
  }

  public String ontologyUrl() {
    return runtime.ontologyUrl();
  }

  public String request(
      String domain, String correlation, String path, String method, Object body, String key)
      throws Exception {
    return runtime.text(domain, correlation, path, method, body, key);
  }

  private String skillResource(String path) throws java.io.IOException {
    try (var in = getClass().getResourceAsStream("/" + path)) {
      if (in == null) throw new IllegalStateException("Ontology skill resource is missing: " + path);
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  public String pythonHelper() throws java.io.IOException {
    return skillResource("python/query_runtime.py");
  }

  public SkillVersion registerSkill() throws Exception {
    return registerSkill((String) SKILL.get("name"));
  }

  /** Publish one ontology-owned skill package; callers name the skill, never its files. */
  public SkillVersion registerSkill(String name) throws Exception {
    var paths = SKILL_FILES.get(name);
    if (paths == null) throw AgentHttpException.missing();
    List<Map<String, String>> files = new ArrayList<>();
    for (String file : paths)
      files.add(
          Map.of("path", file, "content", skillResource("ontology-skills/" + name + "/" + file)));
    return runtime.publishSkill("ontology-skill-registration", skillRef(name), files);
  }

  public JSONObject execution(String domain, String id) throws Exception {
    return JSON.parseObject(request(domain, id, "/v1/code-executions/" + id, "GET", null, null));
  }

  public String output(String domain, String id, String name) throws Exception {
    return request(
        domain,
        id,
        "/v1/code-executions/"
            + id
            + "/outputs/"
            + java.net.URLEncoder.encode(name, StandardCharsets.UTF_8),
        "GET",
        null,
        null);
  }

  public void closeIntent(String domain, String id) throws Exception {
    request(domain, id, "/v1/code-execution-intents/" + id + "/cancel", "POST", Map.of(), null);
  }

  public void cancel(String domain, String id) throws Exception {
    request(domain, id, "/v1/code-executions/" + id + "/cancel", "POST", Map.of(), null);
  }
}
