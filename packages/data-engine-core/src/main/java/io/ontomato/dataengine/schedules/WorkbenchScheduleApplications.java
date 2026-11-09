package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/** A single workbench transport for application-owned scheduling declarations and executions. */
@Component
public class WorkbenchScheduleApplications {
  private final RestClient http;
  private final ScheduleIdentity identity;

  public WorkbenchScheduleApplications(
      @Value("${WORKBENCH_INTERNAL_URL:${AGENT_RUNTIME_CALLBACK_URL:http://127.0.0.1:3000}}")
          String url,
      @Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String token,
      ScheduleIdentity identity) {
    this.identity = identity;
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

  public ScheduleApplication application(String id) {
    return new Remote(id);
  }

  private String path(String app) {
    return "/api/platform/schedule-applications/" + app;
  }

  private JsonNode call(String path, JsonNode body, ScheduleApplication.Actor actor) {
    var request =
        http.post().uri(path).contentType(org.springframework.http.MediaType.APPLICATION_JSON);
    if (actor != null) {
      request.header("Accept-Language", actor.locale());
      if (actor.apiKey() != null) request.header("X-API-Key", actor.apiKey());
      else if (actor.token() != null) request.header("tk", actor.token());
    }
    try {
      return request.body(body).retrieve().body(JsonNode.class);
    } catch (RestClientResponseException failure) {
      throw translated(failure);
    }
  }

  private ScheduleException translated(RestClientResponseException failure) {
    try {
      var body = parse(failure.getResponseBodyAsString());
      var error = body.path("error");
      String code = error.path("code").asText("DEPENDENCY_UNAVAILABLE");
      // Authentication middleware predates the scheduling error envelope.
      if (failure.getStatusCode().value() == 401) code = "UNAUTHENTICATED";
      else if (failure.getStatusCode().value() == 403) code = "PERMISSION_DENIED";
      var details = new LinkedHashMap<String, Object>();
      for (String key : List.of("form", "fields", "activeRunId"))
        if (error.has(key)) details.put(key, error.get(key));
      return new ScheduleException(
          failure.getStatusCode().value(),
          code,
          error.path("message").asText("Workbench request refused"),
          details);
    } catch (RuntimeException invalid) {
      String code =
          failure.getStatusCode().value() == 401
              ? "UNAUTHENTICATED"
              : failure.getStatusCode().value() == 403
                  ? "PERMISSION_DENIED"
                  : "DEPENDENCY_UNAVAILABLE";
      return new ScheduleException(
          failure.getStatusCode().value(), code, "Workbench request refused");
    }
  }

  private final class Remote implements ScheduleApplication {
    private final String id;

    private Remote(String id) {
      this.id = id;
    }

    public String id() {
      return id;
    }

    public String description(String locale) {
      return null;
    }

    public boolean remote() {
      return true;
    }

    public void authorize(Actor actor) {
      var descriptor = describe(actor);
      if (!descriptor.path("available").asBoolean())
        throw new ScheduleException(
            403, "PERMISSION_DENIED", descriptor.path("unavailableReason").asText());
    }

    public JsonNode describe(Actor actor) {
      var request = http.get().uri(path(id)).header("Accept-Language", actor.locale());
      if (actor.apiKey() != null) request.header("X-API-Key", actor.apiKey());
      else if (actor.token() != null) request.header("tk", actor.token());
      try {
        return request.retrieve().body(JsonNode.class);
      } catch (RestClientResponseException failure) {
        throw translated(failure);
      }
    }

    public JsonNode form(FormInput input, Actor actor) {
      return call(
          path(id) + "/form",
          object(
              "values",
              input.values(),
              "changedField",
              input.changedField(),
              "taskId",
              input.taskId(),
              "timeZone",
              input.timeZone()),
          actor);
    }

    public Validation validate(TaskDefinition definition, Actor actor) {
      var result =
          call(
              path(id) + "/validate",
              object(
                  "content",
                  definition.content(),
                  "formRevision",
                  definition.formRevision(),
                  "timeZone",
                  definition.timeZone()),
              actor);
      return new Validation(
          result.path("content"),
          result.path("formRevision").asText(),
          definition.timeZone(),
          result.path("summary"),
          result.get("references"));
    }

    public JsonNode start(Execution execution, Actor actor) {
      return call(path(id) + "/runs", execution.wire(), actor);
    }

    public JsonNode status(Execution execution, JsonNode handle) {
      return call(
          "/internal/schedule-applications/" + id + "/runs/status",
          object(
              "taskId",
              execution.taskId(),
              "runId",
              execution.runId(),
              "owner",
              object(
                  "domainId",
                  execution.domainId(),
                  "userId",
                  identity.hostOwner(execution.creatorId())),
              "handle",
              handle),
          null);
    }
  }
}
