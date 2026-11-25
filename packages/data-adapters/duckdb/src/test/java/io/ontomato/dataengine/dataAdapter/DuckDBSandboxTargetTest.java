package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSONArray;
import io.ontomato.dataengine.config.DataRagConfig;
import com.alibaba.fastjson2.JSONObject;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DuckDBSandboxTargetTest {
    @TempDir Path directory;

    @Test
    void createsUsesAndDeletesShortMappedTablesWithReservedColumns() throws Exception {
        String chinese = "期中检查材料提交记录复核归档表";
        String hyphenated = "e2e-expense";
        var connection = new DataAdapterConnection();
        connection.put("url", "jdbc:duckdb:" + directory.resolve("sandbox.db"));
        var attrs = new JSONArray();
        attrs.add(JSONObject.of("name", "order", "type", "int", "primaryKey", true));
        for (String type : List.of("varchar", "text", "long", "float", "double", "boolean",
                "date", "timestamp", "datetime", "vector")) {
            attrs.add(JSONObject.of("name", "value_" + type, "type", type));
        }
        var definition = JSONObject.of("className", chinese, "attrs", attrs);
        var other = JSONObject.of("className", hyphenated, "attrs", attrs);
        var rule = JSONObject.of("classDef", JSONArray.of(definition, other), "relationship_rule", new JSONObject());
        var target = new SandboxTarget("id", "dep001", "abcdefgh",
                Map.of(chinese, "ot_sb_dep001_abcdefgh_c01", hyphenated, "ot_sb_dep001_abcdefgh_c02"),
                Map.of(), Map.of());
        var adapter = new DuckDBAdapter(connection, rule).forSandbox(target);
        assertTrue(adapter.supportsWriteActions());
        assertTrue(adapter.supportsSandbox());
        var first = adapter.createRecordedClass(target.namespace(), definition);
        var second = adapter.createRecordedClass(target.namespace(), other);
        assertEquals(target.classTable(chinese), first.getString("name"));
        assertEquals(target.classTable(hyphenated), second.getString("name"));
        var where = JSONObject.of("field", "order", "operator", "=", "value", 17);
        adapter.insertObjects(target.namespace(), definition, JSONArray.of(JSONObject.of("order", 17)));
        adapter.updateObjects(target.namespace(), definition, JSONObject.of("value_varchar", "written"), where);
        try (var jdbc = adapter.openConnection(); var statement = jdbc.createStatement();
                var rows = statement.executeQuery("""
                    SELECT "order", value_varchar FROM ot_sb_dep001_abcdefgh_c01
                    """)) {
            assertTrue(rows.next());
            assertEquals(17, rows.getInt(1));
            assertEquals("written", rows.getString(2));
        }
        var config = new DataRagConfig();
        config.setDslMightTimeFormats(new String[0]);
        var result = new JSONObject(adapter.query(JSONObject.parseObject("""
            {"answer":{"steps":[
              {"graph":{"patterns":[{"objects":[{"class":"%s","variable":"a"}]}]},
               "output":{"fields":[{"variable":"a","field":"value_varchar","as":"staged"}],
                         "to_user":false,"save_table":"/intermediate"}},
              {"graph":{"patterns":[{"objects":[{"class":"/intermediate","variable":"b"}]}]},
               "output":{"fields":[{"variable":"b","field":"staged","as":"value"}],"to_user":true}}]}}
            """.formatted(chinese)), target.sandboxId(), "test", null, config));
        assertEquals("written", result.getJSONArray("data").getJSONObject(0)
            .getJSONArray("answer").getJSONObject(0).getString("value"));
        adapter.deleteObjects(target.namespace(), definition, where);
        assertEquals("passed", adapter.probeSandboxPermission("dep001").status());
        assertEquals(2, adapter.listSandboxArtifacts("ot_sb_dep001_").size());
        var failure = assertThrows(IllegalStateException.class,
                () -> adapter.createRecordedClass(target.namespace(), definition));
        assertTrue(failure.getMessage().contains(chinese));
        assertTrue(failure.getMessage().contains(target.classTable(chinese)));
        adapter.dropRecordedResource(first);
        adapter.dropRecordedResource(second);
        assertTrue(adapter.listSandboxArtifacts("ot_sb_dep001_").isEmpty());
    }
}
