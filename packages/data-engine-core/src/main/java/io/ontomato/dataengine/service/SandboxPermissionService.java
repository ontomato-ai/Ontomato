package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.SandboxCapability;
import io.ontomato.dataengine.service.agent.AgentJson;
import jakarta.annotation.PostConstruct;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
@DependsOn("jdbcInitDb")
public class SandboxPermissionService {
    private final JdbcTemplate jdbc;
    private final DataAdapterRegistry adapters;
    private final BusinessConfigService configs;
    private final SandboxDeployment deployment;

    public SandboxPermissionService(JdbcTemplate jdbc, DataAdapterRegistry adapters,
            BusinessConfigService configs, SandboxDeployment deployment) {
        this.jdbc = jdbc;
        this.adapters = adapters;
        this.configs = configs;
        this.deployment = deployment;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS data_sandbox_probes (
                domain_id text NOT NULL, connection_fingerprint text NOT NULL, status text NOT NULL,
                can_create_and_drop boolean NOT NULL, reason text, checked_at timestamptz NOT NULL,
                details jsonb NOT NULL, PRIMARY KEY (domain_id, connection_fingerprint)
            )
            """);
    }

    public JSONObject read(String domain) {
        return read(domain, configs.get(domain));
    }

    public JSONObject read(String domain, BusinessConfig config) {
        if (!adapters.supportsSandbox(config)) return SandboxCapability.unsupported().json();
        var reports = jdbc.queryForList(
            "SELECT details::text FROM data_sandbox_probes WHERE domain_id=? AND connection_fingerprint=?",
            String.class, domain, fingerprint(config));
        return reports.isEmpty() ? SandboxCapability.unchecked().json() : JSON.parseObject(reports.getFirst());
    }

    public JSONObject check(String domain) {
        return check(domain, configs.get(domain));
    }

    public JSONObject check(String domain, BusinessConfig config) {
        return check(domain, fingerprint(config), adapters.create(config, null));
    }

    public JSONObject test(String domain, String type, DataAdapterConnection connection, DataAdapter candidate) {
        return check(domain, connectionFingerprint(type, connection), candidate);
    }

    private SandboxCapability probe(DataAdapter adapter) {
        var lock = deployment.operationLock();
        lock.lock();
        try {
            return adapter.probeSandboxPermission(deployment.tag());
        } finally {
            lock.unlock();
        }
    }

    private JSONObject check(String domain, String fingerprint, DataAdapter adapter) {
        var capability = probe(adapter);
        var report = capability.json();
        jdbc.update("""
            INSERT INTO data_sandbox_probes (domain_id,connection_fingerprint,status,can_create_and_drop,reason,checked_at,details)
            VALUES (?,?,?,?,?,now(),?::jsonb)
            ON CONFLICT (domain_id,connection_fingerprint) DO UPDATE SET
                status=EXCLUDED.status, can_create_and_drop=EXCLUDED.can_create_and_drop,
                reason=EXCLUDED.reason, checked_at=EXCLUDED.checked_at, details=EXCLUDED.details
            """, domain, fingerprint, capability.status(), capability.canCreateAndDrop(), capability.reason(),
            report.toJSONString());
        return report;
    }

    private static String fingerprint(BusinessConfig config) {
        String type = config.getDataAdapter();
        if ("multi".equals(type)) {
            var sources = new JSONObject();
            config.getMultiDataSource().getDataSources().forEach(source ->
                sources.put(source.getId(), connectionFingerprint(source.getAdapterType(), source.getConnection())));
            return AgentJson.hash(JSONObject.of("type", type, "sources", sources));
        }
        return connectionFingerprint(type, config.getDataAdapterConnections().get(type));
    }

    static String connectionFingerprint(String type, DataAdapterConnection connection) {
        return AgentJson.hash(JSONObject.of("type", type, "connection", connection));
    }
}
