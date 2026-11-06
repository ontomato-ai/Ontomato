package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.bean.workflow.WorkflowStep;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

/**
 * Stores workflows and the append-only record of when each version became effective.
 *
 * <p>A published revision is immutable: {@code workflow_version} holds the steps of each version, and
 * {@code workflow_event} records activation and deactivation without ever rewriting the earlier rows.
 * The {@code status} column on {@code workflow} is only a projection of the newest event, so a reader
 * that needs to know what was in force at a past time reads the events.</p>
 */
@Slf4j
@Component("workflowDao")
public class WorkflowDao {

	private static final String TABLE = "workflow";
	private static final String VERSION_TABLE = "workflow_version";
	private static final String EVENT_TABLE = "workflow_event";

	private static final String COLUMNS =
			"id, name, description, domain_id, status, version, steps, run_class_name, create_timestamp, modify_timestamp, created_by";

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "name VARCHAR(255), "
				+ "description TEXT, "
				+ "domain_id VARCHAR(64), "
				+ "status VARCHAR(32), "
				+ "version INTEGER, "
				+ "steps TEXT, "
				+ "run_class_name VARCHAR(255), "
				+ "create_timestamp BIGINT, "
				+ "created_by VARCHAR(64), "
				+ "modify_timestamp BIGINT"
				+ ")");
		jdbcTemplate.execute("ALTER TABLE " + TABLE + " ADD COLUMN IF NOT EXISTS created_by VARCHAR(64)");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE + "_domain_id ON " + TABLE + "(domain_id)");

		// One row per published revision: the steps are frozen with the version they were published as.
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + VERSION_TABLE + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "workflow_id VARCHAR(64), "
				+ "domain_id VARCHAR(64), "
				+ "version INTEGER, "
				+ "steps TEXT, "
				+ "run_class_name VARCHAR(255), "
				+ "create_timestamp BIGINT"
				+ ")");
		jdbcTemplate.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_" + VERSION_TABLE
				+ "_workflow_version ON " + VERSION_TABLE + "(workflow_id, version)");

		// Activation and deactivation are appended; nothing is ever updated in place.
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + EVENT_TABLE + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "workflow_id VARCHAR(64), "
				+ "domain_id VARCHAR(64), "
				+ "version INTEGER, "
				+ "event VARCHAR(32), "
				+ "principal_id VARCHAR(64), "
				+ "create_timestamp BIGINT"
				+ ")");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + EVENT_TABLE
				+ "_workflow ON " + EVENT_TABLE + "(workflow_id, create_timestamp)");
		log.info(">>>workflow table initialization complete");
	}

	public Workflow save(Workflow workflow) {
		if (workflow.getId() == null) workflow.setId(UUID.randomUUID().toString());
		if (workflow.getDomainId() == null) throw new IllegalArgumentException("A workflow requires its domain");
		long now = System.currentTimeMillis();
		if (workflow.getCreateTimestamp() == null) workflow.setCreateTimestamp(now);
		workflow.setModifyTimestamp(now);
		if (workflow.getVersion() == null) workflow.setVersion(0);

		String steps = JSON.toJSONString(workflow.getSteps() == null ? List.of() : workflow.getSteps());
		jdbcTemplate.update(
				"INSERT INTO " + TABLE + " (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, "
						+ "status = EXCLUDED.status, version = EXCLUDED.version, steps = EXCLUDED.steps, "
						// created_by is deliberately absent: it records the first save and must survive later ones.
						+ "run_class_name = EXCLUDED.run_class_name, modify_timestamp = EXCLUDED.modify_timestamp",
				workflow.getId(), workflow.getName(), workflow.getDescription(), workflow.getDomainId(),
				workflow.getStatus(), workflow.getVersion(), steps, workflow.getRunClassName(),
				workflow.getCreateTimestamp(), workflow.getModifyTimestamp(), workflow.getCreatedBy());
		return workflow;
	}

	/** Freeze the current steps as a published revision; the version in the row is what grants name. */
	public void publishVersion(Workflow workflow) {
		int version = workflow.getVersion() == null ? 1 : workflow.getVersion();
		jdbcTemplate.update(
				"INSERT INTO " + VERSION_TABLE
						+ " (id, workflow_id, domain_id, version, steps, run_class_name, create_timestamp) "
						+ "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (workflow_id, version) DO NOTHING",
				UUID.randomUUID().toString(), workflow.getId(), workflow.getDomainId(), version,
				JSON.toJSONString(workflow.getSteps() == null ? List.of() : workflow.getSteps()),
				workflow.getRunClassName(), System.currentTimeMillis());
	}

	public void appendEvent(Workflow workflow, String event, String principalId) {
		jdbcTemplate.update(
				"INSERT INTO " + EVENT_TABLE
						+ " (id, workflow_id, domain_id, version, event, principal_id, create_timestamp) "
						+ "VALUES (?, ?, ?, ?, ?, ?, ?)",
				UUID.randomUUID().toString(), workflow.getId(), workflow.getDomainId(),
				workflow.getVersion(), event, principalId, System.currentTimeMillis());
	}

	public Workflow queryById(String id) {
		List<Workflow> found = jdbcTemplate.query(
				"SELECT " + COLUMNS + " FROM " + TABLE + " WHERE id = ?",
				(rs, rowNum) -> map(rs), id);
		return found.isEmpty() ? null : found.get(0);
	}

	public List<Workflow> queryList(String status, String domainId) {
		StringBuilder sql = new StringBuilder("SELECT " + COLUMNS + " FROM " + TABLE + " WHERE domain_id = ?");
		List<Object> params = new ArrayList<>();
		params.add(domainId);
		if (status != null && !status.isBlank()) {
			sql.append(" AND status = ?");
			params.add(status.trim());
		}
		sql.append(" ORDER BY create_timestamp DESC");
		return jdbcTemplate.query(sql.toString(), (rs, rowNum) -> map(rs), params.toArray());
	}

	/** The steps of one published revision, so a grant can be re-derived from what was approved. */
	public List<WorkflowStep> versionSteps(String workflowId, int version) {
		List<String> found = jdbcTemplate.query(
				"SELECT steps FROM " + VERSION_TABLE + " WHERE workflow_id = ? AND version = ?",
				(rs, rowNum) -> rs.getString(1), workflowId, version);
		return found.isEmpty() ? List.of() : parseSteps(found.get(0));
	}

	public void delete(String id) {
		jdbcTemplate.update("DELETE FROM " + TABLE + " WHERE id = ?", id);
	}

	public void deleteVersionRows(String workflowId) {
		jdbcTemplate.update("DELETE FROM " + VERSION_TABLE + " WHERE workflow_id = ?", workflowId);
		jdbcTemplate.update("DELETE FROM " + EVENT_TABLE + " WHERE workflow_id = ?", workflowId);
	}

	/** The principal of the most recent row for this workflow and event, or null when there is none. */
	public String queryLastEventPrincipal(String workflowId, String event) {
		List<String> found = jdbcTemplate.query(
				"SELECT principal_id FROM " + EVENT_TABLE + " WHERE workflow_id = ? AND event = ? "
						+ "ORDER BY create_timestamp DESC LIMIT 1",
				(rs, rowNum) -> rs.getString("principal_id"), workflowId, event);
		return found.isEmpty() ? null : found.get(0);
	}

	private Workflow map(java.sql.ResultSet rs) throws java.sql.SQLException {
		Workflow workflow = new Workflow();
		workflow.setId(rs.getString("id"));
		workflow.setName(rs.getString("name"));
		workflow.setDescription(rs.getString("description"));
		workflow.setDomainId(rs.getString("domain_id"));
		workflow.setStatus(rs.getString("status"));
		workflow.setVersion(rs.getInt("version"));
		workflow.setSteps(parseSteps(rs.getString("steps")));
		workflow.setRunClassName(rs.getString("run_class_name"));
		workflow.setCreateTimestamp(rs.getLong("create_timestamp"));
		workflow.setModifyTimestamp(rs.getLong("modify_timestamp"));
		workflow.setCreatedBy(rs.getString("created_by"));
		return workflow;
	}

	static List<WorkflowStep> parseSteps(String json) {
		if (json == null || json.isBlank()) return List.of();
		JSONArray array = JSON.parseArray(json);
		List<WorkflowStep> steps = new ArrayList<>(array.size());
		for (Object value : array) steps.add(JSONObject.from(value).to(WorkflowStep.class));
		return steps;
	}
}
