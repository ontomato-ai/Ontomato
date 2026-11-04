package io.ontomato.dataengine.dao;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;

import jakarta.annotation.PostConstruct;

/**
 * One row per domain, apart from business_config: every config save rewrites that whole record,
 * which would otherwise drop the progress of a round saved in between.
 */
@Component("vectorRebuildStateDao")
public class VectorRebuildStateDao {

    private static final String TABLE_NAME = "vector_rebuild_state";

    private static final String COLUMNS = "domain_id, model_ref, dimensions, status, cleared, error";

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @PostConstruct
    public void initIndex() {
        jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
                + "domain_id VARCHAR(64) PRIMARY KEY, "
                + "base_url TEXT, "
                + "model_name TEXT, "
                + "dimensions INTEGER, "
                + "status VARCHAR(16) NOT NULL, "
                + "cleared BOOLEAN NOT NULL, "
                + "error TEXT"
                + ")");
        jdbcTemplate.execute("ALTER TABLE " + TABLE_NAME + " ADD COLUMN IF NOT EXISTS model_ref TEXT");
    }

    public VectorRebuildState find(String domainId) {
        List<VectorRebuildState> rows = jdbcTemplate.query(
                "SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE domain_id = ?",
                (rs, rowNum) -> {
                    VectorRebuildState state = new VectorRebuildState();
                    state.setModelId(rs.getString("model_ref"));
                    state.setDimensions((Integer) rs.getObject("dimensions"));
                    state.setStatus(VectorRebuildState.Status.valueOf(rs.getString("status")));
                    state.setCleared(rs.getBoolean("cleared"));
                    String error = rs.getString("error");
                    state.setError(error == null ? null : JSON.parseObject(error, VectorRebuildState.Failure.class));
                    return state;
                }, domainId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void save(String domainId, VectorRebuildState state) {
        write(domainId, state, "ON CONFLICT (domain_id) DO UPDATE SET model_ref = EXCLUDED.model_ref, dimensions = EXCLUDED.dimensions, status = EXCLUDED.status, "
                + "cleared = EXCLUDED.cleared, error = EXCLUDED.error");
    }

    /** Keeps a row written concurrently: a seed never overwrites a recorded state. */
    public void insertIfAbsent(String domainId, VectorRebuildState state) {
        write(domainId, state, "ON CONFLICT (domain_id) DO NOTHING");
    }

    private void write(String domainId, VectorRebuildState state, String onConflict) {
        jdbcTemplate.update("INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?) " + onConflict,
                domainId, state.getModelId(), state.getDimensions(), state.getStatus().name(),
                state.isCleared(), state.getError() == null ? null : JSON.toJSONString(state.getError()));
    }

}
