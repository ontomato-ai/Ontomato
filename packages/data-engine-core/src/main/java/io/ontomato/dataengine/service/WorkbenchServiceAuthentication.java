package io.ontomato.dataengine.service;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** The existing shared credential identifies the built-in workbench, never an arbitrary application. */
@Component
public class WorkbenchServiceAuthentication {
  public static final String HEADER = "X-Ontomato-Query-Service-Token";
  private final String token;

  public WorkbenchServiceAuthentication(@Value("${ONTOMATO_QUERY_SERVICE_TOKEN:}") String token) {
    this.token = token;
  }

  public String authenticate(HttpServletRequest request) {
    String supplied = request.getHeader(HEADER);
    if (token.isBlank() || supplied == null || !MessageDigest.isEqual(
        token.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Workbench service authorization is required");
    }
    return "workbench";
  }
}
