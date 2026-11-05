package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.test.util.ReflectionTestUtils;

import com.pgvector.PGvector;

import io.ontomato.dataengine.config.BusinessConfig;

/**
 * The SQL the vector state relies on, against a disposable PostgreSQL database named by
 * ONTOMATO_TEST_POSTGRES_URL (with ONTOMATO_TEST_POSTGRES_USER / _PASSWORD). Each run uses its own
 * schema and drops it; without the variable the class is skipped.
 */
@EnabledIfEnvironmentVariable(named = "ONTOMATO_TEST_POSTGRES_URL", matches = ".+")
class VectorStoragePostgresBoundaryTest extends io.ontomato.dataengine.test.PostgresTestDatabase {

    @Test
    void aWholeConfigSaveKeepsTheStoredEmbeddingConfigurationAndOnlyItsOwnerReplacesIt() {
        BusinessConfigDao dao = new BusinessConfigDao();
        ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
        dao.initIndex();
        BusinessConfig first = config("m1");
        dao.save(first, "d1");
        assertEquals("m1", dao.query("d1").getEmbeddingModelProperties().getModelName());

        BusinessConfig stale = config("m0");
        stale.setLang("en");
        dao.save(stale, "d1");
        assertEquals("m1", dao.query("d1").getEmbeddingModelProperties().getModelName());
        assertEquals("en", dao.query("d1").getLang());

        dao.saveEmbeddingModel(config("m2").getEmbeddingModelProperties(), "d1");
        assertEquals("m2", dao.query("d1").getEmbeddingModelProperties().getModelName());
        assertEquals("en", dao.query("d1").getLang());
    }

    @Test
    void aRowWhoseContentIsNullIsSeededWithTheEmbeddingConfigurationItIsGiven() {
        BusinessConfigDao dao = new BusinessConfigDao();
        ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
        dao.initIndex();
        jdbc.update("INSERT INTO business_config (id, content) VALUES ('sqlNull', NULL), ('jsonNull', 'null')");

        for (String domainId : List.of("sqlNull", "jsonNull")) {
            assertNull(dao.query(domainId));
            dao.save(config("m1"), domainId);
            assertEquals("m1", dao.query(domainId).getEmbeddingModelProperties().getModelName());
            dao.save(config("m0"), domainId);
            assertEquals("m1", dao.query(domainId).getEmbeddingModelProperties().getModelName());
        }
    }

    @Test
    void theStateRowRoundTripsAndASeedNeverOverwritesIt() {
        VectorRebuildStateDao dao = new VectorRebuildStateDao();
        ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
        dao.initIndex();
        assertNull(dao.find("d1"));
        VectorRebuildState failed = VectorRebuildState.of(config("m2").getEmbeddingModelProperties(),
                VectorRebuildState.Status.FAILED, true);
        VectorRebuildState.Failure failure = new VectorRebuildState.Failure();
        failure.setPhase(VectorRebuildState.Phase.EMBED);
        failure.setItemType(VectorRebuildState.ItemType.KNOWLEDGE);
        failure.setItemId("k1");
        failure.setReason("timeout");
        failed.setError(failure);
        dao.save("d1", failed);
        dao.insertIfAbsent("d1", VectorRebuildState.of(config("m1").getEmbeddingModelProperties(),
                VectorRebuildState.Status.READY, true));

        assertEquals(failed, dao.find("d1"));
    }

    @Test
    void aFillWritesOnlyPendingRowsAndCountsFollowThem() {
        assumeTrue(jdbc.queryForObject("SELECT COUNT(*) FROM pg_available_extensions WHERE name = 'vector'",
                Integer.class) > 0, "pgvector is not installed");
        jdbc.execute("CREATE EXTENSION IF NOT EXISTS vector");
        KnowledgeDao dao = new KnowledgeDao();
        ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
        dao.initIndex();
        jdbc.update("INSERT INTO knowledgeindex (knowledge_id, knowledge_text, domain_id, knowledge_vector) "
                + "VALUES ('k1', 'pending', 'd1', NULL), ('k2', 'rewritten', 'd1', '[9,9]'), ('o1', 'other', 'd2', NULL)");

        assertEquals(2, dao.countDomainRows("d1"));
        assertEquals(1, dao.countDomainPending("d1"));
        assertEquals(List.of("k1"), dao.listDomainPending("d1").stream().map(VectorRebuildItem::getId).toList());
        dao.fillDomainVector("k1", new float[] { 1, 1 });
        dao.fillDomainVector("k2", new float[] { 2, 2 });

        assertEquals(0, dao.countDomainPending("d1"));
        assertArrayEquals(new float[] { 9, 9 }, vectorOf("k2"));
        assertArrayEquals(new float[] { 1, 1 }, vectorOf("k1"));
        dao.clearDomainVectors("d1");
        assertEquals(2, dao.countDomainPending("d1"));
        assertFalse(dao.listDomainPending("d2").isEmpty());
    }

