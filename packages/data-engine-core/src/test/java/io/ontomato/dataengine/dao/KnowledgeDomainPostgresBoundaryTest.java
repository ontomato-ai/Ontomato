package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.Date;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;
import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.UntitledKnowledgeTitlePrefix;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.impl.KnowledgeServiceImpl;
import io.ontomato.dataengine.service.vector.VectorRebuildTracker;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import io.ontomato.dataengine.test.PostgresTestDatabase;

class KnowledgeDomainPostgresBoundaryTest extends PostgresTestDatabase {
    @ParameterizedTest
    @ValueSource(strings = {"insert", "edit", "delete"})
    void anotherDomainCannotChangeAnExistingKnowledgeId(String operation) {
        requireVectorExtension();
        KnowledgeDao dao = wire(new KnowledgeDao());
        dao.initIndex();
        var gate = new VectorRetrievalGate();
        ReflectionTestUtils.setField(gate, "rebuildTracker", new VectorRebuildTracker());
        EmbeddingService embeddings = mock(EmbeddingService.class);
        when(embeddings.embedding(anyString(), anyString())).thenReturn(new Response<>(Embedding.from(new float[] {1, 2})));
        ReflectionTestUtils.setField(dao, "embeddingService", embeddings);
        ReflectionTestUtils.setField(dao, "retrievalGate", gate);
        dao.insertKnowledge("shared-id", "owner", "Original", "Original body", List.of("kept"), 0, 1, new Date(1000));
        var before = jdbc.queryForMap("SELECT * FROM knowledgeindex WHERE knowledge_id = 'shared-id'");
        KnowledgeServiceImpl service = new KnowledgeServiceImpl(new UntitledKnowledgeTitlePrefix("Untitled "));
        ReflectionTestUtils.setField(service, "knowledgeDao", dao);
        ReflectionTestUtils.setField(service, "auditLogDao", mock(AuditLogDao.class));
        BusinessConfigService config = mock(BusinessConfigService.class);
        when(config.get(anyString())).thenReturn(new BusinessConfig());
        ReflectionTestUtils.setField(service, "businessConfigService", config);
        ReflectionTestUtils.setField(service, "langService", mock(LangService.class));
        User outsider = mock(User.class);
        when(outsider.getDomainId()).thenReturn("other");
        assertThrows(IllegalArgumentException.class, () -> {
            switch (operation) {
                case "insert" -> service.addBussinessKnowledge("shared-id", "Changed", "Changed body", 0, List.of(), outsider);
                case "edit" -> service.editBussinessKnowledge("shared-id", "Changed", "Changed body", 0, List.of(), outsider);
                case "delete" -> service.delBussinessKnowledge("shared-id", outsider);
                default -> throw new AssertionError(operation);
            }
        });
        assertEquals(before, jdbc.queryForMap("SELECT * FROM knowledgeindex WHERE knowledge_id = 'shared-id'"));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM knowledgeindex", Integer.class));
        // The owner still has a usable record, rather than all writes having become forbidden.
        dao.insertKnowledge("shared-id", "owner", "Updated", "Updated body", List.of(), 1, 1, new Date(2000));
        assertEquals("Updated", jdbc.queryForObject("SELECT knowledge_title FROM knowledgeindex WHERE knowledge_id = 'shared-id'", String.class));
        dao.deleteKnowledge("shared-id", "owner");
        assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM knowledgeindex", Integer.class));
    }
}
