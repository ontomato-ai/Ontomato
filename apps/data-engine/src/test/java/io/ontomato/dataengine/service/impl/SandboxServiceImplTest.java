package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.BusinessConfigService;

class SandboxServiceImplTest {
    @TempDir Path directory;

    @Test
    void sandboxRelationsUseTheDomainsOntologyAndChangeOnlyTheRequestedObject() throws Exception {
        DuckDbGraphFixture first = new DuckDbGraphFixture(directory.resolve("first.db"), "sb_");
        DuckDbGraphFixture second = new DuckDbGraphFixture(directory.resolve("second.db"), "sb_");
        BusinessConfigService configs = mock(BusinessConfigService.class);
        when(configs.get("d1")).thenReturn(first.config);
        when(configs.get("d2")).thenReturn(second.config);
        JSONRuleDao rules = mock(JSONRuleDao.class);
        when(rules.query("d1")).thenReturn(first.rule);
        when(rules.query("d2")).thenReturn(second.rule);
        SandboxServiceImpl service = new SandboxServiceImpl();
        ReflectionTestUtils.setField(service, "businessConfigService", configs);
        ReflectionTestUtils.setField(service, "jsonRuleDao", rules);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", first.registry);
        service.insertRelations("sb_", JSONArray.of(JSONObject.of("relationName", "feeds", "sourceClassName", "pump",
                "sourceObjId", "P2", "targetClassName", "tank", "targetObjId", "T1")), "d1");
        assertEquals("T1", first.scalar("SELECT tank_code FROM sb_pump WHERE code = 'P2'"));
        assertEquals("T1", first.scalar("SELECT tank_code FROM sb_pump WHERE code = 'P1'"));
        assertNull(second.scalar("SELECT tank_code FROM sb_pump WHERE code = 'P2'"));
    }
}
