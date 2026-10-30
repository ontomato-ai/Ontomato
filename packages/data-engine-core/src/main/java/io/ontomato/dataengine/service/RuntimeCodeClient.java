package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** HTTP-only connection from the ontology host to the platform runtime. */
@Service
public class RuntimeCodeClient {
  public static final Map<String, Object> SKILL =
      Map.of(
          "namespace",
          Map.of("kind", "provider", "provider", "ontology"),
          "name",
          "ontomato-analyst");
  /** The assistant-scoped analyst package reuses the complete skill's client files. */
  public static final Map<String, Object> ASSISTANT_SKILL =
      Map.of(
          "namespace",
          Map.of("kind", "provider", "provider", "ontology"),
          "name",
          "ontomato-analyst-assistant");
  private final io.ontomato.dataengine.service.agent.AgentRuntimeClient runtime;

  public RuntimeCodeClient(io.ontomato.dataengine.service.agent.AgentRuntimeClient runtime) {
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
                  registerAssistantSkill();
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

  public void registerSkill() throws Exception {
    List<Map<String, String>> files = new ArrayList<>();
    for (String file :
        List.of(
            "SKILL.md",
            "ontomato.mjs",
            "client.mjs",
            "application.yml",
            "references/dsl.md"))
      files.add(
          Map.of("path", file, "content", skillResource("ontology-skills/ontomato-analyst/" + file)));
    request(
        null,
        "ontology-skill-registration",
        "/v1/skills",
        "POST",
        Map.of("skill", SKILL, "files", files),
        null);
  }

  /** Publish the restricted entry point with the complete package's shared client files. */
  public void registerAssistantSkill() throws Exception {
    List<Map<String, String>> files = new ArrayList<>();
    files.add(
        Map.of(
            "path",
            "SKILL.md",
            "content",
            skillResource("ontology-skills/ontomato-analyst-assistant/SKILL.md")));
    for (String file : List.of("ontomato.mjs", "client.mjs", "application.yml"))
      files.add(
          Map.of("path", file, "content", skillResource("ontology-skills/ontomato-analyst/" + file)));
    request(
        null,
        "ontology-assistant-skill-registration",
        "/v1/skills",
        "POST",
        Map.of("skill", ASSISTANT_SKILL, "files", files),
        null);
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
