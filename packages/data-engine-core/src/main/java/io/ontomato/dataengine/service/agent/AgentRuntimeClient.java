package io.ontomato.dataengine.service.agent;

import io.ontomato.dataengine.logging.ServiceLogContext;
import io.ontomato.dataengine.logging.ServiceLogEvents;
import org.apache.logging.log4j.ThreadContext;
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
            .header("X-Correlation-Id", ServiceLogContext.correlation(ThreadContext.get("correlationId")))
            .header("Content-Type", "application/json");
    ServiceLogContext.outbound(builder);
    String userId = ThreadContext.get("userId");
    if (userId != null) builder.setHeader(ServiceLogContext.header("hostVerifiedUserId"), userId);
    if (!stream) {
      Duration timeout = Duration.ofSeconds(30);
      if (path.equals("/v1/models/embeddings")) {
        // The runtime owns request timeouts and retries; a shorter host deadline would truncate them.
        timeout = null;
      } else if ((path.equals("/v1/models/test") || path.equals("/v1/models/discover")) && body != null) {
        var retry = JSONObject.from(body).getJSONObject("retry");
        var provider = retry == null ? null : retry.getJSONObject("provider");
        long configured = provider == null ? 300000 : provider.getLongValue("timeoutMs", 300000);
        timeout = Duration.ofMillis(Math.max(1, configured)).plusSeconds(10);
      } else if (path.contains("/status?waitFor=stopped")) {
        // The runtime holds a stop wait for at most 60 seconds; this must not time out first.
        timeout = Duration.ofSeconds(70);
      }
      if (timeout != null) builder.timeout(timeout);
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

  private <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler) throws java.io.IOException, InterruptedException {
    long started = System.nanoTime(); String outcome = "failure";
    try {
      var response = http.send(request, handler);
      outcome = response.statusCode() < 400 ? "success" : "failure"; return response;
    } catch (InterruptedException error) { outcome = "cancelled"; throw error; }
    finally { ServiceLogEvents.downstream("runtime-client", "agent-runtime", started, outcome); }
  }

  public HttpResponse<InputStream> stream(String domain, String correlation, String path)
      throws Exception {
    var response =
        send(
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
      response = send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    } catch (java.io.IOException failure) {
      if (key == null) throw failure;
      response = send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
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

  /** Cancellation of the servlet request must cancel the upstream HTTP call as well. */
  public java.util.concurrent.CompletableFuture<JSONObject> testModel(String domain, Object body) {
    var upstream = http.sendAsync(request(domain, "model-test", "/v1/models/test", "POST", body, null, false),
        HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    var result = upstream.thenApply(response -> {
      if (response.statusCode() < 200 || response.statusCode() >= 300)
        throw failure(response.statusCode(), response.body());
      return JSON.parseObject(response.body());
    });
    result.whenComplete((value, error) -> { if (result.isCancelled()) upstream.cancel(true); });
    return result;
  }

  public JSONObject run(String domain, String id) throws Exception {
    return json(domain, id, "/v1/runs/" + id, "GET", null, null);
  }

  /** The run's lifecycle view only: no events, messages or artifacts, and no runtime session lock. */
  public JSONObject status(String domain, String id) throws Exception {
    return json(domain, id, "/v1/runs/" + id + "/status", "GET", null, null).getJSONObject("run");
  }

  /** Returns when the run stops, or with it still running after timeoutMs (clamped to the runtime's 60 s). */
  public JSONObject waitStopped(String domain, String id, long timeoutMs) throws Exception {
    long bounded = Math.max(0, Math.min(60_000, timeoutMs));
    return json(domain, id, "/v1/runs/" + id + "/status?waitFor=stopped&timeoutMs=" + bounded, "GET", null, null)
        .getJSONObject("run");
  }


  /**
   * One short completion with the domain default model. Used for lightweight guidance text,
   * never for action generation: the model settings carry masked keys that the runtime restores.
   */
  public String modelText(String domain, String correlation, String prompt)
      throws Exception {
    JSONObject settings = json(domain, correlation, "/v1/models/settings", "GET", null, null);
    String ref = settings.getString("defaultModelId");
    int slash = ref == null ? -1 : ref.indexOf('/');
    JSONObject provider = slash < 1 ? null : settings.getJSONObject("providers").getJSONObject(ref.substring(0, slash));
    JSONObject model = null;
    if (provider != null) for (Object item : provider.getJSONArray("models")) {
      var candidate = (JSONObject) item;
      if (ref.substring(slash + 1).equals(candidate.getString("id")) && "chat".equals(candidate.getString("type"))) model = candidate;
    }
    if (model == null) throw new AgentHttpException(422, "MODEL_NOT_CONFIGURED", "No domain default model is configured");
    provider = JSON.parseObject(provider.toJSONString()); provider.remove("models");
    var result = json(domain, correlation, "/v1/models/test", "POST", JSONObject.of("providerId", ref.substring(0, slash),
        "provider", provider, "model", model, "prompt", prompt,
        "retry", JSONObject.of("provider", JSONObject.of("timeoutMs", 20000, "maxRetries", 0, "maxRetryDelayMs", 60000))), null);
    return result.getString("content");
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
