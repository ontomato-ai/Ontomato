package io.ontomato.dataengine.schedules;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.context.annotation.DependsOn;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.stereotype.Repository;

@Repository
@DependsOn("functionDao")
public class TaskStore {
  private final JdbcTemplate db;
  private final ObjectMapper mapper;
  private final DataSource source;

  public TaskStore(JdbcTemplate db, ObjectMapper mapper, DataSource source) {
    this.db = db;
    this.mapper = mapper;
    this.source = source;
  }

  JdbcTemplate jdbc() {
    return db;
  }

  @PostConstruct
  void initialize() {
    if (ScheduleMigration.exists(db, "write_task")
        && !ScheduleMigration.exists(db, "platform_task_import")
        && Boolean.TRUE.equals(
            db.queryForObject("SELECT EXISTS(SELECT FROM write_task)", Boolean.class)))
      throw new IllegalStateException(
          "Import legacy schedules before starting DataRAG (see platform-schedules-upgrade.md)");
    createTables();
  }

  void createTables() {
    new ResourceDatabasePopulator(new ClassPathResource("platform-schedules.sql")).execute(source);
  }

  record Task(
      UUID id,
      String domain,
      String owner,
      String appId,
      TaskDefinition definition,
      String locale,
      boolean enabled,
      String pausedReason,
      Instant nextRunAt,
      Instant createdAt,
      Instant updatedAt) {}

  public record Failure(String code, String message) {}

  public record Run(
      UUID id,
      UUID taskId,
      JsonNode target,
      UUID sessionId,
      String trigger,
      String status,
      Instant startedAt,
      Instant finishedAt,
      Failure error,
      String result,
      Long spendTime) {}

  private JsonNode json(ResultSet row, String key) throws SQLException {
    try {
      return mapper.readTree(row.getString(key));
    } catch (JsonProcessingException e) {
      throw new SQLException(e);
    }
  }

  private static Instant instant(ResultSet row, String key) throws SQLException {
    var stamp = row.getTimestamp(key);
    return stamp == null ? null : stamp.toInstant();
  }

  static Timestamp timestamp(Instant value) {
    return value == null ? null : Timestamp.from(value);
  }

  private Task task(ResultSet r, int index) throws SQLException {
    var def =
        new TaskDefinition(
            r.getString("name"),
            r.getString("description"),
            json(r, "target"),
            json(r, "frequency"),
            r.getString("time_zone"),
            r.getString("notify_email"));
    return new Task(
        r.getObject("id", UUID.class),
        r.getString("domain_id"),
        r.getString("owner_id"),
        r.getString("app_id"),
        def,
        r.getString("locale"),
        r.getBoolean("enabled"),
        r.getString("paused_reason"),
        instant(r, "next_run_at"),
        instant(r, "created_at"),
        instant(r, "updated_at"));
  }

  private Run mapRun(ResultSet r, int index) throws SQLException {
    var code = r.getString("error_code");
    return new Run(
        r.getObject("id", UUID.class),
        r.getObject("task_id", UUID.class),
        json(r, "target"),
        r.getObject("session_id", UUID.class),
        r.getString("trigger"),
        r.getString("status"),
        instant(r, "started_at"),
        instant(r, "finished_at"),
        code == null ? null : new Failure(code, r.getString("error_message")),
        r.getString("result"),
        r.getObject("spend_time", Long.class));
  }

  Task get(UUID id, boolean lock) {
    return db
        .query(
            "SELECT * FROM platform_task WHERE id=?" + (lock ? " FOR UPDATE" : ""), this::task, id)
        .stream()
        .findFirst()
        .orElse(null);
  }

  List<Task> visible(String domain, String owner, boolean functions, String app, UUID agent) {
    return db.query(
        """
        SELECT * FROM platform_task WHERE domain_id=? AND (owner_id=? OR (? AND owner_id IS NULL))
          AND (?::text IS NULL OR app_id=?) AND (?::text IS NULL OR target->>'agentId'=?)
        ORDER BY created_at DESC,id DESC""",
        this::task,
        domain,
        owner,
        functions,
        app,
        app,
        agent == null ? null : agent.toString(),
        agent == null ? null : agent.toString());
  }

