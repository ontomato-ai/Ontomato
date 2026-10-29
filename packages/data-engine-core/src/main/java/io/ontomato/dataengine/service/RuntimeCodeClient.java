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

  public void registerSkill() throws Exception {
    List<Map<String, String>> files = new ArrayList<>();
    for (String file :
        List.of(
            "SKILL.md",
            "ontomato.mjs",
            "client.mjs",
            "application.yml",
            "python/query_runtime.py",
            "references/dsl.md")) {
      try (var in = getClass().getResourceAsStream("/ontology-skills/ontomato-analyst/" + file)) {
        if (in == null)
          throw new IllegalStateException("Ontology skill resource is missing: " + file);
        files.add(
            Map.of("path", file, "content", new String(in.readAllBytes(), StandardCharsets.UTF_8)));
      }
    }
    request(
        null,
        "ontology-skill-registration",
        "/v1/skills",
        "POST",
        Map.of("skill", SKILL, "files", files),
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
