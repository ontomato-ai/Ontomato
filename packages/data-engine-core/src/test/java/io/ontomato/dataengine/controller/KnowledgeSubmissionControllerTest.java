package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.PendingKnowledgeService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class KnowledgeSubmissionControllerTest {
  @Test
  void submitUsesOrdinaryQueryAccessAndOnlyCreatesPendingKnowledge() {
    var authorization = mock(QueryAccessService.class);
    var pending = mock(PendingKnowledgeService.class);
    var user = new QueryAccessService.GrantUser("executor", "domain");
    when(authorization.access(any(HttpServletRequest.class)))
        .thenReturn(new QueryAccessService.Access(user, null, null, null, null));
    when(pending.submit(eq("Title"), eq("Text"), argThat(actor -> actor.getId().equals("executor")),
        eq("11111111-1111-4111-8111-111111111111"), eq("22222222-2222-4222-8222-222222222222"), eq("the user's words")))
        .thenReturn(new PendingKnowledgeService.Result("knowledge_1", true, 0));
    var controller = new KnowledgeSubmissionController(authorization, mock(io.ontomato.dataengine.service.WorkbenchServiceAuthentication.class), pending);
    var result = (Map<?, ?>) controller.submit(Map.of(
        "title", "Title", "text", "Text", "quote", "the user's words",
        "source", Map.of("sessionId", "11111111-1111-4111-8111-111111111111",
            "runId", "22222222-2222-4222-8222-222222222222")), mock(HttpServletRequest.class));
    assertEquals("knowledge_1", result.get("id"));
    assertEquals(0, result.get("status"));
    assertEquals(true, result.get("created"));
    verify(pending).submit(eq("Title"), eq("Text"), argThat(actor -> actor.getId().equals("executor")),
        eq("11111111-1111-4111-8111-111111111111"), eq("22222222-2222-4222-8222-222222222222"), eq("the user's words"));
    verify(pending, never()).save(any(), any(), any(), any(), any());
  }

  @Test
  void submissionInputCannotCarryAnApprovalDecisionOrKnowledgeId() {
    var controller = new KnowledgeSubmissionController(mock(QueryAccessService.class), mock(io.ontomato.dataengine.service.WorkbenchServiceAuthentication.class), mock(PendingKnowledgeService.class));
    var refusal = assertThrows(AgentHttpException.class, () -> controller.submit(Map.of(
        "id", "existing", "title", "Title", "text", "Text", "quote", "quote", "status", 1,
        "source", Map.of("sessionId", "11111111-1111-4111-8111-111111111111",
            "runId", "22222222-2222-4222-8222-222222222222")), mock(HttpServletRequest.class)));
    assertEquals(400, refusal.status());
  }
}