  List<Task> credentialPaused(String domain, String owner) {
    return db.query(
        "SELECT * FROM platform_task WHERE domain_id=? AND owner_id=? AND enabled AND"
            + " paused_reason='credential_invalid' FOR UPDATE",
        this::task,
        domain,
        owner);
  }

  void insert(UUID id, String domain, String owner, TaskDefinition d, String locale, Instant next) {
    db.update(
        """
INSERT INTO platform_task(id,domain_id,owner_id,app_id,name,description,target,frequency,time_zone,
    notify_email,locale,next_run_at) VALUES (?,?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?)""",
        id,
        domain,
        owner,
        d.application(),
        d.name(),
        d.description(),
        d.target().toString(),
        d.frequency().toString(),
        d.timeZone(),
        d.notifyEmail(),
        locale,
        timestamp(next));
  }

  void update(Task t, TaskDefinition d, String locale, Instant next) {
    db.update(
        """
UPDATE platform_task SET name=?,description=?,target=?::jsonb,frequency=?::jsonb,time_zone=?,
notify_email=?,locale=?,next_run_at=?,paused_reason=NULL,updated_at=now() WHERE id=?""",
        d.name(),
        d.description(),
        d.target().toString(),
        d.frequency().toString(),
        d.timeZone(),
        d.notifyEmail(),
        locale,
        timestamp(next),
        t.id());
  }

  Run run(UUID id) {
    return db.query("SELECT * FROM platform_task_run WHERE id=?", this::mapRun, id).stream()
        .findFirst()
        .orElse(null);
  }

  java.util.Map<UUID, Run> latest(List<UUID> taskIds) {
    if (taskIds.isEmpty()) return java.util.Map.of();
    var named = new org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate(db);
    return named
        .query(
            """
            SELECT DISTINCT ON (task_id) * FROM platform_task_run WHERE task_id IN (:ids)
            ORDER BY task_id,started_at DESC,id DESC""",
            java.util.Map.of("ids", taskIds),
            this::mapRun)
        .stream()
        .collect(
            java.util.stream.Collectors.toMap(Run::taskId, java.util.function.Function.identity()));
  }

  List<Run> history(UUID task, Instant before, UUID beforeId, int limit) {
    return db.query(
        """
SELECT * FROM platform_task_run WHERE task_id=? AND
(?::timestamptz IS NULL OR (started_at,id)<(?,?)) ORDER BY started_at DESC,id DESC LIMIT ?""",
        this::mapRun,
        task,
        timestamp(before),
        timestamp(before),
        beforeId,
        limit);
  }

  Run admit(Task t, UUID id, String trigger) {
    int rows =
        db.update(
            """
            INSERT INTO platform_task_run(id,task_id,target,trigger) VALUES(?,?,?::jsonb,?)
            ON CONFLICT DO NOTHING""",
            id,
            t.id(),
            t.definition().target().toString(),
            trigger);
    return rows == 1 ? run(id) : null;
  }

  // Runtime admission keys are shared across operations. Derive a separate session key so
  // dispatch and settlement agree even before the host acknowledges it.
  static UUID hostSession(Run run) {
    return run.sessionId() != null
        ? run.sessionId()
        : UUID.nameUUIDFromBytes(
            ("platform-task-session:" + run.id()).getBytes(StandardCharsets.UTF_8));
  }

  void acknowledgeSession(Run run) {
    if (run.sessionId() == null)
      db.update(
          "UPDATE platform_task_run SET session_id=? WHERE id=? AND session_id IS NULL",
          hostSession(run),
          run.id());
  }

  public List<String> referencedFunctions() {
    return db.queryForList(
        "SELECT DISTINCT function_id FROM platform_task WHERE function_id IS NOT NULL",
        String.class);
  }

  public boolean references(String id) {
    return Boolean.TRUE.equals(
        db.queryForObject(
            "SELECT EXISTS(SELECT FROM platform_task WHERE function_id=?)", Boolean.class, id));
  }

  public void deleteUser(String id) {
    db.update("DELETE FROM platform_task WHERE owner_id=?", id);
    db.update("DELETE FROM platform_task_credential WHERE owner_id=?", id);
  }
}
