package io.ontomato.dataengine.schedules;

import java.util.Locale;
import java.util.Map;
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
            : error instanceof org.springframework.http.converter.HttpMessageNotReadableException
                    || error instanceof org.springframework.beans.TypeMismatchException
                ? 400
                : error instanceof TaskCredentials.Invalid ? 403 : 500;
    String message =
        error instanceof org.springframework.web.server.ResponseStatusException http
            ? http.getReason()
            : status >= 500 ? "Task request failed" : "Invalid request";
    return ResponseEntity.status(status)
        .body(
            Map.of("error", Map.of("message", message == null ? "Task request refused" : message)));
  }

  @GetMapping
  public Map<String, Object> list(
      @RequestParam(required = false) String appId, @RequestParam(required = false) UUID agentId) {
    return service.list(appId, agentId);
  }

  @PostMapping("/credential/renew")
  public ResponseEntity<Void> renewOnVisit() {
    service.renewOnVisit();
    return ResponseEntity.noContent().build();
  }

  @PostMapping
  public ResponseEntity<PlatformTasks.View> create(
      @RequestHeader("Idempotency-Key") UUID id,
      @RequestBody TaskDefinition input,
      @RequestParam(defaultValue = "true") boolean enabled,
      Locale locale) {
    var result = service.create(id, input, locale.toLanguageTag(), enabled);
    return ResponseEntity.status(result.created() ? 201 : 200).body(result.task());
  }

  @GetMapping("/{id}")
  public PlatformTasks.View task(@PathVariable UUID id) {
    return service.detail(id);
  }

  @GetMapping("/{id}/runs/{runId}")
  public TaskStore.Run getRun(@PathVariable UUID id, @PathVariable UUID runId) {
    return service.detail(id, runId);
  }

  @PutMapping("/{id}")
  public PlatformTasks.View update(
      @PathVariable UUID id, @RequestBody TaskDefinition input, Locale locale) {
    return service.update(id, input, locale.toLanguageTag());
  }

  public record Switch(Boolean enabled) {}

  @PutMapping("/{id}/enabled")
  public PlatformTasks.View enabled(@PathVariable UUID id, @RequestBody Switch input) {
    if (input.enabled() == null) throw TaskDefinition.bad("Missing enabled flag");
    return service.enabled(id, input.enabled());
  }

  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(@PathVariable UUID id) {
    service.delete(id);
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/{id}/runs")
  public ResponseEntity<TaskStore.Run> run(
      @PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key) {
    return ResponseEntity.accepted().body(service.manual(id, key));
  }

  @GetMapping("/{id}/runs")
  public PlatformTasks.History history(
      @PathVariable UUID id,
      @RequestParam(required = false) String cursor,
      @RequestParam(defaultValue = "20") int limit) {
    return service.history(id, cursor, limit);
  }
}
