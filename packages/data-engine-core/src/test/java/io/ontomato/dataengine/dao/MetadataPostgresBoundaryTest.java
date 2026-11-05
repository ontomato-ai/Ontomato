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
    void aLegacyConnectionIsPersistedAndReadableAgainWithoutRewritingOtherRecords() {
        BusinessConfigDao dao = wire(new BusinessConfigDao());
        dao.initIndex();
        String old = "{\"models\":[],\"dataAdapter\":\"mysql\",\"mysqlDataAdapterProperties\":{\"mysqlUrl\":\"jdbc:mysql\",\"mysqlUser\":\"u\",\"mysqlPassword\":\"p\"}}";
        String current = "{\"models\":[],\"dataAdapter\":\"postgresql\",\"dataAdapterConnections\":{}}";
        jdbc.update("INSERT INTO business_config VALUES (?, ?), (?, ?)", "d1", old, "d2", current);
        var migrated = dao.query("d1").getDataAdapterConnections().get("mysql");
        assertEquals("jdbc:mysql", migrated.getUrl());
        assertEquals("u", migrated.getUser());
        assertEquals("p", migrated.getPassword());
        var stored = jdbc.queryForObject("SELECT content FROM business_config WHERE id = 'd1'", String.class);
        assertFalse(JSON.parseObject(stored).containsKey("mysqlDataAdapterProperties"));
        assertEquals(migrated, wire(new BusinessConfigDao()).query("d1").getDataAdapterConnections().get("mysql"));
        dao.query("d2");
        assertEquals(current, jdbc.queryForObject("SELECT content FROM business_config WHERE id = 'd2'", String.class));
        assertEquals(stored, jdbc.queryForObject("SELECT content FROM business_config WHERE id = 'd1'", String.class));
    }
}
