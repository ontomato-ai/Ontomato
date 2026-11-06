package io.ontomato.dataengine.schedules;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Stable scheduling errors at the application boundary; never expose an exception stack to clients.
 */
public final class ScheduleException extends ResponseStatusException {
  public final String code;
  public final Map<String, Object> details;

  public ScheduleException(int status, String code, String message) {
    this(status, code, message, Map.of());
  }

  public ScheduleException(int status, String code, String message, Map<String, Object> details) {
    super(HttpStatus.valueOf(status), message);
    this.code = code;
    this.details = details;
  }
}
