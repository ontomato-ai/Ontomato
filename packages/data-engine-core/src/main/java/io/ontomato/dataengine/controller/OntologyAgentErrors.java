package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.dataAdapter.DslContractViolationException;
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
      OntologyGenerationController.class,
      KnowledgeGovernanceController.class
    })
@Order(-110)
public class OntologyAgentErrors {
  private static final org.slf4j.Logger LOG =
      org.slf4j.LoggerFactory.getLogger(OntologyAgentErrors.class);

  /**
   * Callers get the reason for errors they can correct. Anything unexpected is logged here and
   * answered generically, since its text can carry table names or connection details. A real
   * dependency failure is raised explicitly as a 503 {@link AgentHttpException}.
   */
  @ExceptionHandler(Exception.class)
  public ResponseEntity<?> failure(Exception error, HttpServletRequest request) {
    boolean malformed =
        error instanceof org.springframework.http.converter.HttpMessageNotReadableException
            || error instanceof org.springframework.web.bind.ServletRequestBindingException
            || error
                instanceof
                org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
    boolean correctable =
        error instanceof IllegalArgumentException || error instanceof DslContractViolationException;
    int status =
        error instanceof AgentHttpException e
            ? e.status()
            : error instanceof ResponseStatusException e
                ? e.getStatusCode().value()
                : malformed || correctable ? 400 : 500;
    String code =
        error instanceof AgentHttpException e
            ? e.code()
            : status == 400
                ? "INVALID_REQUEST"
                : status == 401
                    ? "UNAUTHENTICATED"
                    : status == 403
                        ? "FORBIDDEN"
                        : status == 404 ? "NOT_FOUND" : "INTERNAL_ERROR";
    String message =
        error instanceof AgentHttpException e
            ? e.getMessage()
            : error instanceof ResponseStatusException e
                ? e.getReason()
                : correctable
                    ? error.getMessage()
                    : malformed ? "Invalid request" : "Internal error";
    String correlation = request.getHeader("X-Correlation-Id");
    if (correlation == null || correlation.isBlank()) correlation = UUID.randomUUID().toString();
    if (status == 500)
      LOG.error("Ontology agent request failed: {} correlationId={}", request.getRequestURI(), correlation, error);
    return ResponseEntity.status(status)
        .body(
            Map.of(
                "error",
                Map.of("code", code, "message", message == null ? code : message),
                "correlationId",
                correlation));
  }
}
