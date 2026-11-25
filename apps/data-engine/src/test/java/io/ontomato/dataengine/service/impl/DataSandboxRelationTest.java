package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.dataAdapter.SandboxTarget;
import java.util.Map;
import java.util.List;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.SandboxDeployment;
import java.util.concurrent.locks.ReentrantLock;
import org.springframework.jdbc.core.JdbcTemplate;

class DataSandboxRelationTest {
    @TempDir Path directory;

    @Test
    void sandboxRelationsUseTheDomainsOntologyAndChangeOnlyTheRequestedObject() throws Exception {
        DuckDbGraphFixture first = new DuckDbGraphFixture(directory.resolve("first.db"), "ot_sb_dep001_12345678_");
        DuckDbGraphFixture second = new DuckDbGraphFixture(directory.resolve("second.db"), "ot_sb_dep001_12345678_");
        BusinessConfigService configs = mock(BusinessConfigService.class);
        when(configs.get("d1")).thenReturn(first.config);
        when(configs.get("d2")).thenReturn(second.config);
        JSONRuleDao rules = mock(JSONRuleDao.class);
        when(rules.query("d1")).thenReturn(first.rule);
        when(rules.query("d2")).thenReturn(second.rule);
        var target = new SandboxTarget("registered", "dep001", "12345678",
                Map.of("pump", "ot_sb_dep001_12345678_c01", "tank", "ot_sb_dep001_12345678_c02"),
                Map.of(), Map.of());
        for (var fixture : java.util.List.of(first, second)) {
            fixture.execute("ALTER TABLE ot_sb_dep001_12345678_pump RENAME TO " + target.classTable("pump"));
            fixture.execute("ALTER TABLE ot_sb_dep001_12345678_tank RENAME TO " + target.classTable("tank"));
        }
        var sandboxes = mock(DataSandboxService.class);
        when(sandboxes.resolveTarget("registered", "d1")).thenReturn(target);
        var writes = new WriteFunctionOperationServiceImpl();
        ReflectionTestUtils.setField(writes, "businessConfigService", configs);
        ReflectionTestUtils.setField(writes, "jsonRuleDao", rules);
        ReflectionTestUtils.setField(writes, "dataAdapterRegistry", first.registry);
        ReflectionTestUtils.setField(writes, "dataSandboxes", sandboxes);
        writes.createEdge("feeds", "pump", "P2", "tank", "T1", "registered", "d1");
        assertEquals("T1", first.scalar("SELECT tank_code FROM ot_sb_dep001_12345678_c01 WHERE code = 'P2'"));
        assertEquals("T1", first.scalar("SELECT tank_code FROM ot_sb_dep001_12345678_c01 WHERE code = 'P1'"));
        assertNull(second.scalar("SELECT tank_code FROM ot_sb_dep001_12345678_c01 WHERE code = 'P2'"));
    }

    @Test
    void orphanSweepKeepsBothDeploymentsActiveTablesOnTheSameBusinessDatabase() throws Exception {
        var fixture = new DuckDbGraphFixture(directory.resolve("shared.db"), "");
        var configs = mock(BusinessConfigService.class);
        when(configs.get("business")).thenReturn(fixture.config);
        var rules = mock(JSONRuleDao.class);
        when(rules.query("business")).thenReturn(fixture.rule);
        var registry = mock(JdbcTemplate.class);
        when(registry.queryForList(contains("SELECT short_id"), eq(String.class), anyLong()))
                .thenReturn(List.of("aaaaaaaa"));
        when(registry.queryForList("SELECT id FROM business_config", String.class)).thenReturn(List.of("business"));
        var deployment = mock(SandboxDeployment.class);
        when(deployment.tag()).thenReturn("dep001");
        when(deployment.scanLock()).thenReturn(new ReentrantLock());
        var sandboxes = new DataSandboxService(registry, null, rules, configs, null, null, deployment);
        ReflectionTestUtils.setField(sandboxes, "dataAdapterRegistry", fixture.registry);
        ReflectionTestUtils.setField(sandboxes, "vectorResourceDao", mock(VectorResourceDao.class));

        for (String table : List.of("ot_sb_dep001_aaaaaaaa_c01", "ot_sb_dep001_bbbbbbbb_c01",
                "ot_sb_dep001_p_cccccccc", "ot_sb_dep002_aaaaaaaa_c01", "ot_sb_dep002_bbbbbbbb_c01",
                "ot_sb_dep002_p_cccccccc")) {
            fixture.execute("CREATE TABLE " + table + " (id INTEGER)");
        }

        sandboxes.cleanupOrphans();

        assertEquals("4", fixture.scalar("""
            SELECT count(*) FROM information_schema.tables WHERE starts_with(table_name, 'ot_sb_')
            """));
        assertEquals("1", fixture.scalar("""
            SELECT count(*) FROM information_schema.tables WHERE table_name = 'ot_sb_dep001_aaaaaaaa_c01'
            """));
        assertEquals("3", fixture.scalar("""
            SELECT count(*) FROM information_schema.tables WHERE starts_with(table_name, 'ot_sb_dep002_')
            """));
    }
}
