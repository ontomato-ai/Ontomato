package io.ontomato.dataengine.service.agent;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dao.VectorRebuildStateDao;
import io.ontomato.dataengine.service.vector.VectorRebuildService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.Arguments;
import java.util.stream.Stream;
import java.util.UUID;
import com.alibaba.fastjson2.JSONWriter;

class ModelConfigurationMigrationTest {
    @Test void missingReferencesRemainExplicitAndLegacyNamesMayContainSlashes() {
        var mapping = JSONObject.parseObject("{\"references\":{\"main\":\"gateway/chat\"},\"unconfiguredProviderId\":\"legacy\"}");
        assertEquals("gateway/chat", ModelConfigurationMigration.rewrite("main", mapping));
        assertEquals("legacy/gone", ModelConfigurationMigration.rewrite("gone", mapping));
        mapping.getJSONObject("references").put("old/name", "gateway/slashed");
        assertEquals("gateway/slashed", ModelConfigurationMigration.rewrite("old/name", mapping));
        assertNull(ModelConfigurationMigration.rewrite(null, mapping));
    }
    @Test void oldEmbeddingIsRemovedOnlyAfterRuntimeAcknowledgementAndOldVectorIdentityIsTranslated() throws Exception {
        var jdbc = mock(JdbcTemplate.class); var runtime = mock(AgentRuntimeClient.class);
        var vectors = mock(VectorRebuildService.class); var tx = mock(TransactionTemplate.class);
        doAnswer(call -> { ((java.util.function.Consumer<org.springframework.transaction.TransactionStatus>) call.getArgument(0)).accept(null); return null; })
            .when(tx).executeWithoutResult(any());
        var migration = new ModelConfigurationMigration(jdbc,runtime,vectors,tx,mock(VectorRebuildStateDao.class));
        var old = JSONObject.parseObject("{\"baseUrl\":\"https://gateway/v1\",\"apiKey\":\"old-key\",\"modelName\":\"embed\",\"dimensions\":2,\"timeout\":\"PT45S\"}");
        var config = JSONObject.of("embeddingModelProperties",old,"embeddingVectorSource",JSONObject.of("baseUrl","https://gateway/v1","modelName","embed","dimensions",2));
        when(jdbc.queryForList(startsWith("SELECT content"),eq("d"))).thenReturn(List.of(Map.of("content",config.toJSONString())));
        when(runtime.json(eq("d"),anyString(),eq("/v1/models/import-embedding"),eq("POST"),any(),isNull()))
            .thenThrow(new java.io.IOException("offline"))
            .thenReturn(JSONObject.of("importedModelId","gateway/embed","embeddingModelId","gateway/embed"));
        assertThrows(java.io.IOException.class, () -> migration.migrateDomain("d"));
        verifyNoInteractions(tx);
        when(runtime.json(eq("d"),anyString(),eq("/v1/models/migration-map"),eq("GET"),isNull(),isNull()))
            .thenReturn(JSONObject.parseObject("{\"references\":{\"main\":\"gateway/chat\"},\"unconfiguredProviderId\":\"legacy\"}"));
        when(runtime.json(eq("d"),anyString(),eq("/v1/models/options"),eq("GET"),isNull(),isNull()))
            .thenReturn(JSONObject.of("embeddingModelId","gateway/embed"));
        migration.migrateDomain("d");
        var input = org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(runtime,atLeastOnce()).json(eq("d"),anyString(),eq("/v1/models/import-embedding"),eq("POST"),input.capture(),isNull());
        assertEquals(45000,((JSONObject)input.getValue()).getLongValue("timeoutMs"));
        verify(jdbc).update(startsWith("UPDATE vector_rebuild_state SET model_ref"),eq("https://gateway/v1"),eq("embed"),eq("gateway/embed"),eq("d"));
        verify(jdbc).update(startsWith("UPDATE business_config SET content="),eq("d"),eq(old.toJSONString()));
        verify(vectors).modelSettingsChanged("d");
        migration.stop();
    }
    static Stream<Arguments> unconfiguredFields() {
        return Stream.of("baseUrl", "modelName", "apiKey")
            .flatMap(field -> Stream.of(null, "", " \t ").map(value -> Arguments.of(field, value)));
    }

