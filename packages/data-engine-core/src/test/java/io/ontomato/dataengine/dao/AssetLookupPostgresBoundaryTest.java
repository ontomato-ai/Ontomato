package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.alibaba.fastjson2.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import io.ontomato.dataengine.test.PostgresTestDatabase;

class AssetLookupPostgresBoundaryTest extends PostgresTestDatabase {
    @Test
    void bindingNamesKeepLongQuestionsAfterUpgradingTheOldNameColumn() {
        requireVectorExtension();
        MetricViewDao views = wire(new MetricViewDao());
        ReflectionTestUtils.setField(views, "assetLookupPolicy", (AssetLookupPolicy) (connection, table) -> true);
        var embedding = mock(EmbeddingService.class);
        when(embedding.embedding(anyString(), eq("d1"))).thenReturn(new float[] {1, 0});
        ReflectionTestUtils.setField(views, "embeddingService", embedding);
        var gate = mock(VectorRetrievalGate.class);
        when(gate.write(eq("d1"), any())).thenAnswer(call -> ((Supplier<?>) call.getArgument(1)).get());
        ReflectionTestUtils.setField(views, "retrievalGate", gate);
        views.initIndex();
        var function = new Function();
        function.setId("f1"); function.setDomainId("d1"); function.setParameters(List.of());
        var metric = new MetricView();
        metric.setName("Published metric"); metric.setDomainId("d1"); metric.setFunction(function);
        metric.setStatus(MetricView.STATUS_PUBLISHED); metric.setMatchQuestions(Set.of());
        var existing = new MetricViewBinding();
        existing.setName("Existing binding"); existing.setParameters(new JSONObject()); existing.setMatchQuestions(Set.of());
        metric.setBindings(new ArrayList<>(List.of(existing)));
        views.save(metric);
        jdbc.execute("ALTER TABLE metric_view_binding ALTER COLUMN name TYPE VARCHAR(255)");
        views.initIndex();
        String question = "Execute the published metric exactly as defined. ".repeat(8);
        var added = new MetricViewBinding();
        added.setName(question); added.setParameters(new JSONObject()); added.setMatchQuestions(Set.of(question));
        metric.getBindings().add(added);
        views.save(metric);
        var stored = (MetricView) views.queryById(metric.getId(), "d1")[0];
        assertEquals(2, stored.getBindings().size());
        assertEquals(question, stored.getBindings().stream().filter(b -> b.getId().equals(added.getId())).findFirst().orElseThrow().getName());
        assertEquals("Existing binding", stored.getBindings().stream().filter(b -> b.getId().equals(existing.getId())).findFirst().orElseThrow().getName());
    }

    @Test
    void lookupsMapStoredRowsAndKeepDomainFiltersWithMissingTablesReturningNoAssets() {
        requireVectorExtension();
        ActionDao actions = wire(new ActionDao());
        MetricViewDao views = wire(new MetricViewDao());
        AssetLookupPolicy allow = (connection, table) -> true;
        ReflectionTestUtils.setField(actions, "assetLookupPolicy", allow);
        ReflectionTestUtils.setField(views, "assetLookupPolicy", allow);
        actions.initIndex(); views.initIndex();
        for (String table : List.of("action", "metric_view")) {
            jdbc.update("INSERT INTO " + table + " (id,name,function_id,domain_id) VALUES ('a','First','f1','d1'),('b','Other','f2','d2')");
        }
        jdbc.update("INSERT INTO metric_view_binding(id,metric_view_id,name,parameters) VALUES('bound-a','a','First binding','{\"amount\":0,\"optional\":null}'::jsonb)");
        assertNull(views.queryById("a", "d2"));
        views.delete("a", "d2");
        Object[] action = actions.queryById("a");
        assertEquals("First", ((Action) action[0]).getName());
        assertEquals("f1", action[1]);
        assertEquals(List.of("a"), actions.queryList(null, null, null, "d1").stream().map(row -> ((Action) row[0]).getId()).toList());
        Object[] view = views.queryById("a", "d1");
        assertEquals("First", ((MetricView) view[0]).getName());
        assertEquals("f1", view[1]);
        assertEquals(0, ((MetricView) view[0]).getBindings().get(0).getParameters().getIntValue("amount"));
        assertTrue(((MetricView) view[0]).getBindings().get(0).getParameters().containsKey("optional"));
        assertEquals(List.of("b"), views.queryList(null, null, null, "d2").stream().map(row -> ((MetricView) row[0]).getId()).toList());
        assertNull(actions.queryById("missing"));
        assertNull(views.queryById("missing", "d1"));
        AssetLookupPolicy deny = (connection, table) -> false;
        ReflectionTestUtils.setField(actions, "assetLookupPolicy", deny);
        ReflectionTestUtils.setField(views, "assetLookupPolicy", deny);
        assertNull(actions.queryById("a"));
        assertTrue(actions.queryList(null, null, null, "d1").isEmpty());
        assertNull(views.queryById("a", "d1"));
        assertTrue(views.queryList(null, null, null, "d2").isEmpty());
        ReflectionTestUtils.setField(actions, "assetLookupPolicy", allow);
        ReflectionTestUtils.setField(views, "assetLookupPolicy", allow);
        views.delete("a", "d1");
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM metric_view_binding WHERE metric_view_id='a'", Integer.class));
        jdbc.execute("DROP TABLE action"); jdbc.execute("DROP TABLE metric_view CASCADE");
        assertNull(actions.queryById("a"));
        assertTrue(actions.queryList(null, null, null, "d1").isEmpty());
        assertNull(views.queryById("a", "d1"));
        assertTrue(views.queryList(null, null, null, "d1").isEmpty());
    }
}
