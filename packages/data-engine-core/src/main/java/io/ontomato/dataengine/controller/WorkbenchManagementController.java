package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@Owned
public class WorkbenchManagementController {
    public static final String PATH = "/internal/workbench-management/require";

    private final WorkbenchServiceAuthentication workbench;
    private final ManagementOperations operations;
    private final ManagementRequestAccess management;

    public WorkbenchManagementController(WorkbenchServiceAuthentication workbench,
            ManagementOperations operations, ManagementRequestAccess management) {
        this.workbench = workbench;
        this.operations = operations;
        this.management = management;
    }

    @PostMapping(PATH)
    @Owned
    public ResponseEntity<?> require(HttpServletRequest request, @RequestBody Map<String, Object> body) {
        try {
            workbench.authenticate(request);
        } catch (ResponseStatusException refusal) {
            return ResponseEntity.status(refusal.getStatusCode()).body(Map.of("error", Map.of(
                "code", "WORKBENCH_SERVICE_REQUIRED", "message", refusal.getReason())));
        }
        if (body.size() != 2 || !(body.get("operationId") instanceof String operationId) || operationId.isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a management operation ID");
        if (!(body.get("domainId") instanceof String domainId) || domainId.isBlank())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected the request's business domain");
        try {
            operations.require(operationId);
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage(), error);
        }
        var user = management.require(operationId);
        if (!domainId.equals(user.getDomainId()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "The user's business domain changed");
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> invalidBody() {
        return ResponseEntity.badRequest().body(Map.of("message", "Expected a management operation request"));
    }
}
