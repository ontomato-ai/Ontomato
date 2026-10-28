package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
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
  private final String url, token, ontologyUrl;
  private final HttpClient http =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

  public RuntimeCodeClient(
      @Value("${AGENT_RUNTIME_URL:http://127.0.0.1:3001}") String url,
      @Value("${AGENT_RUNTIME_ONTOLOGY_TOKEN:}") String token,
      @Value("${ONTOMATO_QUERY_CALLBACK_URL:http://127.0.0.1:18087}") String ontologyUrl) {
    this.url = url.replaceAll("/$", "");
    this.token = token;
    this.ontologyUrl = ontologyUrl.replaceAll("/$", "");
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
    return ontologyUrl;
  }

  public String request(
      String domain, String correlation, String path, String method, Object body, String key)
      throws Exception {
    if (token.isBlank())
      throw new IllegalStateException("AGENT_RUNTIME_ONTOLOGY_TOKEN is not configured");
    HttpRequest.Builder builder =
        HttpRequest.newBuilder(URI.create(url + path))
            .timeout(Duration.ofSeconds(30))
            .header("Authorization", "Bearer " + token)
            .header("X-Correlation-Id", correlation)
            .header("Content-Type", "application/json");
    if (domain != null) builder.header("X-Domain-Id", domain);
    if (key != null) builder.header("Idempotency-Key", key);
    builder.method(
        method,
        body == null
            ? HttpRequest.BodyPublishers.noBody()
            : HttpRequest.BodyPublishers.ofString(
                JSON.toJSONString(
                    body, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue)));
    HttpResponse<String> response = null;
    for (int attempt = 0; ; attempt++) {
      try {
        response =
            http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        break;
      } catch (IOException e) {
        if (key == null || attempt > 0) throw e;
      }
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300)
      throw new IllegalStateException(
          "Runtime request failed (" + response.statusCode() + "): " + response.body());
    return response.body();
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
