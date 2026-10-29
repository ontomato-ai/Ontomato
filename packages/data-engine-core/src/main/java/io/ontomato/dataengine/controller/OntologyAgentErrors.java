package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.agent.AgentHttpException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.*;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice(
    assignableTypes = {
      OntologyAgentController.class,
      OntologyRetrievalController.class,
      OntologyGenerationController.class
    })
@Order(-110)
public class OntologyAgentErrors {
  @ExceptionHandler(Exception.class)
  public ResponseEntity<?> failure(Exception error, HttpServletRequest request) {
    boolean badRequest =
        error instanceof IllegalArgumentException
            || error instanceof org.springframework.http.converter.HttpMessageNotReadableException
            || error instanceof org.springframework.web.bind.ServletRequestBindingException
            || error
                instanceof
                org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
    int status =
        error instanceof AgentHttpException e
            ? e.status()
            : error instanceof ResponseStatusException e
                ? e.getStatusCode().value()
                : badRequest ? 400 : 503;
    String code =
        error instanceof AgentHttpException e
            ? e.code()
            : status == 400
                ? "INVALID_REQUEST"
                : status == 401
                    ? "UNAUTHENTICATED"
                    : status == 403
                        ? "FORBIDDEN"
                        : status == 404 ? "NOT_FOUND" : "DEPENDENCY_UNAVAILABLE";
    String message =
        error instanceof AgentHttpException e
            ? e.getMessage()
            : error instanceof ResponseStatusException e
                ? e.getReason()
                : status == 400 ? "Invalid request" : "Ontology agent dependency is unavailable";
    String correlation = request.getHeader("X-Correlation-Id");
    if (correlation == null || correlation.isBlank()) correlation = UUID.randomUUID().toString();
    return ResponseEntity.status(status)
        .body(
            Map.of(
                "error",
                Map.of("code", code, "message", message == null ? code : message),
                "correlationId",
                correlation));
  }
}
