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
import org.springframework.transaction.support.TransactionCallback;

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
        verify(runtime,times(2)).json(eq("d"),anyString(),eq("/v1/models/import-embedding"),eq("POST"),input.capture(),isNull());
        assertEquals(45000,((JSONObject)input.getValue()).getLongValue("timeoutMs"));
        verify(jdbc).update(startsWith("UPDATE vector_rebuild_state SET model_ref"),eq("https://gateway/v1"),eq("embed"),eq("gateway/embed"),eq("d"));
        verify(jdbc).update(startsWith("UPDATE business_config SET content="),eq("d"),eq(old.toJSONString()));
        verify(vectors).modelSettingsChanged("d");
        migration.stop();
    }
}
