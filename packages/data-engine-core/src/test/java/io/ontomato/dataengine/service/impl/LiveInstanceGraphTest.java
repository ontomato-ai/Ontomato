package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;

class LiveInstanceGraphTest {
    @Test void overviewCountsThenUsesBoundedDslAndSharesStatistics() throws Exception {
        var admin = mock(AdminService.class);
        var configs = mock(BusinessConfigService.class);
        var adapters = mock(DataAdapterRegistry.class);
        var adapter = mock(DataAdapter.class);
        var config = new BusinessConfig(); config.setDataAdapter("postgresql");
        when(configs.get("test")).thenReturn(config);
        when(admin.getJSONRule("test")).thenReturn(JSONObject.parseObject("""
             {"classDef":[{"className":"/univ_demo/org","inStarChart":false,"attrs":[
               {"name":"id","primaryKey":true},{"name":"name","bizzkey":true}]}],
              "relationship_rule":{"parent":{"fromclass":"/univ_demo/org","toclass":"/univ_demo/org","fromField":"parent_id","toField":"id"}}}
            """));
        when(adapters.create(any(), any())).thenReturn(adapter);
        List<String> dsls = new ArrayList<>();
        when(adapter.executeDsl(anyString(), anyString(), any(), anyList())).thenAnswer(call -> {
            String dslJson = call.getArgument(0);
            dsls.add(dslJson);
            JSONObject dsl = JSON.parseArray(dslJson).getJSONObject(0);
            JSONObject step = dsl.getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            boolean edge = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).containsKey("relationship");
            boolean count = "count".equals(step.getJSONObject("output").getJSONArray("fields").getJSONObject(0).getString("function"));
            JSONArray answer = new JSONArray();
            JSONObject row = new JSONObject();
            if (count) { row.put("cnt", 1); }
            else if (edge) { row.put("source", "1"); row.put("target", "1"); row.put("pk", "1"); row.put("name", "Entity"); }
            else { row.put("pk", "1"); row.put("name", "Entity"); }
            answer.add(row);
            JSONObject envelope = new JSONObject();
            envelope.put("answer", answer);
            return JSONArray.of(envelope).toJSONString();
        });
        var service = new LiveInstanceGraph(admin, configs, adapters);
        var response = service.query("summary", new JSONObject(), "test");
        assertTrue(response.getBooleanValue("success"));
        assertEquals(1, response.getJSONObject("data").getJSONArray("overviewNodes").size());
        assertEquals(1, response.getJSONObject("data").getJSONArray("overviewEdges").size());
        assertEquals(1, response.getJSONObject("data").getLongValue("nodeCount"));
        assertEquals(1, response.getJSONObject("data").getJSONArray("classes").getJSONObject(0).getIntValue("sampleCount"));
        // Counts precede bounded node and edge reads.
        JSONObject nodeStep = JSON.parseArray(dsls.get(1)).getJSONObject(0).getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
        assertEquals(1, nodeStep.getJSONObject("output").getJSONObject("limit").getIntValue("count"));
        assertEquals("/univ_demo/org", nodeStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
                .getJSONArray("objects").getJSONObject(0).getString("class"));
        JSONObject edgeStep = JSON.parseArray(dsls.get(2)).getJSONObject(0).getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
        assertEquals(2001, edgeStep.getJSONObject("output").getJSONObject("limit").getIntValue("count"));
        assertTrue(edgeStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0).containsKey("relationship"));
        assertEquals("/univ_demo/org", edgeStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
                .getJSONArray("objects").getJSONObject(1).getString("class"));
        assertEquals(1, service.query("statistics", new JSONObject(), "test").getJSONObject("data").getLongValue("nodeCount"));
        // A second overview and its statistics reuse the cached snapshot instead of querying the datasource again.
        service.query("summary", new JSONObject(), "test");
        service.query("statistics", new JSONObject(), "test");
        JSONObject search = service.query("search", JSONObject.of("class", "/univ_demo/org"), "test");
        assertTrue(search.getBooleanValue("success"), search.toJSONString());
        assertEquals("/univ_demo/org:1", search.getJSONObject("data").getJSONArray("nodes").getJSONObject(0).getString("id"));
        service.query("search", JSONObject.of("term", "Entity"), "test");
        JSONObject searchStep = JSON.parseArray(dsls.get(dsls.size() - 1)).getJSONObject(0)
                .getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
        JSONObject searchConditions = searchStep.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
                .getJSONArray("objects").getJSONObject(0).getJSONObject("conditions").getJSONObject("properties");
        // M3 needs the logic marker; without it the engine reads a leaf with no field and emits "n". null.
        assertEquals("logic", searchConditions.getString("operator"));
        assertFalse(searchConditions.getJSONArray("or").isEmpty());
        JSONObject neighborhood = service.query("neighborhood", JSONObject.of("id", "/univ_demo/org:1"), "test");
        assertTrue(neighborhood.getBooleanValue("success"), neighborhood.toJSONString());
        assertFalse(neighborhood.getJSONObject("data").getJSONArray("edges").isEmpty());
        // Neighbour reads ask only for the requested page plus one probe row per relation side.
        for (int i = dsls.size() - 2; i < dsls.size(); i++) {
            JSONObject step = JSON.parseArray(dsls.get(i)).getJSONObject(0).getJSONObject("answer")
                    .getJSONArray("steps").getJSONObject(0);
            assertEquals(101, step.getJSONObject("output").getJSONObject("limit").getIntValue("count"));
        }
        // Queries go through the generic DSL adapter, never raw JDBC.
        verify(adapter, never()).openConnection();
        assertThrows(IllegalArgumentException.class, () -> LiveInstanceGraph.identifier("entity; drop table entity"));
    }

    @Test void overviewStopsReadingRelationsOnceTheEdgeBudgetIsReached() throws Exception {
        var admin = mock(AdminService.class);
        var configs = mock(BusinessConfigService.class);
        var adapters = mock(DataAdapterRegistry.class);
        var adapter = mock(DataAdapter.class);
        when(configs.get("test")).thenReturn(new BusinessConfig());
        when(admin.getJSONRule("test")).thenReturn(JSONObject.parseObject("""
            {"classDef":[
              {"className":"A","attrs":[{"name":"id","primaryKey":true}]},
              {"className":"B","attrs":[{"name":"id","primaryKey":true}]}],
             "relationship_rule":{
               "first":{"fromclass":"A","toclass":"B"},
               "second":{"fromclass":"A","toclass":"B"}}}
            """));
        when(adapters.create(any(), any())).thenReturn(adapter);
        var edgeQueries = new java.util.concurrent.atomic.AtomicInteger();
        when(adapter.executeDsl(anyString(), anyString(), any(), anyList())).thenAnswer(call -> {
            JSONObject step = JSON.parseArray(call.getArgument(0, String.class)).getJSONObject(0)
                    .getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            JSONObject output = step.getJSONObject("output");
            JSONObject pattern = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
            JSONArray rows = new JSONArray();
            if ("count".equals(output.getJSONArray("fields").getJSONObject(0).getString("function"))) {
                rows.add(JSONObject.of("cnt", 8000));
            } else if (pattern.containsKey("relationship")) {
                edgeQueries.incrementAndGet();
                for (int i = 0; i <= 2000; i++) rows.add(JSONObject.of("source", "1", "target", "1"));
            } else {
                int limit = output.getJSONObject("limit").getIntValue("count");
                for (int i = 0; i < limit; i++) rows.add(JSONObject.of("pk", String.valueOf(i)));
            }
            return JSONArray.of(JSONObject.of("answer", rows)).toJSONString();
        });
        JSONObject result = new LiveInstanceGraph(admin, configs, adapters).query("summary", new JSONObject(), "test");
        assertTrue(result.getBooleanValue("success"), result.toJSONString());
        JSONObject data = result.getJSONObject("data");
        assertEquals(2000, data.getJSONArray("overviewEdges").size());
        assertTrue(data.getBooleanValue("overviewEdgesTruncated"));
        assertEquals(1, edgeQueries.get());
    }

    @Test void statisticsReadsManyTypesConcurrentlyAndKeepsEveryCount() throws Exception {
        var admin = mock(AdminService.class);
        var configs = mock(BusinessConfigService.class);
        var adapters = mock(DataAdapterRegistry.class);
        var adapter = mock(DataAdapter.class);
        when(configs.get("test")).thenReturn(new BusinessConfig());
        var classDefs = new JSONArray();
        for (int i = 0; i < 8; i++) {
            classDefs.add(JSONObject.of("className", "C" + i,
                    "attrs", JSONArray.of(JSONObject.of("name", "id", "primaryKey", true))));
        }
        when(admin.getJSONRule("test")).thenReturn(JSONObject.of("classDef", classDefs, "relationship_rule", new JSONObject()));
        when(adapters.create(any(), any())).thenReturn(adapter);
        when(adapter.executeDsl(anyString(), anyString(), any(), anyList())).thenAnswer(call -> {
            JSONObject step = JSON.parseArray(call.getArgument(0, String.class)).getJSONObject(0)
                    .getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            String className = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
                    .getJSONArray("objects").getJSONObject(0).getString("class");
            int value = Integer.parseInt(className.substring(1));
            return JSONArray.of(JSONObject.of("answer", JSONArray.of(JSONObject.of("cnt", 10 + value))))
                    .toJSONString();
        });
        JSONObject result = new LiveInstanceGraph(admin, configs, adapters).query("statistics", new JSONObject(), "test");
        assertTrue(result.getBooleanValue("success"), result.toJSONString());
        assertEquals(108, result.getJSONObject("data").getLongValue("nodeCount"));
        JSONArray classes = result.getJSONObject("data").getJSONArray("classes");
        assertEquals(8, classes.size());
        for (int i = 0; i < classes.size(); i++) {
            assertEquals("C" + i, classes.getJSONObject(i).getString("class"));
            assertEquals(10 + i, classes.getJSONObject(i).getIntValue("instanceCount"));
        }
    }

    @Test void overviewBatchesManyRelationsAndStillStopsAtTheEdgeBudget() throws Exception {
        var admin = mock(AdminService.class);
        var configs = mock(BusinessConfigService.class);
        var adapters = mock(DataAdapterRegistry.class);
        var adapter = mock(DataAdapter.class);
        when(configs.get("test")).thenReturn(new BusinessConfig());
        var relations = new JSONObject();
        for (int i = 0; i < 7; i++) {
            relations.put("r" + i, JSONObject.of("fromclass", "A", "toclass", "B"));
        }
        when(admin.getJSONRule("test")).thenReturn(JSONObject.of("classDef", JSONArray.of(
                JSONObject.of("className", "A", "attrs", JSONArray.of(JSONObject.of("name", "id", "primaryKey", true))),
                JSONObject.of("className", "B", "attrs", JSONArray.of(JSONObject.of("name", "id", "primaryKey", true)))),
                "relationship_rule", relations));
        when(adapters.create(any(), any())).thenReturn(adapter);
        when(adapter.executeDsl(anyString(), anyString(), any(), anyList())).thenAnswer(call -> {
            JSONObject step = JSON.parseArray(call.getArgument(0, String.class)).getJSONObject(0)
                    .getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            JSONObject output = step.getJSONObject("output");
            JSONObject pattern = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0);
            JSONArray rows = new JSONArray();
            if ("count".equals(output.getJSONArray("fields").getJSONObject(0).getString("function"))) {
                rows.add(JSONObject.of("cnt", 8000));
            } else if (pattern.containsKey("relationship")) {
                for (int i = 0; i < 400; i++) rows.add(JSONObject.of("source", String.valueOf(i), "target", String.valueOf(i)));
            } else {
                int limit = output.getJSONObject("limit").getIntValue("count");
                for (int i = 0; i < limit; i++) rows.add(JSONObject.of("pk", String.valueOf(i)));
            }
            return JSONArray.of(JSONObject.of("answer", rows)).toJSONString();
        });
        JSONObject result = new LiveInstanceGraph(admin, configs, adapters).query("summary", new JSONObject(), "test");
        assertTrue(result.getBooleanValue("success"), result.toJSONString());
        assertEquals(2000, result.getJSONObject("data").getJSONArray("overviewEdges").size());
        assertTrue(result.getJSONObject("data").getBooleanValue("overviewEdgesTruncated"));
    }

    @Test void overviewReadsProportionalQuotasAndSkipsEmptyClasses() throws Exception {
        var admin = mock(AdminService.class);
        var configs = mock(BusinessConfigService.class);
        var adapters = mock(DataAdapterRegistry.class);
        var adapter = mock(DataAdapter.class);
        when(configs.get("test")).thenReturn(new BusinessConfig());
        when(admin.getJSONRule("test")).thenReturn(JSONObject.parseObject("""
            {"classDef":[
              {"className":"A","inStarChart":true,"attrs":[{"name":"id","primaryKey":true}]},
              {"className":"B","inStarChart":false,"attrs":[{"name":"id","primaryKey":true}]},
              {"className":"Empty","attrs":[{"name":"id","primaryKey":true}]}],
             "relationship_rule":{}}
            """));
        when(adapters.create(any(), any())).thenReturn(adapter);
        var limits = new java.util.LinkedHashMap<String, Integer>();
        when(adapter.executeDsl(anyString(), anyString(), any(), anyList())).thenAnswer(call -> {
            JSONObject step = JSON.parseArray(call.getArgument(0, String.class)).getJSONObject(0)
                    .getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            String type = step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
                    .getJSONArray("objects").getJSONObject(0).getString("class");
            JSONObject output = step.getJSONObject("output");
            JSONArray rows = new JSONArray();
            if ("count".equals(output.getJSONArray("fields").getJSONObject(0).getString("function"))) {
                rows.add(JSONObject.of("cnt", type.equals("A") ? 8000 : type.equals("B") ? 2000 : 0));
            } else {
                int limit = output.getJSONObject("limit").getIntValue("count");
                limits.put(type, limit);
                for (int i = 0; i < limit; i++) rows.add(JSONObject.of("pk", String.valueOf(i)));
            }
            return JSONArray.of(JSONObject.of("answer", rows)).toJSONString();
        });
        JSONObject result = new LiveInstanceGraph(admin, configs, adapters).query("summary", new JSONObject(), "test");
        assertTrue(result.getBooleanValue("success"), result.toJSONString());
        assertEquals(java.util.Map.of("A", 400, "B", 100), limits);
        assertEquals(500, result.getJSONObject("data").getJSONArray("overviewNodes").size());
        assertEquals(10000, result.getJSONObject("data").getLongValue("nodeCount"));
        assertEquals(3, result.getJSONObject("data").getJSONArray("classes").size());
    }
}
