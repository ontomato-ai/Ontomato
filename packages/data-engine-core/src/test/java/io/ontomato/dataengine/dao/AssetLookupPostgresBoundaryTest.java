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
        Object[] action = actions.queryById("a");
        assertEquals("First", ((Action) action[0]).getName());
        assertEquals("f1", action[1]);
        assertEquals(List.of("a"), actions.queryList(null, null, null, "d1").stream().map(row -> ((Action) row[0]).getId()).toList());
        Object[] view = views.queryById("a");
        assertEquals("First", ((MetricView) view[0]).getName());
        assertEquals("f1", view[1]);
        assertEquals(List.of("b"), views.queryList(null, null, null, null, "d2").stream().map(row -> ((MetricView) row[0]).getId()).toList());
        assertNull(actions.queryById("missing"));
        assertNull(views.queryById("missing"));
        AssetLookupPolicy deny = (connection, table) -> false;
        ReflectionTestUtils.setField(actions, "assetLookupPolicy", deny);
        ReflectionTestUtils.setField(views, "assetLookupPolicy", deny);
        assertNull(actions.queryById("a"));
        assertTrue(actions.queryList(null, null, null, "d1").isEmpty());
        assertNull(views.queryById("a"));
        assertTrue(views.queryList(null, null, null, null, "d2").isEmpty());
        ReflectionTestUtils.setField(actions, "assetLookupPolicy", allow);
        ReflectionTestUtils.setField(views, "assetLookupPolicy", allow);
        jdbc.execute("DROP TABLE action"); jdbc.execute("DROP TABLE metric_view");
        assertNull(actions.queryById("a"));
        assertTrue(actions.queryList(null, null, null, "d1").isEmpty());
        assertNull(views.queryById("a"));
        assertTrue(views.queryList(null, null, null, null, "d1").isEmpty());
    }
}
