package io.ontomato.dataengine.schedules;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class AgentHost {
  private final RestClient http;

  public AgentHost(
      @Value("${WORKBENCH_INTERNAL_URL:${AGENT_RUNTIME_CALLBACK_URL:http://127.0.0.1:3000}}")
          String url,
      @Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String token) {
    var requests = new org.springframework.http.client.SimpleClientHttpRequestFactory();
    requests.setConnectTimeout(5000);
    requests.setReadTimeout(60000);
    http =
        RestClient.builder()
            .requestFactory(requests)
            .baseUrl(url)
            .defaultHeader("X-Ontomato-Query-Service-Token", token)
            .build();
  }

  void validate(String agent, String onlineToken) {
    var request = post("/api/assistant/scheduled-agent/validate", null);
    if (onlineToken != null) request.header("tk", onlineToken);
    try {
      request.body(Map.of("agentId", agent)).retrieve().toBodilessEntity();
    } catch (org.springframework.web.client.RestClientResponseException e) {
      var status = e.getStatusCode();
      throw new org.springframework.web.server.ResponseStatusException(status, e.getStatusText());
    }
  }

  void start(TaskStore.Task t, TaskStore.Run run, String key) {
    post("/api/assistant/scheduled-agent/start", key)
        .header("Accept-Language", t.locale())
        .body(
            Map.of(
                "agentId",
                run.target().get("agentId").asText(),
                "prompt",
                run.target().get("prompt").asText(),
                "sessionId",
                TaskStore.hostSession(run),
                "runId",
                run.id()))
        .retrieve()
        .toBodilessEntity();
  }

  JsonNode status(TaskStore.Task t, TaskStore.Run run, String hostOwner) {
    return post("/internal/scheduled-agent/status", null)
        .body(
            Map.of(
                "sessionId",
                TaskStore.hostSession(run),
                "runId",
                run.id(),
                "owner",
                Map.of("domainId", t.domain(), "userId", hostOwner)))
        .retrieve()
        .body(JsonNode.class);
  }

  private RestClient.RequestBodySpec post(String path, String key) {
    var spec =
        http.post().uri(path).contentType(org.springframework.http.MediaType.APPLICATION_JSON);
    if (key != null) spec.header("X-API-Key", key);
    return spec;
  }
}
