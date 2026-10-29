package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.dao.SessionRegistryDao;
import io.ontomato.dataengine.dao.SessionRegistryEntry;
import io.ontomato.dataengine.core.bean.R;
import io.ontomato.dataengine.logging.ServiceLogStore;
import io.ontomato.dataengine.util.SystemUtils;
import org.apache.logging.log4j.ThreadContext;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.util.MultiValueMap;
import java.util.*;

@RestController
@RequestMapping("/observe/logs")
public class ObserveLogController {
  private final ServiceLogStore logs;
  private final SessionRegistryDao sessions;
  public ObserveLogController(ServiceLogStore logs, SessionRegistryDao sessions) { this.logs = logs; this.sessions = sessions; }
  @GetMapping
  public ResponseEntity<?> logs(@RequestParam MultiValueMap<String, String> query) {
    if (SystemUtils.getCurUser() == null) return error(401, "UNAUTHENTICATED", "Login required");
    try {
      if (query.values().stream().anyMatch(values -> values.size() != 1)) return error(400, "INVALID_LOG_QUERY", "Invalid log query");
      return ResponseEntity.ok(logs.query(query.toSingleValueMap()));
    } catch (ServiceLogStore.QueryException failure) { return error(failure.status, failure.code, failure.getMessage()); }
    catch (RuntimeException failure) { return error(500, "LOG_QUERY_FAILED", "Service log query failed"); }
  }
  private ResponseEntity<?> error(int status, String code, String message) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("error", Map.of("code", code, "message", message)); body.put("correlationId", ThreadContext.get("correlationId"));
    return ResponseEntity.status(status).body(body);
  }
  /** Session routing remains owned by the registry, including cancellation callers. */
  @GetMapping("/session-registry")
  public ResponseEntity<R<List<SessionRegistryEntry>>> sessionRegistry(@RequestParam(required=false) String sessionId) {
    if (SystemUtils.getCurUser() == null) return ResponseEntity.status(401).build();
    return ResponseEntity.ok(R.of(sessionId == null || sessionId.isBlank() ? List.of() : sessions.findAllBySessionId(sessionId)));
  }
}