    @ParameterizedTest
    @MethodSource("unconfiguredFields")
    void unconfiguredEmbeddingIsRemovedWithoutImportOrVectorChanges(String field, String value) throws Exception {
        try (var db = new MigrationDatabase()) {
            JSONObject old = oldEmbedding(); old.put(field, value);
            db.seed(old);
            db.migration.migrateDomain("d");
            JSONObject config = db.config();
            assertFalse(config.containsKey("embeddingModelProperties"));
            assertFalse(config.containsKey("embeddingVectorSource"));
            assertEquals("keep", config.getString("unrelated"));
            assertEquals("existing/vector", db.jdbc.queryForObject("SELECT model_ref FROM vector_rebuild_state WHERE domain_id='d'", String.class));
            db.assertSelectionMigrated();
            verify(db.runtime, never()).json(anyString(), anyString(), eq("/v1/models/import-embedding"), anyString(), any(), any());
            verifyNoInteractions(db.vectors);
        }
    }

    @ParameterizedTest
    @ValueSource(ints = {400, 422, 429})
    void rejectedImportKeepsLegacyDataAndDoesNotRetryWhenAnotherStepNeedsRetry(int status) throws Exception {
        try (var db = new MigrationDatabase()) {
            db.seed(oldEmbedding());
            JSONObject before = db.config();
            when(db.runtime.json(eq("d"), anyString(), eq("/v1/models/import-embedding"), eq("POST"), any(), isNull()))
                .thenThrow(new AgentHttpException(status, "INVALID_REQUEST", "Do not log old-key"));
            when(db.runtime.json(eq("d"), anyString(), eq("/v1/models/migration-map"), eq("GET"), isNull(), isNull()))
                .thenThrow(new AgentHttpException(503, "DEPENDENCY_UNAVAILABLE", "offline"))
                .thenReturn(JSONObject.parseObject("{\"references\":{},\"unconfiguredProviderId\":\"legacy\"}"));
            assertThrows(AgentHttpException.class, () -> db.migration.migrateDomain("d"));
            db.migration.migrateDomain("d");
            db.migration.migrateDomain("d");
            assertEquals(before, db.config());
            assertEquals("existing/vector", db.jdbc.queryForObject("SELECT model_ref FROM vector_rebuild_state WHERE domain_id='d'", String.class));
            db.assertSelectionMigrated();
            verify(db.runtime, times(1)).json(eq("d"), anyString(), eq("/v1/models/import-embedding"), eq("POST"), any(), isNull());
        }
    }

    @Test void serverFailureRemainsRetryableAndDeletesLegacyDataOnlyAfterSuccess() throws Exception {
        try (var db = new MigrationDatabase()) {
            db.seed(oldEmbedding());
            JSONObject before = db.config();
            when(db.runtime.json(eq("d"), anyString(), eq("/v1/models/import-embedding"), eq("POST"), any(), isNull()))
                .thenThrow(new AgentHttpException(503, "DEPENDENCY_UNAVAILABLE", "offline"))
                .thenReturn(JSONObject.of("importedModelId", "gateway/embed", "embeddingModelId", "gateway/embed"));
            assertThrows(AgentHttpException.class, () -> db.migration.migrateDomain("d"));
            assertEquals(before, db.config());
            db.migration.migrateDomain("d");
            assertFalse(db.config().containsKey("embeddingModelProperties"));
            db.assertSelectionMigrated();
            verify(db.runtime, times(2)).json(eq("d"), anyString(), eq("/v1/models/import-embedding"), eq("POST"), any(), isNull());
        }
    }

