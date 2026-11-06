package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

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
  private final DataSource source;

  public TaskStore(JdbcTemplate db, ObjectMapper mapper, DataSource source) {
    this.db = db;
    this.source = source;
  }

  public JdbcTemplate jdbc() {
    return db;
  }

  @PostConstruct
  void initialize() {
    if (ScheduleMigration.exists(db, "platform_task") && column(db, "platform_task", "target"))
      throw new IllegalStateException(
          "Convert platform schedules offline with forms-check/forms-upgrade before starting"
              + " DataRAG");
    if (ScheduleMigration.exists(db, "write_task")
        && !ScheduleMigration.exists(db, "platform_task_import")
        && Boolean.TRUE.equals(
            db.queryForObject("SELECT EXISTS(SELECT FROM write_task)", Boolean.class)))
      throw new IllegalStateException(
          "Import legacy schedules before starting DataRAG (see platform-schedules-upgrade.md)");
    createTables();
  }

  public static boolean column(JdbcTemplate db, String table, String name) {
    return Boolean.TRUE.equals(
        db.queryForObject(
            "SELECT EXISTS(SELECT FROM information_schema.columns WHERE"
                + " table_schema=current_schema() AND table_name=? AND column_name=?)",
            Boolean.class,
            table,
            name));
  }

  void createTables() {
    new ResourceDatabasePopulator(new ClassPathResource("platform-schedules.sql")).execute(source);
  }

  public record Task(
      UUID id,
      String domain,
      String creator,
      TaskDefinition definition,
      JsonNode summary,
      String locale,
      boolean enabled,
      Failure pause,
      Instant nextRunAt,
      long revision,
      Instant createdAt,
      Instant updatedAt) {}

  public record Failure(String code, String message) {}

  public record Snapshot(
      String domainId,
      String creatorId,
      TaskDefinition definition,
      JsonNode summary,
      String locale,
      long taskRevision) {
    JsonNode wire() {
      return object(
          "title",
          definition.title(),
          "appId",
          definition.appId(),
          "content",
          definition.content(),
          "formRevision",
          definition.formRevision(),
          "creatorId",
          creatorId,
          "summary",
          summary,
          "timeZone",
          definition.timeZone(),
          "locale",
          locale,
          "taskRevision",
          taskRevision);
    }
  }

  public record Run(
      UUID id,
      UUID taskId,
      Snapshot snapshot,
      String trigger,
      String status,
      Instant scheduledAt,
      Instant startedAt,
      Instant finishedAt,
      Instant dispatchedAt,
      Instant deadline,
      JsonNode handle,
      JsonNode resultLink,
      String resultSummary,
      JsonNode executionDetails,
      Failure error,
      String result,
      Long spendTime) {
    public ScheduleApplication.Execution execution() {
      return new ScheduleApplication.Execution(
          taskId,
          id,
          snapshot.domainId(),
          snapshot.creatorId(),
          snapshot.definition(),
          snapshot.locale(),
          trigger,
          scheduledAt,
          startedAt);
    }

    public JsonNode summaryView() {
      return object(
          "id",
          id,
          "taskId",
          taskId,
          "trigger",
          trigger,
          "status",
          status,
          "scheduledAt",
          scheduledAt,
          "startedAt",
          startedAt,
          "finishedAt",
          finishedAt,
          "error",
          error,
          "resultSummary",
          resultSummary,
          "resultLink",
          resultLink,
          "spendTime",
          spendTime);
    }

    public JsonNode wire() {
      var value = (com.fasterxml.jackson.databind.node.ObjectNode) summaryView();
      value.set("snapshot", snapshot.wire());
      value.set("result", JSON.valueToTree(result));
      value.set("executionDetails", JSON.valueToTree(executionDetails));
      return value;
    }
  }

  private static Instant instant(ResultSet row, String key) throws SQLException {
    var value = row.getTimestamp(key);
    return value == null ? null : value.toInstant();
  }

  private static JsonNode json(ResultSet row, String key) throws SQLException {
    String value = row.getString(key);
    return value == null ? null : parse(value);
  }

  public static Timestamp timestamp(Instant value) {
    return value == null ? null : Timestamp.from(value);
  }

  private Task task(ResultSet row, int index) throws SQLException {
    var definition =
        new TaskDefinition(
            row.getString("title"),
            row.getString("app_id"),
            json(row, "content"),
            row.getString("form_revision"),
            json(row, "frequency"),
            row.getString("time_zone"),
            row.getString("notify_email"));
    return new Task(
        row.getObject("id", UUID.class),
        row.getString("domain_id"),
        row.getString("creator_id"),
        definition,
        json(row, "summary"),
        row.getString("locale"),
        row.getBoolean("enabled"),
        row.getString("pause_code") == null
            ? null
            : new Failure(row.getString("pause_code"), row.getString("pause_message")),
        instant(row, "next_run_at"),
        row.getLong("revision"),
        instant(row, "created_at"),
        instant(row, "updated_at"));
  }

  private Run mapRun(ResultSet row, int index) throws SQLException {
    Snapshot snapshot;
    try {
      snapshot = JSON.treeToValue(json(row, "definition_snapshot"), Snapshot.class);
    } catch (Exception error) {
      throw new SQLException("Invalid execution snapshot", error);
    }
    return new Run(
        row.getObject("id", UUID.class),
        row.getObject("task_id", UUID.class),
        snapshot,
        row.getString("trigger"),
        row.getString("status"),
        instant(row, "scheduled_at"),
        instant(row, "started_at"),
        instant(row, "finished_at"),
        instant(row, "dispatched_at"),
        instant(row, "deadline"),
        json(row, "handle"),
        json(row, "result_link"),
        row.getString("result_summary"),
        json(row, "execution_details"),
        row.getString("error_code") == null
            ? null
            : new Failure(row.getString("error_code"), row.getString("error_message")),
        row.getString("result"),
        row.getObject("spend_time", Long.class));
  }

  public Task get(UUID id, boolean lock) {
    return db
        .query(
            "SELECT * FROM platform_task WHERE id=?" + (lock ? " FOR UPDATE" : ""), this::task, id)
        .stream()
        .findFirst()
        .orElse(null);
  }

  public List<Task> visible(String domain, String creator, String app) {
    return db.query(
        """
SELECT t.* FROM platform_task t LEFT JOIN LATERAL
(SELECT status FROM platform_task_run WHERE task_id=t.id ORDER BY started_at DESC,id DESC LIMIT 1) r ON true
WHERE t.domain_id=? AND t.creator_id=? AND (?::text IS NULL OR t.app_id=?)
ORDER BY (t.pause_code IS NOT NULL OR coalesce(r.status='failed',false)) DESC,
CASE WHEN t.pause_code IS NOT NULL OR r.status='failed' THEN t.updated_at END DESC NULLS LAST,
CASE WHEN t.pause_code IS NULL AND r.status IS DISTINCT FROM 'failed' THEN t.next_run_at END ASC NULLS LAST,t.id
""",
        this::task,
        domain,
        creator,
        app,
        app);
  }

  public void insert(
      UUID id,
      String domain,
      String creator,
      TaskDefinition definition,
      JsonNode summary,
      String locale,
      Instant next,
      boolean enabled) {
    db.update(
        """
INSERT INTO platform_task(id,domain_id,creator_id,app_id,title,content,form_revision,summary,frequency,
time_zone,notify_email,locale,next_run_at,enabled) VALUES(?,?,?,?,?,?::jsonb,?,?::jsonb,?::jsonb,?,?,?,?,?)
""",
        id,
        domain,
        creator,
        definition.appId(),
        definition.title(),
        definition.content().toString(),
        definition.formRevision(),
        summary.toString(),
        definition.frequency().toString(),
        definition.timeZone(),
        definition.notifyEmail(),
        locale,
        timestamp(next),
        enabled);
  }

  public void update(
      Task task, TaskDefinition definition, JsonNode summary, String locale, Instant next) {
    db.update(
        """
UPDATE platform_task SET title=?,app_id=?,content=?::jsonb,form_revision=?,summary=?::jsonb,frequency=?::jsonb,
time_zone=?,notify_email=?,locale=?,next_run_at=?,pause_code=NULL,pause_message=NULL,revision=revision+1,updated_at=now() WHERE id=?
""",
        definition.title(),
        definition.appId(),
        definition.content().toString(),
        definition.formRevision(),
        summary.toString(),
        definition.frequency().toString(),
        definition.timeZone(),
        definition.notifyEmail(),
        locale,
        timestamp(next),
        task.id());
  }

  public Run run(UUID id) {
    return db.query("SELECT * FROM platform_task_run WHERE id=?", this::mapRun, id).stream()
        .findFirst()
        .orElse(null);
  }

  public List<Run> history(UUID id, Instant before, UUID beforeId, int limit) {
    return db.query(
        """
SELECT * FROM platform_task_run WHERE task_id=? AND (?::timestamptz IS NULL OR (started_at,id)<(?,?))
ORDER BY started_at DESC,id DESC LIMIT ?
""",
        this::mapRun,
        id,
        timestamp(before),
        timestamp(before),
        beforeId,
        limit);
  }

  public UUID active(UUID id) {
    return db
        .queryForList(
            "SELECT id FROM platform_task_run WHERE task_id=? AND status='running'", UUID.class, id)
        .stream()
        .findFirst()
        .orElse(null);
  }

  public Run latestResult(UUID id) {
    return db
        .query(
            "SELECT * FROM platform_task_run WHERE task_id=? AND result_link IS NOT NULL ORDER BY"
                + " started_at DESC,id DESC LIMIT 1",
            this::mapRun,
            id)
        .stream()
        .findFirst()
        .orElse(null);
  }

  public Run admit(Task task, UUID id, String trigger, Instant scheduledAt) {
    var snapshot =
        new Snapshot(
            task.domain(),
            task.creator(),
            task.definition(),
            task.summary(),
            task.locale(),
            task.revision());
    int rows =
        db.update(
            """
INSERT INTO platform_task_run(id,task_id,definition_snapshot,trigger,scheduled_at) VALUES(?,?,?::jsonb,?,?) ON CONFLICT DO NOTHING
""",
            id,
            task.id(),
            JSON.valueToTree(snapshot).toString(),
            trigger,
            timestamp(scheduledAt));
    return rows == 1 ? run(id) : null;
  }

  public void skipped(Task task, Instant scheduledAt) {
    var snapshot =
        new Snapshot(
            task.domain(),
            task.creator(),
            task.definition(),
            task.summary(),
            task.locale(),
            task.revision());
    db.update(
        """
INSERT INTO platform_task_run(id,task_id,definition_snapshot,trigger,status,scheduled_at,finished_at,error_code,error_message)
VALUES(?,?,?::jsonb,'schedule','skipped',?,now(),'prior_run_active','The previous execution is still running')
""",
        UUID.randomUUID(),
        task.id(),
        JSON.valueToTree(snapshot).toString(),
        timestamp(scheduledAt));
  }

  public static UUID session(UUID runId) {
    return UUID.nameUUIDFromBytes(
        ("platform-task-session:" + runId).getBytes(StandardCharsets.UTF_8));
  }

  public void deleteUser(String id) {
    db.update("DELETE FROM platform_task WHERE creator_id=?", id);
    db.update("DELETE FROM platform_task_credential WHERE creator_id=?", id);
  }
}
