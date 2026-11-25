package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
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
