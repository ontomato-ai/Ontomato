package io.ontomato.dataengine.schedules;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Locale;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/platform/scheduled-tasks")
@RequiredArgsConstructor
public class PlatformTaskController {
  private final PlatformTasks service;

  @ExceptionHandler(Exception.class)
  public ResponseEntity<?> failure(Exception error) {
    int status =
        error instanceof org.springframework.web.ErrorResponse problem
            ? problem.getStatusCode().value()
            : error instanceof IllegalArgumentException
                    || error
                        instanceof
                        org.springframework.http.converter.HttpMessageNotReadableException
                    || error instanceof org.springframework.beans.TypeMismatchException
                    || error instanceof org.springframework.web.bind.ServletRequestBindingException
                ? 400
                : 503;
    if (status >= 500) status = 503;
    String code =
        error instanceof ScheduleException schedule
            ? schedule.code
            : status == 401
                ? "UNAUTHENTICATED"
                : status == 403
                    ? "PERMISSION_DENIED"
                    : status == 404
                        ? "TASK_NOT_FOUND"
                        : status == 400 ? "INVALID_REQUEST" : "DEPENDENCY_UNAVAILABLE";
    String message =
        error instanceof org.springframework.web.server.ResponseStatusException http
            ? http.getReason()
            : status >= 500 ? "Task service unavailable" : "Invalid request";
    var detail =
        ScheduleJson.object(
            "code", code, "message", message == null ? "Task request refused" : message);
    if (error instanceof ScheduleException schedule)
      schedule.details.forEach(
          (key, value) -> detail.set(key, ScheduleJson.JSON.valueToTree(value)));
    return ResponseEntity.status(status)
        .body(
            ScheduleJson.object(
                "error",
                detail,
                "correlationId",
                java.util.Objects.toString(
                    org.apache.logging.log4j.ThreadContext.get("correlationId"), "schedule")));
  }

  @GetMapping
  public JsonNode list(
      @RequestParam(required = false) String appId,
      jakarta.servlet.http.HttpServletRequest request) {
    if (request.getParameterMap().keySet().stream().anyMatch(key -> !key.equals("appId")))
      throw ScheduleJson.bad("Unknown list filter");
    return service.list(appId);
  }

  @GetMapping("/applications")
  public JsonNode applications(Locale locale) {
    return service.applications(locale.toLanguageTag());
  }

  @PostMapping("/applications/{appId}/form")
  public JsonNode form(@PathVariable String appId, @RequestBody JsonNode input, Locale locale) {
    return service.form(appId, input, locale.toLanguageTag());
  }

  @PostMapping("/credential/renew")
  public ResponseEntity<Void> renew(Locale locale) {
    service.renewOnVisit(locale.toLanguageTag());
    return ResponseEntity.noContent().build();
  }

  @PostMapping
  public ResponseEntity<JsonNode> create(
      @RequestHeader("Idempotency-Key") UUID id,
      @RequestBody JsonNode input,
      @RequestParam(defaultValue = "true") boolean enabled,
      Locale locale) {
    var result = service.create(id, input, locale.toLanguageTag(), enabled);
    return ResponseEntity.status(result.created() ? 201 : 200).body(result.task());
  }

  @GetMapping("/{id}")
  public JsonNode task(@PathVariable UUID id) {
    return service.detail(id);
  }

  @GetMapping("/{id}/runs/{runId}")
  public JsonNode getRun(@PathVariable UUID id, @PathVariable UUID runId) {
    return service.detail(id, runId);
  }

  @PutMapping("/{id}")
  public JsonNode update(@PathVariable UUID id, @RequestBody JsonNode input, Locale locale) {
    return service.update(id, input, locale.toLanguageTag());
  }

  @PutMapping("/{id}/enabled")
  public JsonNode enabled(@PathVariable UUID id, @RequestBody JsonNode input, Locale locale) {
    return service.enabled(id, input, locale.toLanguageTag());
  }

  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(
      @PathVariable UUID id, @RequestHeader("If-Match") String revision) {
    service.delete(id, revision);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/{id}/runs")
  public ResponseEntity<JsonNode> run(
      @PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, Locale locale) {
    return ResponseEntity.accepted().body(service.manual(id, key, locale.toLanguageTag()));
  }

  @GetMapping("/{id}/runs")
  public JsonNode history(
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int limit) {
    return service.history(id, cursor, limit);
  }
}
