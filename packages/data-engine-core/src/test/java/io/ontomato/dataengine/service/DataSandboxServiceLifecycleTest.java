package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.SandboxTarget;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class DataSandboxServiceLifecycleTest {
    @Test
    void previewAndTrialUseTheSameLedgerAndPhysicalLifecycle() throws Exception {
        var jdbc = new Ledger();
        var deployment = mock(SandboxDeployment.class);
        when(deployment.tag()).thenReturn("dep001");
        when(deployment.operationLock()).thenReturn(new ReentrantLock());
        var identity = mock(IdentityService.class);
        var user = new QueryAccessService.GrantUser("user", "domain");
        when(identity.getCurrentUser()).thenReturn(user);
        when(identity.getCurrentCredentialExpiresAt()).thenReturn(null);
        var permission = new UserDataPermission();
        permission.setFullData(true);
        when(identity.getCurrentUserDataPermission()).thenReturn(permission);

        var config = new BusinessConfig();
        config.setDataAdapter("duckdb");
        var connection = new DataAdapterConnection();
        connection.put("url", "jdbc:duckdb:/fixture");
        config.getDataAdapterConnections().put("duckdb", connection);
        var configs = mock(BusinessConfigService.class);
        when(configs.get("domain")).thenReturn(config);
        var schemas = mock(JSONRuleDao.class);
        when(schemas.query("domain")).thenReturn(JSON.parseObject("""
            {"classDef":[{"className":"item","attrs":[{"name":"id","type":"int","primaryKey":true}]},
                         {"className":"order","attrs":[{"name":"id","type":"int","primaryKey":true}]}],
             "relationship_rule":{}}
            """));
        var adapter = mock(DataAdapter.class);
        var adapterFactory = mock(DataAdapterRegistry.class);
        when(adapterFactory.create(any(), any())).thenReturn(adapter);
        when(adapter.supportsSandbox(anyList())).thenReturn(true);
        when(adapter.forSandbox(any())).thenAnswer(invocation -> {
            SandboxTarget target = invocation.getArgument(0);
            when(adapter.sandboxClassArtifact(eq(target.namespace()), anyString())).thenAnswer(call ->
                JSONObject.of("kind", "table", "name", target.classTable(call.getArgument(1))));
            return adapter;
        });
        when(adapter.createRecordedClass(anyString(), anyMap())).thenAnswer(invocation -> new JSONObject());
        var writes = mock(WriteFunctionOperationService.class);
        var service = new DataSandboxService(jdbc, identity, schemas, configs,
            mock(QueryGrantService.class), null, deployment);
        ReflectionTestUtils.setField(service, "writes", writes);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", adapterFactory);
        var sample = JSON.parseObject("""
            {"objDatas":[{"className":"item","rows":[{"id":42}]}],"relDatas":[],"vectorDatas":[]}
            """);

        var preview = service.create("workspace", sample, Map.of());
        String previewId = preview.getString("contextId");
        String trial = service.open("domain", "user", "run", System.currentTimeMillis() + 60_000, List.of("order"));
        assertEquals("build-test", jdbc.rows.get(previewId).getString("purpose"));
        assertEquals("action-trial", jdbc.rows.get(trial).getString("purpose"));
        assertEquals("READY", preview.getString("status"));
        assertNotEquals(service.resolveTarget(previewId).shortId(), service.resolveTarget(trial).shortId());

        service.replaceClasses(trial, List.of("item"), service.validateSample(sample, Map.of(), "domain"), "domain");
        assertEquals(List.of("item"), List.copyOf(service.resolveTarget(trial).classTables().keySet()));
        service.reset(trial, "domain");
        var rows = JSONArray.of(JSONObject.of("id", 42));
        verify(writes).insert("item", rows, previewId, "domain");
        verify(writes).insert("item", rows, trial, "domain");

        String emptyTrial = service.open("domain", "user", "empty-run", System.currentTimeMillis() + 60_000, List.of());
        var emptyTarget = service.requireActionTrial(emptyTrial, "user", "domain");
        assertTrue(emptyTarget.actionTrial());
        assertEquals(emptyTrial, emptyTarget.sandboxId());
        assertTrue(emptyTarget.classNames().isEmpty());
        assertThrows(BuildTestException.class, () -> emptyTarget.requireClasses(List.of("item")));
        assertTrue(service.resolveTarget(emptyTrial, "domain").classTables().isEmpty());
        service.close(emptyTrial, "domain");
        assertEquals("CLOSED", jdbc.rows.get(emptyTrial).getString("state"));

        service.close(previewId);
        service.close(trial, "domain");
        assertEquals("CLOSED", jdbc.rows.get(previewId).getString("state"));
        assertEquals("CLOSED", jdbc.rows.get(trial).getString("state"));
        assertEquals("DELETED", jdbc.rows.get(trial).getJSONObject("data").getJSONArray("resources")
            .getJSONObject(0).getString("cleanupStatus"));
    }

    @Test
    void currentFactUsesTheSameSelectionAsCurrentAndLeavesTheExpiredReadyRowUntouched() {
        var jdbc = new Ledger();
        var identity = mock(IdentityService.class);
        var user = new QueryAccessService.GrantUser("user", "domain");
        when(identity.getCurrentUser()).thenReturn(user);
        var service = new DataSandboxService(jdbc, identity, null, null, null, null, null);
        var access = new QueryAccessService.Access(user, null, null, null, null);
        jdbc.addTest("expired", "user", "domain", "workspace", "build-test", "READY", 1L, 1L);
        jdbc.addTest("ended", "user", "domain", "workspace", "build-test", "CLOSED", 1L, 2L);
        jdbc.addTest("trial", "user", "domain", "workspace", "action-trial", "READY", 1L, 3L);
        jdbc.addTest("other-user", "other", "domain", "workspace", "build-test", "READY", 1L, 4L);
        jdbc.addTest("other-domain", "user", "other", "workspace", "build-test", "READY", 1L, 5L);
        jdbc.addTest("other-workspace", "user", "domain", "other", "build-test", "READY", 1L, 6L);

        assertEquals(JSONObject.of("status", "EXPIRED", "expiresAt", 1L,
                "sampleSummary", JSONObject.of("name", "expired.json")), service.currentStatusFact("workspace", access));
        assertNull(service.currentStatusFact("missing", access));
        assertEquals("READY", jdbc.rows.get("expired").getString("state"));
        assertEquals(0, jdbc.writes);
        verifyNoInteractions(identity);

        var current = service.current("workspace");
        assertEquals("expired", current.getString("contextId"));
        assertEquals("EXPIRED", current.getString("status"));
        assertEquals("EXPIRED", jdbc.rows.get("expired").getString("state"));
        assertEquals(1, jdbc.writes);
        // The terminal ordering is unchanged once the dedicated status call has persisted expiry.
        assertEquals("ended.json", service.currentStatusFact("workspace", access).getJSONObject("sampleSummary").getString("name"));
    }

    @Test
    void explicitCleanupPersistsExpiryBeforeCleaningAnUnscannedReadyRow() {
        var jdbc = new Ledger();
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("user", "domain"));
        var grants = mock(QueryGrantService.class);
        var service = spy(new DataSandboxService(jdbc, identity, null, null, grants, null, null));
        jdbc.addTest("expired", "user", "domain", "workspace", "build-test", "READY", 1L, 1L);
        doAnswer(call -> {
            assertEquals("EXPIRED", jdbc.rows.get("expired").getString("state"));
            return null;
        }).when(service).dropSampleStructure(any(), any(), eq("domain"), any());

        var response = service.retryCleanup("expired");
        assertEquals("EXPIRED", response.getString("status"));
        assertEquals("", response.getString("cleanupError"));
        assertTrue(jdbc.rows.get("expired").getBooleanValue("cleanup_attempted"));
        verify(grants).revokeContext("expired");
    }

    @Test
    void explicitCleanupStillRefusesAReadyRowBeforeExpiry() {
        var jdbc = new Ledger();
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(new QueryAccessService.GrantUser("user", "domain"));
        var grants = mock(QueryGrantService.class);
        var service = new DataSandboxService(jdbc, identity, null, null, grants, null, null);
        jdbc.addTest("ready", "user", "domain", "workspace", "build-test", "READY", Long.MAX_VALUE, 1L);

        var refused = assertThrows(BuildTestException.class, () -> service.retryCleanup("ready"));
        assertEquals(409, refused.getStatusCode().value());
        assertEquals("BUILD_TEST_CONTEXT_NOT_READY", refused.getCode());
        assertEquals("READY", jdbc.rows.get("ready").getString("state"));
        assertEquals(0, jdbc.writes);
        verifyNoInteractions(grants);
    }

    @Test
    void idleExpiryDoesNotAccessBusinessDatabases() {
        var jdbc = mock(JdbcTemplate.class);
        var registry = mock(DataAdapterRegistry.class);
        var configs = mock(BusinessConfigService.class);
        var vectors = mock(VectorResourceDao.class);
        var deployment = mock(SandboxDeployment.class);
        var service = new DataSandboxService(jdbc, null, null, configs, null, null, deployment);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
        ReflectionTestUtils.setField(service, "vectorResourceDao", vectors);

        service.cleanupExpired();

        verify(jdbc).update(contains("SET state='EXPIRED'"), anyLong());
        verifyNoInteractions(registry, configs, vectors, deployment);
    }

    @Test
    void orphanSweepSkipsDomainsWithoutASandboxCapableSource() {
        var jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList("SELECT id FROM business_config", String.class))
            .thenReturn(List.of("missing", "unset", "blank", "read-only"));
        var registry = mock(DataAdapterRegistry.class);
        var configs = mock(BusinessConfigService.class);
        var unset = new BusinessConfig();
        var blank = new BusinessConfig();
        blank.setDataAdapter(" ");
        var readOnly = new BusinessConfig();
        readOnly.setDataAdapter("oracle");
        when(configs.get("unset")).thenReturn(unset);
        when(configs.get("blank")).thenReturn(blank);
        when(configs.get("read-only")).thenReturn(readOnly);
        var deployment = mock(SandboxDeployment.class);
        when(deployment.tag()).thenReturn("dep001");
        when(deployment.scanLock()).thenReturn(new ReentrantLock());
        var vectors = mock(VectorResourceDao.class);
        var service = new DataSandboxService(jdbc, null, null, configs, null, null, deployment);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
        ReflectionTestUtils.setField(service, "vectorResourceDao", vectors);

        service.cleanupOrphans();

        verify(registry).supportsSandbox(readOnly);
        verifyNoMoreInteractions(registry);
        verify(vectors).cleanupSandboxOrphans(eq("ot_sb_dep001_"), any());
    }

    private static final class Ledger extends JdbcTemplate {
        private final Map<String, JSONObject> rows = new HashMap<>();
        private int writes;

        void addTest(String id, String user, String domain, String workspace, String purpose, String state,
                long expiresAt, long createdAt) {
            rows.put(id, JSONObject.of("id", id, "owner_id", user, "domain_id", domain, "scope_key", workspace,
                    "purpose", purpose, "state", state, "expires_at", expiresAt, "created_at", createdAt,
                    "cleanup_attempted", false, "data", JSONObject.of("sampleName", id + ".json", "classNames",
                            new JSONArray(), "resources", new JSONArray(), "binding", new JSONObject())));
        }

        @Override
        public int update(String sql, Object... args) {
            writes++;
            String id = (String) args[0];
            if (sql.startsWith("INSERT INTO data_sandboxes")) {
                rows.put(id, JSONObject.of("id", id, "short_id", args[1], "domain_id", args[2],
                    "owner_id", args[3], "purpose", args[4], "scope_key", args[5], "state", "PREPARING",
                    "expires_at", args[6], "data", JSON.parseObject((String) args[8])));
            } else if (sql.contains("SET data=")) {
                rows.get(args[1]).put("data", JSON.parseObject(id));
            } else if (sql.contains("SET state=")) {
                rows.get(args[args.length - 1]).put("state", sql.split("'")[1]);
            } else if (sql.contains("SET cleanup_attempted=true")) {
                rows.get(id).put("cleanup_attempted", true);
            } else if (sql.contains("SET cleanup_attempted=false")) {
                rows.get(id).put("cleanup_attempted", false);
            } else if (sql.contains("SET cleanup_error=''")) {
                rows.get(id).put("cleanup_error", "");
            } else {
                throw new AssertionError(sql);
            }
            return 1;
        }

        @Override
        public <T> List<T> queryForList(String sql, Class<T> type, Object... args) {
            if (sql.startsWith("SELECT row_to_json")) {
                return List.of(type.cast(rows.get(args[0]).toJSONString()));
            }
            if (sql.contains("WHERE owner_id=? AND domain_id=? AND scope_key=? AND purpose='build-test'")
                    && sql.contains("ORDER BY CASE WHEN state IN ('PREPARING','READY') THEN 0 ELSE 1 END,created_at DESC,id DESC")) {
                return rows.values().stream()
                        .filter(record -> args[0].equals(record.getString("owner_id"))
                                && args[1].equals(record.getString("domain_id"))
                                && args[2].equals(record.getString("scope_key"))
                                && "build-test".equals(record.getString("purpose")))
                        .sorted(Comparator.comparing((JSONObject record) ->
                                List.of("PREPARING", "READY").contains(record.getString("state"))).reversed()
                                .thenComparing(Comparator.comparingLong((JSONObject record) -> record.getLongValue("created_at")).reversed())
                                .thenComparing(record -> record.getString("id"), Comparator.reverseOrder()))
                        .limit(1).map(record -> type.cast(record.getString("id"))).toList();
            }
            return List.of();
        }
    }
}
