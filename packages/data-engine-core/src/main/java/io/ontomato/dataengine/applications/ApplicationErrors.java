package io.ontomato.dataengine.applications;
import java.util.Map;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
/** Preserve HTTP refusal semantics for browser and gateway requests. */
@Order(org.springframework.core.Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(basePackageClasses=ApplicationController.class)
public class ApplicationErrors {
    @ExceptionHandler(Exception.class)
    public ResponseEntity<?> error(Exception error) {
        if (error instanceof ResponseStatusException refusal)
            return ResponseEntity.status(refusal.getStatusCode()).body(Map.of("message",String.valueOf(refusal.getReason())));
        if (error instanceof org.springframework.http.converter.HttpMessageNotReadableException || error instanceof IllegalArgumentException)
            return ResponseEntity.badRequest().body(Map.of("message",String.valueOf(error.getMessage())));
        LoggerFactory.getLogger(ApplicationErrors.class).error("Application request failed",error);
        return ResponseEntity.internalServerError().body(Map.of("message","Application request failed"));
    }
}
