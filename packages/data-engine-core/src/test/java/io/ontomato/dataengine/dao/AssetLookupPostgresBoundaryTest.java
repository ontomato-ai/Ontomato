package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.test.PostgresTestDatabase;

class AssetLookupPostgresBoundaryTest extends PostgresTestDatabase {
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
