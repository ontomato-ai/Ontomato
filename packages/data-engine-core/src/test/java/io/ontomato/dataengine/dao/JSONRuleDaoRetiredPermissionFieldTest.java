package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import com.alibaba.fastjson2.JSON;

class JSONRuleDaoRetiredPermissionFieldTest {
    static final String STORED = """
            {"datasetdesc":"d","classDef":[{"className":"Order","attrs":[
              {"name":"id","type":"varchar","primaryKey":true,"permissionField":false},
              {"name":"region","type":"varchar","enable":true,"permissionField":true}]}]}
            """;
    static final String EXPECTED = """
            {"datasetdesc":"d","classDef":[{"className":"Order","attrs":[
              {"name":"id","type":"varchar","primaryKey":true},
              {"name":"region","type":"varchar","enable":true}]}]}
            """;

    @Test
    void removesOnlyTheRetiredAttributeMarkAndIsIdempotent() {
        var rule = JSON.parseObject(STORED);
        assertTrue(JSONRuleDao.removePermissionFieldMarks(rule));
        assertEquals(JSON.parseObject(EXPECTED), rule);
        assertFalse(JSONRuleDao.removePermissionFieldMarks(rule));
        assertEquals(JSON.parseObject(EXPECTED), rule);
    }

    @Test
    void aFieldNamedPermissionFieldIsOrdinaryUserData() {
        var rule = JSON.parseObject("""
                {"classDef":[{"className":"Order","attrs":[{"name":"permissionField","type":"varchar"}]}]}
                """);
        var before = JSON.parseObject(rule.toJSONString());
        assertFalse(JSONRuleDao.removePermissionFieldMarks(rule));
        assertEquals(before, rule);
    }
}
