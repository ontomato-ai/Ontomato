package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.test.PostgresTestDatabase;

class MetadataPostgresBoundaryTest extends PostgresTestDatabase {
    @Test
    void initializationRemovesRetiredMarksWithoutChangingOtherDomainsOrUserFields() {
        JSONRuleDao dao = wire(new JSONRuleDao());
        dao.initIndex();
        String ordinary = "{\"classDef\":[{\"className\":\"Other\",\"attrs\":[{\"name\":\"permissionField\",\"type\":\"varchar\"}]}]}";
        jdbc.update("INSERT INTO json_rule VALUES (?, ?), (?, ?)", "d1", JSONRuleDaoRetiredPermissionFieldTest.STORED, "d2", ordinary);
        dao.initIndex();
        assertEquals(JSON.parseObject(JSONRuleDaoRetiredPermissionFieldTest.EXPECTED), dao.query("d1"));
        assertEquals(ordinary, jdbc.queryForObject("SELECT content FROM json_rule WHERE id = 'd2'", String.class));
        var after = jdbc.queryForList("SELECT * FROM json_rule ORDER BY id");
        dao.initIndex();
        assertEquals(after, jdbc.queryForList("SELECT * FROM json_rule ORDER BY id"));
    }

    @Test
    void countsNamedModelEntitiesInTheCurrentDomainsStoredRule() {
        JSONRuleDao dao = wire(new JSONRuleDao());
        dao.initIndex();
        var populated = """
                {"classDef":[
                    {"className":"Room","attrs":[{"name":"id"},{"name":"alias","enable":false},{"name":" "}]},
                    {"className":"Floor","attrs":[{"name":"id"}]},
                    {"className":"","attrs":[{"name":"ignored"}]}
                ], "relationship_rule":{"contains":{"fromclass":"Floor","toclass":"Room"}, " " : {}}}
                """;
        var empty = "{\"classDef\":[],\"relationship_rule\":{}}";
        jdbc.update("INSERT INTO json_rule VALUES (?, ?), (?, ?)", "populated", populated, "empty", empty);

        assertEquals(Map.of("objectTypes", 2, "attributes", 3, "relationships", 1), dao.countMetadata("populated"));
        assertEquals(Map.of("objectTypes", 0, "attributes", 0, "relationships", 0), dao.countMetadata("empty"));
        assertNull(dao.countMetadata("missing"));
        assertEquals(Map.of("objectTypes", 3, "attributes", 5, "relationships", 2),
                dao.countModelMetadata("populated", null));
        assertEquals(Map.of("objectTypes", 1, "attributes", 3, "relationships", 0),
                dao.countModelMetadata("populated", List.of("Room")));
        assertEquals(Map.of("objectTypes", 2, "attributes", 4, "relationships", 1),
                dao.countModelMetadata("populated", List.of("Room", "Floor")));
        assertEquals(Map.of("objectTypes", 0, "attributes", 0, "relationships", 0),
                dao.countModelMetadata("populated", List.of()));
    }

    @Test
    void readingBusinessConfigDoesNotMigrateStoredLegacyConnections() {
        BusinessConfigDao dao = wire(new BusinessConfigDao());
        dao.initIndex();
        String old = "{\"models\":[],\"dataAdapter\":\"mysql\",\"mysqlDataAdapterProperties\":{\"mysqlUrl\":\"jdbc:mysql\",\"mysqlUser\":\"u\",\"mysqlPassword\":\"p\"}}";
        String current = "{\"models\":[],\"dataAdapter\":\"postgresql\",\"dataAdapterConnections\":{\"postgresql\":{\"url\":\"jdbc:postgresql\"}}}";
        jdbc.update("INSERT INTO business_config VALUES (?, ?), (?, ?)", "d1", old, "d2", current);
        var before = jdbc.queryForList("SELECT id, content FROM business_config ORDER BY id");

        var legacy = dao.query("d1");
        assertEquals("mysql", legacy.getDataAdapter());
        assertFalse(legacy.getDataAdapterConnections().containsKey("mysql"));
        assertEquals("jdbc:postgresql", dao.query("d2").getDataAdapterConnections().get("postgresql").get("url"));

        assertEquals(before, jdbc.queryForList("SELECT id, content FROM business_config ORDER BY id"));
    }
}
