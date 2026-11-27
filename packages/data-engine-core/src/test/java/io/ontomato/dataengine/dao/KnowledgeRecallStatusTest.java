package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class KnowledgeRecallStatusTest {
  @Test
  void ordinaryRecallReadsOnlyApprovedEntries() {
    var dao = new KnowledgeDao();
    var jdbc = mock(JdbcTemplate.class);
    var embedding = mock(EmbeddingService.class);
    var gate = mock(VectorRetrievalGate.class);
    ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
    ReflectionTestUtils.setField(dao, "embeddingService", embedding);
    ReflectionTestUtils.setField(dao, "retrievalGate", gate);
    when(embedding.embedding("question", "domain")).thenReturn(new float[] { 1f });
    when(gate.read(eq("domain"), any())).thenAnswer(call -> call.getArgument(1, java.util.function.Supplier.class).get());
    when(jdbc.query(anyString(), any(org.springframework.jdbc.core.RowMapper.class), any(), any(), any())).thenReturn(List.of());

    dao.findKnowledge("question", 10, "domain");

    var sql = ArgumentCaptor.forClass(String.class);
    verify(jdbc).query(sql.capture(), any(org.springframework.jdbc.core.RowMapper.class), any(), any(), any());
    assertTrue(sql.getValue().contains("WHERE status = 1 AND domain_id = ?"));
    assertFalse(sql.getValue().contains("status = 0"));
  }
}