    @Test
    void configurationAndStateRollBackTogetherWhenEitherStoreRejectsTheNewGeneration() {
        BusinessConfigDao configs = wire(new BusinessConfigDao());
        VectorRebuildStateDao states = wire(new VectorRebuildStateDao());
        configs.initIndex();
        states.initIndex();
        var business = new io.ontomato.dataengine.service.impl.BusinessConfigServiceImpl();
        ReflectionTestUtils.setField(business, "businessConfigDao", configs);
        var tracker = new io.ontomato.dataengine.service.vector.VectorRebuildTracker();
        var gate = new io.ontomato.dataengine.service.vector.VectorRetrievalGate();
        ReflectionTestUtils.setField(gate, "stateDao", states);
        var service = new io.ontomato.dataengine.service.vector.VectorRebuildService();
        ReflectionTestUtils.setField(service, "businessConfigService", business);
        ReflectionTestUtils.setField(service, "stateDao", states);
        ReflectionTestUtils.setField(service, "retrievalGate", gate);
        ReflectionTestUtils.setField(service, "rebuildTracker", tracker);
        ReflectionTestUtils.setField(service, "transactions", new org.springframework.transaction.support.TransactionTemplate(
                new org.springframework.jdbc.datasource.DataSourceTransactionManager(dataSource)));
        // Data inventory is outside this transaction; its existing row requires a pending generation after a successful save.
        KnowledgeDao inventory = org.mockito.Mockito.mock(KnowledgeDao.class);
        org.mockito.Mockito.when(inventory.countDomainRows("d1")).thenReturn(1);
        ReflectionTestUtils.setField(service, "knowledgeDao", inventory);
        ReflectionTestUtils.setField(service, "bussinessExampleDao", org.mockito.Mockito.mock(BussinessExampleDao.class));
        ReflectionTestUtils.setField(service, "questionSpliterDao", org.mockito.Mockito.mock(BusinessExampleQuestionSpliterDao.class));
        ReflectionTestUtils.setField(service, "actionDao", org.mockito.Mockito.mock(ActionDao.class));
        ReflectionTestUtils.setField(service, "metricViewDao", org.mockito.Mockito.mock(MetricViewDao.class));
        ReflectionTestUtils.setField(service, "vectorResourceDao", org.mockito.Mockito.mock(VectorResourceDao.class));
        var oldState = VectorRebuildState.of(config("m1").getEmbeddingModelProperties(), VectorRebuildState.Status.READY, true);
        for (String table : List.of("business_config", "vector_rebuild_state")) {
            configs.save(config("m1"), "d1");
            configs.saveEmbeddingModel(config("m1").getEmbeddingModelProperties(), "d1");
            states.save("d1", oldState);
            String before = jdbc.queryForObject("SELECT content FROM business_config WHERE id = 'd1'", String.class);
            String model = table.equals("business_config") ? "content::jsonb->'embeddingModelProperties'->>'modelName'" : "model_name";
            jdbc.execute("ALTER TABLE " + table + " ADD CONSTRAINT reject_generation CHECK ((" + model + ") <> 'm2')");
            try {
                org.junit.jupiter.api.Assertions.assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                        () -> service.saveEmbeddingModel("d1", "en", config("m2").getEmbeddingModelProperties()));
                assertEquals(before, jdbc.queryForObject("SELECT content FROM business_config WHERE id = 'd1'", String.class));
                assertEquals(oldState, wire(new VectorRebuildStateDao()).find("d1"));
                assertEquals("m1", wire(new BusinessConfigDao()).query("d1").getEmbeddingModelProperties().getModelName());
            } finally {
                jdbc.execute("ALTER TABLE " + table + " DROP CONSTRAINT reject_generation");
            }
            service.saveEmbeddingModel("d1", "en", config("m2").getEmbeddingModelProperties());
            assertEquals("m2", configs.query("d1").getEmbeddingModelProperties().getModelName());
            assertEquals("m2", states.find("d1").getModelName());
            assertEquals(VectorRebuildState.Status.PENDING, states.find("d1").getStatus());
        }
    }

    private float[] vectorOf(String id) {
        return jdbc.queryForObject("SELECT knowledge_vector FROM knowledgeindex WHERE knowledge_id = ?",
                (rs, rowNum) -> new PGvector(rs.getString(1)).toArray(), id);
    }

    private static BusinessConfig config(String modelName) {
        BusinessConfig businessConfig = new BusinessConfig();
        BusinessConfig.EmbeddingModelProperties properties = businessConfig.new EmbeddingModelProperties();
        properties.setBaseUrl("http://emb/v1");
        properties.setModelName(modelName);
        properties.setDimensions(2);
        businessConfig.setModels(new java.util.ArrayList<>());
        businessConfig.setEmbeddingModelProperties(properties);
        return businessConfig;
    }

}