    private static JSONObject oldEmbedding() {
        return JSONObject.parseObject("{\"baseUrl\":\"https://gateway/v1\",\"apiKey\":\"old-key\",\"modelName\":\"embed\",\"dimensions\":2048,\"timeout\":\"PT5M\",\"customHeaders\":null}");
    }

    /** Each case owns an isolated schema in the controller-provided disposable PostgreSQL database. */
    private static class MigrationDatabase implements AutoCloseable {
        final String schema = "model_migration_" + UUID.randomUUID().toString().replace("-", "");
        final JdbcTemplate admin;
        final JdbcTemplate jdbc;
        final AgentRuntimeClient runtime = mock(AgentRuntimeClient.class);
        final VectorRebuildService vectors = mock(VectorRebuildService.class);
        final ModelConfigurationMigration migration;
        MigrationDatabase() throws Exception {
            String url = System.getenv("ONTOMATO_TEST_POSTGRES_URL");
            org.junit.jupiter.api.Assumptions.assumeTrue(url != null, "Set ONTOMATO_TEST_POSTGRES_URL to a disposable PostgreSQL database");
            String user = System.getenv("ONTOMATO_TEST_POSTGRES_USER"), password = System.getenv("ONTOMATO_TEST_POSTGRES_PASSWORD");
            admin = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
            admin.execute("CREATE SCHEMA " + schema);
            var source = new DriverManagerDataSource(url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema, user, password);
            jdbc = new JdbcTemplate(source);
            jdbc.execute("CREATE TABLE business_config (id text PRIMARY KEY, content text)");
            jdbc.execute("CREATE TABLE ontology_agent_settings (domain_id text, agent_id uuid, model_selection jsonb, model_reference_migrated boolean DEFAULT false)");
            jdbc.execute("CREATE TABLE vector_rebuild_state (domain_id text PRIMARY KEY, model_ref text, base_url text, model_name text, dimensions integer, status text, cleared boolean)");
            migration = new ModelConfigurationMigration(jdbc, runtime, vectors, new TransactionTemplate(new DataSourceTransactionManager(source)), mock(VectorRebuildStateDao.class));
            when(runtime.json(eq("d"), anyString(), eq("/v1/models/migration-map"), eq("GET"), isNull(), isNull()))
                .thenReturn(JSONObject.parseObject("{\"references\":{},\"unconfiguredProviderId\":\"legacy\"}"));
            when(runtime.json(eq("d"), anyString(), eq("/v1/models/options"), eq("GET"), isNull(), isNull()))
                .thenReturn(JSONObject.of("embeddingModelId", null));
        }
        void seed(JSONObject old) {
            JSONObject config = JSONObject.of("embeddingModelProperties", old, "embeddingVectorSource", JSONObject.of("dimensions", 2048), "unrelated", "keep");
            jdbc.update("INSERT INTO business_config VALUES('d', ?)", config.toJSONString(JSONWriter.Feature.WriteMapNullValue));
            jdbc.update("INSERT INTO ontology_agent_settings VALUES('d', ?::uuid, '{\"modelId\":\"alt2\"}', false)", UUID.randomUUID().toString());
            jdbc.update("INSERT INTO vector_rebuild_state (domain_id,model_ref) VALUES('d','existing/vector')");
        }
        JSONObject config() { return JSONObject.parseObject(jdbc.queryForObject("SELECT content FROM business_config WHERE id='d'", String.class)); }
        void assertSelectionMigrated() {
            assertEquals("legacy/alt2", jdbc.queryForObject("SELECT model_selection->>'modelId' FROM ontology_agent_settings WHERE domain_id='d'", String.class));
            assertEquals(Boolean.TRUE, jdbc.queryForObject("SELECT model_reference_migrated FROM ontology_agent_settings WHERE domain_id='d'", Boolean.class));
        }
        @Override public void close() { migration.stop(); admin.execute("DROP SCHEMA " + schema + " CASCADE"); }
    }

}
