package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
			"id, name, description, domain_id, status, version, steps, run_class_name, run_contract, temporary, case_form_schema, create_timestamp, modify_timestamp, created_by";

	private static final String HAS_DRAFT = """
			(w.status = 'ACTIVE' AND ROW(w.name, w.description, w.steps, w.run_class_name,
				w.run_contract, w.temporary, w.case_form_schema) IS DISTINCT FROM
				ROW(v.name, v.description, v.steps, v.run_class_name,
					v.run_contract, v.temporary, v.case_form_schema)) AS has_draft
			""";

	private static final String REVISION_JOIN = """
			JOIN workflow_version v ON v.workflow_id = w.id AND v.domain_id = w.domain_id
				AND v.version = w.version
			""";

	private static final String EDITABLE = "SELECT w.*, " + HAS_DRAFT + " FROM workflow w LEFT " + REVISION_JOIN;

	private static final String ACTIVE = """
			SELECT w.id, v.name, v.description, w.domain_id, w.status, w.version, v.steps,
				v.run_class_name, v.run_contract, v.temporary, v.case_form_schema,
				w.create_timestamp, v.create_timestamp AS modify_timestamp, w.created_by,
			""" + HAS_DRAFT + " FROM workflow w " + REVISION_JOIN;

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
				+ "run_contract TEXT, "
				+ "temporary BOOLEAN, "
				+ "case_form_schema TEXT, "
				+ "create_timestamp BIGINT, "
				+ "created_by VARCHAR(64), "
				+ "modify_timestamp BIGINT"
				+ ")");
		jdbcTemplate.execute("ALTER TABLE " + TABLE + " ADD COLUMN IF NOT EXISTS created_by VARCHAR(64)");
		jdbcTemplate.execute("ALTER TABLE " + TABLE + " ADD COLUMN IF NOT EXISTS run_contract TEXT");
		jdbcTemplate.execute("ALTER TABLE " + TABLE + " ADD COLUMN IF NOT EXISTS temporary BOOLEAN");
		jdbcTemplate.execute("ALTER TABLE " + TABLE + " ADD COLUMN IF NOT EXISTS case_form_schema TEXT");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE + "_domain_id ON " + TABLE + "(domain_id)");

		// One row per published revision: the steps are frozen with the version they were published as.
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + VERSION_TABLE + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "workflow_id VARCHAR(64), "
				+ "domain_id VARCHAR(64), "
				+ "version INTEGER, "
				+ "name VARCHAR(255), "
				+ "description TEXT, "
				+ "steps TEXT, "
				+ "run_class_name VARCHAR(255), "
				+ "run_contract TEXT, "
				+ "temporary BOOLEAN, "
				+ "case_form_schema TEXT, "
				+ "create_timestamp BIGINT"
				+ ")");
		jdbcTemplate.execute("ALTER TABLE " + VERSION_TABLE + " ADD COLUMN IF NOT EXISTS run_contract TEXT");
		jdbcTemplate.execute("ALTER TABLE " + VERSION_TABLE + " ADD COLUMN IF NOT EXISTS temporary BOOLEAN");
		jdbcTemplate.execute("ALTER TABLE " + VERSION_TABLE + " ADD COLUMN IF NOT EXISTS case_form_schema TEXT");
		jdbcTemplate.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_" + VERSION_TABLE
				+ "_workflow_version ON " + VERSION_TABLE + "(workflow_id, version)");

		jdbcTemplate.execute("ALTER TABLE " + VERSION_TABLE + " ADD COLUMN IF NOT EXISTS name VARCHAR(255)");
		jdbcTemplate.execute("ALTER TABLE " + VERSION_TABLE + " ADD COLUMN IF NOT EXISTS description TEXT");
		// Before draft saves preserved activation, an ACTIVE definition still matched its frozen revision.
		jdbcTemplate.update("""
				UPDATE workflow_version v SET name = w.name, description = w.description
				FROM workflow w
				WHERE v.workflow_id = w.id AND v.domain_id = w.domain_id AND v.version = w.version
					AND v.name IS NULL AND w.status = 'ACTIVE'
				""");

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

	public Workflow saveDraft(Workflow workflow) {
		if (workflow.getId() == null) workflow.setId(UUID.randomUUID().toString());
		long now = System.currentTimeMillis();
		int saved = jdbcTemplate.update(
				"INSERT INTO " + TABLE + " (" + COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
						+ """
						ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
							steps = EXCLUDED.steps, run_class_name = EXCLUDED.run_class_name,
							run_contract = EXCLUDED.run_contract, temporary = EXCLUDED.temporary,
							case_form_schema = EXCLUDED.case_form_schema, modify_timestamp = EXCLUDED.modify_timestamp
						WHERE workflow.domain_id = EXCLUDED.domain_id
						""",
				workflow.getId(), workflow.getName(), workflow.getDescription(), workflow.getDomainId(),
				Workflow.STATUS_DRAFT, 0, stepsJson(workflow), workflow.getRunClassName(),
				runContractJson(workflow), workflow.getTemporary(), caseFormSchemaJson(workflow),
				now, now, workflow.getCreatedBy());
		if (saved == 0) throw new IllegalArgumentException("Workflow not found");
		return queryById(workflow.getId());
	}

	public void updateLifecycle(Workflow workflow) {
		jdbcTemplate.update("UPDATE " + TABLE + " SET status = ?, version = ? WHERE id = ?",
				workflow.getStatus(), workflow.getVersion(), workflow.getId());
	}

	private String stepsJson(Workflow workflow) {
		return JSON.toJSONString(workflow.getSteps() == null ? List.of() : workflow.getSteps());
	}

	private String runContractJson(Workflow workflow) {
		return workflow.getRunContract() == null ? null : JSON.toJSONString(workflow.getRunContract());
	}

	private String caseFormSchemaJson(Workflow workflow) {
		return workflow.getCaseFormSchema() == null ? null : JSON.toJSONString(workflow.getCaseFormSchema());
	}

	/** The number the next published revision must take, derived from the frozen rows rather than the row. */
	public int nextVersion(String workflowId) {
		Integer next = jdbcTemplate.queryForObject(
				"SELECT COALESCE(MAX(version), 0) + 1 FROM " + VERSION_TABLE + " WHERE workflow_id = ?",
				Integer.class, workflowId);
		return next == null ? 1 : next;
	}

	/** Freeze the definition as the next revision while the service holds the workflow row lock. */
	public int publishVersion(Workflow workflow) {
		int version = nextVersion(workflow.getId());
		jdbcTemplate.update("""
				INSERT INTO workflow_version (id, workflow_id, domain_id, version, name, description,
					steps, run_class_name, run_contract, temporary, case_form_schema, create_timestamp)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				""",
				UUID.randomUUID().toString(), workflow.getId(), workflow.getDomainId(), version,
				workflow.getName(), workflow.getDescription(), stepsJson(workflow), workflow.getRunClassName(),
				runContractJson(workflow), workflow.getTemporary(), caseFormSchemaJson(workflow),
				System.currentTimeMillis());
		return version;
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
		return queryOne(EDITABLE + " WHERE w.id = ?", id);
	}

	public Workflow queryByIdForUpdate(String id, String domainId) {
		return queryOne(EDITABLE + " WHERE w.id = ? AND w.domain_id = ? FOR UPDATE OF w", id, domainId);
	}

	public Workflow queryActiveById(String id, String domainId) {
		return queryOne(ACTIVE + " WHERE w.id = ? AND w.domain_id = ? AND w.status = 'ACTIVE'", id, domainId);
	}

	private Workflow queryOne(String sql, Object... params) {
		List<Workflow> found = jdbcTemplate.query(sql, (rs, rowNum) -> map(rs), params);
		return found.isEmpty() ? null : found.getFirst();
	}

	public List<Workflow> queryList(String status, String domainId) {
		String selection = Workflow.STATUS_ACTIVE.equals(status) ? ACTIVE : EDITABLE;
		StringBuilder sql = new StringBuilder(selection + " WHERE w.domain_id = ?");
		List<Object> params = new ArrayList<>();
		params.add(domainId);
		if (status != null && !status.isBlank()) {
			sql.append(" AND w.status = ?");
			params.add(status);
		}
		sql.append(" ORDER BY w.create_timestamp DESC");
		return jdbcTemplate.query(sql.toString(), (rs, rowNum) -> map(rs), params.toArray());
	}

    public record PendingRevision(io.ontomato.dataengine.bean.workflow.RunContract contract, List<WorkflowStep> steps, boolean sharedClass) {}

    /** Use the active frozen snapshot, not the editable definition. Past processes can still have rows in a shared class. */
    public PendingRevision pendingRevision(String domain, String id, int version) {
        var rows = jdbcTemplate.query("""
                SELECT v.run_contract, v.steps, EXISTS (
                    SELECT 1 FROM workflow_version other WHERE other.domain_id=v.domain_id
                    AND other.workflow_id<>v.workflow_id AND other.run_class_name=v.run_class_name) AS shared_class
                FROM workflow_version v JOIN workflow w ON w.id=v.workflow_id AND w.domain_id=v.domain_id AND w.version=v.version
                WHERE v.domain_id=? AND v.workflow_id=? AND v.version=? AND w.status='ACTIVE'
                """, (rs, n) -> new PendingRevision(JSON.parseObject(rs.getString("run_contract"),
                        io.ontomato.dataengine.bean.workflow.RunContract.class).normalized(), parseSteps(rs.getString("steps")),
                        rs.getBoolean("shared_class")), domain, id, version);
        return rows.isEmpty() ? null : rows.get(0);
    }

	public void delete(String id) {
		jdbcTemplate.update("DELETE FROM " + TABLE + " WHERE id = ?", id);
	}

	public void deleteVersionRows(String workflowId) {
		jdbcTemplate.update("DELETE FROM " + VERSION_TABLE + " WHERE workflow_id = ?", workflowId);
		jdbcTemplate.update("DELETE FROM " + EVENT_TABLE + " WHERE workflow_id = ?", workflowId);
	}

	/**
	 * The revisions currently in force in a domain, keyed by workflow id.
	 *
	 * <p>A grant names the workflow and the version that activated it; only a grant whose version is
	 * still the effective one conveys authority. Reading the whole set once keeps that decision to one
	 * query instead of one per grant, and a workflow that is no longer active is simply absent — which is
	 * what makes deactivation withdraw authority even for rows a revoke never removed.</p>
	 */
	public Map<String, Integer> activeVersions(String domainId) {
		Map<String, Integer> versions = new HashMap<>();
		jdbcTemplate.query(
				"SELECT id, version FROM " + TABLE + " WHERE domain_id = ? AND status = ?",
				rs -> {
					versions.put(rs.getString("id"), rs.getInt("version"));
				},
				domainId, Workflow.STATUS_ACTIVE);
		return versions;
	}

	/**
	 * Whether an active workflow currently exposes this Action only through a Case-scoped step.
	 *
	 * <p>Case-scoped steps deliberately publish no role grant. The execution fallback for an Action
	 * with no grant record must therefore not turn that absence into a domain-wide direct-call
	 * permission. Read the frozen active revision, not the editable workflow row.</p>
	 */
	public boolean caseScopedActionInForce(String domainId, String actionId) {
		List<String> revisions = jdbcTemplate.query(
				"SELECT v.steps FROM " + VERSION_TABLE + " v "
						+ "JOIN " + TABLE + " w ON w.id = v.workflow_id AND w.domain_id = v.domain_id "
						+ "AND w.version = v.version "
						+ "WHERE v.domain_id = ? AND w.status = ?",
				(rs, rowNum) -> rs.getString("steps"), domainId, Workflow.STATUS_ACTIVE);
		for (String revision : revisions) {
			for (WorkflowStep step : parseSteps(revision)) {
				if (Boolean.TRUE.equals(step.getCaseScoped()) && actionId.equals(step.getActionId()))
					return true;
			}
		}
		return false;
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
		workflow.setHasDraft(rs.getBoolean("has_draft"));
		workflow.setSteps(parseSteps(rs.getString("steps")));
		workflow.setRunClassName(rs.getString("run_class_name"));
		String runContract = rs.getString("run_contract");
		workflow.setRunContract(
				runContract == null || runContract.isBlank()
						? null : JSON.parseObject(runContract, io.ontomato.dataengine.bean.workflow.RunContract.class));
		workflow.setTemporary(rs.getObject("temporary") == null ? null : rs.getBoolean("temporary"));
		String caseFormSchema = rs.getString("case_form_schema");
		workflow.setCaseFormSchema(caseFormSchema == null || caseFormSchema.isBlank()
				? null : JSON.parseObject(caseFormSchema));
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
