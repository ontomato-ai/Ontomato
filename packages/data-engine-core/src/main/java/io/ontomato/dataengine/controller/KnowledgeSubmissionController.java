package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.WorkbenchServiceAuthentication;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import io.ontomato.dataengine.service.agent.PendingKnowledgeService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** User-run submissions of clarified business knowledge. */
@RestController
public class KnowledgeSubmissionController {
  private final QueryAccessService authorization;
  private final WorkbenchServiceAuthentication workbench;
  private final PendingKnowledgeService pending;

  public KnowledgeSubmissionController(QueryAccessService authorization, WorkbenchServiceAuthentication workbench, PendingKnowledgeService pending) {
    this.authorization = authorization;
    this.workbench = workbench;
    this.pending = pending;
  }

  private static String text(Map<String, Object> body, String field) {
    if (!(body.get(field) instanceof String value) || value.isBlank())
      throw AgentHttpException.invalid("Expected nonempty " + field);
    return value;
  }

  @PostMapping("/ontology/knowledge-submissions")
  public Object submit(@RequestBody Map<String, Object> body, HttpServletRequest request) {
    if (!body.keySet().equals(java.util.Set.of("title", "text", "quote", "source")))
      throw AgentHttpException.invalid("Expected title, text, quote and source");
    if (!(body.get("source") instanceof Map<?, ?> source))
      throw AgentHttpException.invalid("Expected source");
    if (!(source.get("sessionId") instanceof String sessionId) || !(source.get("runId") instanceof String runId))
      throw AgentHttpException.invalid("Expected source sessionId and runId");
    workbench.authenticate(request);
    var access = authorization.access(request);
    String title = text(body, "title"), text = text(body, "text"), quote = text(body, "quote");
    OntologyAgentStore.uuid(sessionId);
    OntologyAgentStore.uuid(runId);
    var result = pending.save(null, title, text, List.of(), access.user());
    pending.recordSubmission(result.knowledgeId(), access.user(), sessionId, runId, quote);
    return Map.of("id", result.knowledgeId(), "status", result.status(), "created", result.created());
  }
}
