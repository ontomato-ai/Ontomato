package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter;
import java.io.InputStream;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** The ontology host's only runtime HTTP transport; no business interpretation. */
@Service
public class AgentRuntimeClient {
  private final String url, token, ontologyUrl;
  private final HttpClient http =
      HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

  public AgentRuntimeClient(
      @Value("${AGENT_RUNTIME_URL:http://127.0.0.1:3001}") String url,
      @Value("${AGENT_RUNTIME_ONTOLOGY_TOKEN:}") String token,
      @Value("${ONTOMATO_QUERY_CALLBACK_URL:http://127.0.0.1:18087}") String ontologyUrl) {
    this.url = url.replaceAll("/$", "");
    this.token = token;
    this.ontologyUrl = ontologyUrl.replaceAll("/$", "");
  }

  public String ontologyUrl() {
    return ontologyUrl;
  }

  private HttpRequest request(
      String domain,
      String correlation,
      String path,
      String method,
      Object body,
      String key,
      boolean stream) {
    if (token.isBlank())
      throw new AgentHttpException(
          503, "DEPENDENCY_UNAVAILABLE", "Runtime host credential is not configured");
    var builder =
        HttpRequest.newBuilder(URI.create(url + path))
            .header("Authorization", "Bearer " + token)
            .header("X-Correlation-Id", correlation)
            .header("Content-Type", "application/json");
    if (!stream) {
      Duration timeout = Duration.ofSeconds(30);
      if (path.equals("/v1/models/test") && body != null) {
        String configured = JSONObject.from(body).getJSONObject("model").getString("timeout");
        if (configured != null) timeout = Duration.parse(configured);
        timeout = timeout.plusSeconds(10);
      }
      builder.timeout(timeout);
    }
    if (domain != null) builder.header("X-Domain-Id", domain);
    if (key != null) builder.header("Idempotency-Key", key);
    return builder
        .method(
            method,
            body == null
                ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(
                    JSON.toJSONString(body, JSONWriter.Feature.WriteMapNullValue)))
        .build();
  }

  public HttpResponse<InputStream> stream(String domain, String correlation, String path)
      throws Exception {
    var response =
        http.send(
            request(domain, correlation, path, "GET", null, null, true),
            HttpResponse.BodyHandlers.ofInputStream());
    if (response.statusCode() < 200 || response.statusCode() >= 300) {
      try (var in = response.body()) {
        throw failure(response.statusCode(), new String(in.readAllBytes(), StandardCharsets.UTF_8));
      }
    }
    return response;
  }

  public byte[] bytes(String domain, String correlation, String path) throws Exception {
    try (var in = stream(domain, correlation, path).body()) {
      return in.readAllBytes();
    }
  }

  public String text(
      String domain, String correlation, String path, String method, Object body, String key)
      throws Exception {
    // Retry only the same idempotent admission bytes; callers reconcile the original ID afterward.
    var request = request(domain, correlation, path, method, body, key, false);
    HttpResponse<String> response;
    try {
      response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    } catch (java.io.IOException failure) {
      if (key == null) throw failure;
      response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }
    if (response.statusCode() < 200 || response.statusCode() >= 300)
      throw failure(response.statusCode(), response.body());
    return response.body();
  }

  public JSONObject json(
      String domain, String correlation, String path, String method, Object body, String key)
      throws Exception {
    String value = text(domain, correlation, path, method, body, key);
    return value.isBlank() ? new JSONObject() : JSON.parseObject(value);
  }

  public JSONObject run(String domain, String id) throws Exception {
    return json(domain, id, "/v1/runs/" + id, "GET", null, null);
  }

  private AgentHttpException failure(int status, String body) {
    try {
      var error = JSON.parseObject(body).getJSONObject("error");
      return new AgentHttpException(
          status, AgentJson.text(error, "code"), AgentJson.text(error, "message"));
    } catch (RuntimeException invalid) {
      return new AgentHttpException(
          503, "DEPENDENCY_UNAVAILABLE", "Runtime returned HTTP " + status);
    }
  }
}
