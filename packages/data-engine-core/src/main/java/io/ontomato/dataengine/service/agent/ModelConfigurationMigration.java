package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dao.VectorRebuildStateDao;
import io.ontomato.dataengine.service.vector.VectorRebuildService;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import lombok.extern.slf4j.Slf4j;

/** Each host migrates only its own records; runtime acknowledgements precede legacy deletion. */
@Slf4j
@Component
public class ModelConfigurationMigration {
    private final JdbcTemplate jdbc;
    private final AgentRuntimeClient runtime;
    private final VectorRebuildService vectors;
    private final TransactionTemplate transactions;
    private final java.util.concurrent.ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "model-configuration-upgrade"); t.setDaemon(true); return t;
    });
    private Set<String> pending;
    private final Set<String> rejectedEmbeddingImports = new LinkedHashSet<>();

    public ModelConfigurationMigration(JdbcTemplate jdbc, AgentRuntimeClient runtime, VectorRebuildService vectors,
            TransactionTemplate transactions, VectorRebuildStateDao state) {
        this.jdbc = jdbc; this.runtime = runtime; this.vectors = vectors; this.transactions = transactions;
    }
    @EventListener(ApplicationReadyEvent.class)
    public void start() { worker.scheduleWithFixedDelay(this::attempt, 0, 30, TimeUnit.SECONDS); }
    @PreDestroy
    public void stop() { worker.shutdownNow(); }
    private void attempt() {
        try {
            if (pending == null) pending = new LinkedHashSet<>(jdbc.queryForList(
                "SELECT id FROM business_config UNION SELECT domain_id FROM ontology_agent_settings", String.class));
            for (String domain : Set.copyOf(pending)) {
                try { migrateDomain(domain); pending.remove(domain); }
                catch (Exception error) { log.warn("Model configuration upgrade pending for domain {} ({})", domain, error.getClass().getSimpleName()); }
            }
            if (pending.isEmpty()) worker.shutdown();
        } catch (Exception error) { log.warn("Model configuration upgrade will retry ({})", error.getClass().getSimpleName()); }
    }
    public static String rewrite(String ref, JSONObject mapping) {
        if (ref == null) return null;
        String mapped = mapping.getJSONObject("references").getString(ref);
        return mapped != null ? mapped : mapping.getString("unconfiguredProviderId") + "/" + ref;
    }
    public void migrateDomain(String domain) throws Exception {
        var rows = jdbc.queryForList("SELECT content FROM business_config WHERE id=?", domain);
        JSONObject config = rows.isEmpty() || rows.getFirst().get("content") == null ? null : JSON.parseObject(rows.getFirst().get("content").toString());
        JSONObject old = config == null ? null : config.getJSONObject("embeddingModelProperties");
        if (old != null && unconfigured(old)) {
            transactions.executeWithoutResult(tx -> removeLegacyEmbedding(domain, old));
        } else if (old != null && !rejectedEmbeddingImports.contains(domain)) {
            try {
                JSONObject input = JSONObject.of("baseUrl", old.getString("baseUrl"), "apiKey", old.getString("apiKey"),
                    "modelName", old.getString("modelName"), "dimensions", old.getInteger("dimensions"));
                if (old.getJSONObject("customHeaders") != null) input.put("headers", old.getJSONObject("customHeaders"));
                if (old.getString("timeout") != null) input.put("timeoutMs", Duration.parse(old.getString("timeout")).toMillis());
                String imported = runtime.json(domain, "embedding-upgrade", "/v1/models/import-embedding", "POST", input, null).getString("importedModelId");
                transactions.executeWithoutResult(tx -> {
                    // The old generation identity is translated, never marked rebuilt by a rename.
                    var source = config.getJSONObject("embeddingVectorSource");
                    if (source != null) jdbc.update("INSERT INTO vector_rebuild_state(domain_id,base_url,model_name,dimensions,status,cleared) VALUES(?,?,?,?, 'READY',true) ON CONFLICT(domain_id) DO NOTHING",
                        domain, source.getString("baseUrl"), source.getString("modelName"), source.getInteger("dimensions"));
                    jdbc.update("UPDATE vector_rebuild_state SET model_ref=CASE WHEN base_url=? AND model_name=? THEN ? ELSE 'legacy/' || COALESCE(model_name,'unconfigured') END, base_url=NULL, model_name=NULL WHERE domain_id=? AND model_ref IS NULL",
                        old.getString("baseUrl"), old.getString("modelName"), imported, domain);
                    removeLegacyEmbedding(domain, old);
                });
            } catch (AgentHttpException error) {
                if (error.status() < 400 || error.status() >= 500) throw error;
                // Do not re-import a rejected configuration if another step needs a transient retry.
                rejectedEmbeddingImports.add(domain);
                log.warn("Legacy embedding import rejected for domain {} (code={}); keeping its configuration", domain, error.code());
            }
        }
        JSONObject mapping = runtime.json(domain, "model-upgrade", "/v1/models/migration-map", "GET", null, null);
        for (var row : jdbc.queryForList("SELECT agent_id,model_selection FROM ontology_agent_settings WHERE domain_id=? AND NOT model_reference_migrated", domain)) {
            JSONObject selection = JSON.parseObject(row.get("model_selection").toString());
            String before = selection.getString("modelId"), after = rewrite(before, mapping);
            jdbc.update(
                "UPDATE ontology_agent_settings SET model_selection=?::jsonb,model_reference_migrated=true WHERE domain_id=? AND agent_id=?::uuid AND model_selection=?::jsonb AND NOT model_reference_migrated",
                JSONObject.of("modelId", after).toJSONString(com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue), domain, row.get("agent_id").toString(), selection.toJSONString(com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue));
        }
        var options = runtime.json(domain, "embedding-upgrade", "/v1/models/options", "GET", null, null);
        if (options.getString("embeddingModelId") != null) vectors.modelSettingsChanged(domain);
    }
    private static boolean unconfigured(JSONObject old) {
        for (String field : new String[]{"baseUrl", "modelName", "apiKey"}) {
            String value = old.getString(field);
            if (value == null || value.trim().isEmpty()) return true;
        }
        return false;
    }
    private void removeLegacyEmbedding(String domain, JSONObject old) {
        jdbc.update("UPDATE business_config SET content=(content::jsonb - 'embeddingModelProperties' - 'embeddingVectorSource')::text WHERE id=? AND content::jsonb->'embeddingModelProperties'=?::jsonb",
            domain, old.toJSONString(com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue));
    }

}
