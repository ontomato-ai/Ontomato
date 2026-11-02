package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import io.ontomato.dataengine.dataAdapter.DslContractViolationException;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

class OntologyAgentErrorsTest {
  private final OntologyAgentErrors errors = new OntologyAgentErrors();

  @Test
  void correctableErrorsKeepTheirReason() {
    var dsl = new DslContractViolationException(
        DslContractViolationException.Code.INVALID_GRAMMAR, "steps[0]", "Unknown field age");
    assertEquals(400, respond(dsl).getStatusCode().value());
    assertEquals("INVALID_REQUEST", error(dsl).get("code"));
    assertEquals(dsl.getMessage(), error(dsl).get("message"));

    assertEquals("Unknown kind", error(new IllegalArgumentException("Unknown kind")).get("message"));

    var denied = new ResponseStatusException(HttpStatus.FORBIDDEN, "Field is outside the authorized scope");
    assertEquals(403, respond(denied).getStatusCode().value());
    assertEquals("Field is outside the authorized scope", error(denied).get("message"));
  }

  @Test
  void unexpectedErrorsAreInternalAndDoNotLeakTheirText() {
    var failure = new IllegalStateException("jdbc:postgresql://10.0.0.1/secret_table");
    assertEquals(500, respond(failure).getStatusCode().value());
    assertEquals("INTERNAL_ERROR", error(failure).get("code"));
    assertFalse(error(failure).get("message").contains("secret_table"));
  }

  @Test
  void explicitDependencyFailuresStay503() {
    var unavailable = new AgentHttpException(503, "DEPENDENCY_UNAVAILABLE", "Agent runtime is unavailable");
    assertEquals(503, respond(unavailable).getStatusCode().value());
    assertEquals("DEPENDENCY_UNAVAILABLE", error(unavailable).get("code"));
  }

  private ResponseEntity<?> respond(Exception failure) {
    return errors.failure(failure, new MockHttpServletRequest());
  }

  @SuppressWarnings("unchecked")
  private Map<String, String> error(Exception failure) {
    return (Map<String, String>) ((Map<String, Object>) respond(failure).getBody()).get("error");
  }
}
