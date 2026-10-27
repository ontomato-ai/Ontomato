package io.ontomato.dataengine.controller;

import java.util.Map;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice(assignableTypes = OntologyQueryController.class)
@Order(-100)
public class OntologyQueryErrors {
  @ExceptionHandler(Exception.class)
  public ResponseEntity<?> failure(Exception error) {
    int status =
        error instanceof ResponseStatusException e
            ? e.getStatusCode().value()
            : error instanceof IllegalArgumentException ? 400 : 500;
    String message =
        error instanceof ResponseStatusException e ? e.getReason() : error.getMessage();
    return ResponseEntity.status(status)
        .body(
            Map.of(
                "error",
                Map.of(
                    "code",
                    "ONTOLOGY_QUERY_FAILED",
                    "message",
                    message == null ? error.getClass().getSimpleName() : message)));
  }
}
