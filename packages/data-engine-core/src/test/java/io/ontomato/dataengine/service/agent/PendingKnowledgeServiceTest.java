package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.QueryAccessService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PendingKnowledgeServiceTest {
  private final KnowledgeService knowledge = mock(KnowledgeService.class);
  private final OntologyAgentStore store = mock(OntologyAgentStore.class);
  private final PendingKnowledgeService service = new PendingKnowledgeService(knowledge, store);
  private final QueryAccessService.GrantUser user = new QueryAccessService.GrantUser("user", "domain");

  private KnowledgeEntity entry(String id, String title, String text, int status) {
    var entry = new KnowledgeEntity();
    entry.setKnowledgeID(id); entry.setKnowledgeTitle(title); entry.setKnowledgeText(text); entry.setStatus(status);
    return entry;
  }

  @Test void createsOnlyPendingEntriesAndRecordsSubmissionSource() {
    when(knowledge.getBussinessKnowledge("domain")).thenReturn(Map.of());
    when(knowledge.addBussinessKnowledge(null, "Faculty level", "Faculty means school level", 0, List.of(), user)).thenReturn("knowledge_1");
    var result = service.save(null, "Faculty level", "Faculty means school level", List.of(), user);
    assertTrue(result.created()); assertEquals(0, result.status()); assertEquals("knowledge_1", result.knowledgeId());
    service.recordSubmission(result.knowledgeId(), user, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "学院算到学校这一级");
    verify(store).recordKnowledgeSubmission("knowledge_1", user, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "学院算到学校这一级");
    verify(knowledge).addBussinessKnowledge(null, "Faculty level", "Faculty means school level", 0, List.of(), user);
  }

  @Test void normalizedDuplicateContentReusesExistingPendingEntry() {
    when(knowledge.getBussinessKnowledge("domain")).thenReturn(Map.of("old", entry("old", "Other title", "  Faculty   means\nschool level ", 0)));
    var result = service.save(null, "Faculty level", "faculty means school level", List.of(), user);
    assertFalse(result.created()); assertEquals("old", result.knowledgeId()); assertEquals(0, result.status());
    verify(knowledge, never()).addBussinessKnowledge(any(), any(), any(), anyInt(), any(), any());
  }

  @Test void requestedIdWithDifferentContentIsRefused() {
    when(knowledge.getBussinessKnowledge("domain")).thenReturn(Map.of("same", entry("same", "Old", "Old text", 1)));
    var refusal = assertThrows(AgentHttpException.class, () -> service.save("same", "New", "Other text", List.of(), user));
    assertEquals(409, refusal.status());
    verify(knowledge, never()).addBussinessKnowledge(any(), any(), any(), anyInt(), any(), any());
  }
}
