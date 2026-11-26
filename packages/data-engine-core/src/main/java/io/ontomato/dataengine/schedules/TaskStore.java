package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.bean.trigger.Trigger;
import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.context.annotation.DependsOn;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.stereotype.Repository;

@Repository
@DependsOn("functionDao")
public class TaskStore {
  private final JdbcTemplate db;
  private final DataSource source;

  public TaskStore(JdbcTemplate db, DataSource source) {
    this.db = db;
    this.source = source;
  }

  public JdbcTemplate jdbc() { return db; }

  @PostConstruct
  void initialize() {
    if (Boolean.TRUE.equals(db.queryForObject("SELECT to_regclass('platform_task') IS NOT NULL OR "
        + "EXISTS(SELECT FROM information_schema.columns WHERE table_schema=current_schema() "
        + "AND table_name='trigger_def' AND column_name='condition_kind')", Boolean.class)))
      throw new IllegalStateException("Convert legacy trigger and schedule definitions before starting DataRAG");
    createTables();
  }

  void createTables() {
    new ResourceDatabasePopulator(new ClassPathResource("triggers.sql")).execute(source);
  }

  public record Failure(String code, String message) {}

  public record Snapshot(
      String domainId, String creatorId, TaskDefinition definition, JsonNode summary,
      String locale, long taskRevision, String executorId, int version, String notifyEmailSetBy) {
    JsonNode wire(boolean owner) {
      return object(
          "title", owner ? definition.title() : "Historical execution", "description", owner ? definition.description() : null,
          "appId", definition.appId(), "targetKind", definition.targetKind(), "targetId", owner ? definition.targetId() : null,
          "content", owner ? definition.content() : object(), "formRevision", owner ? definition.formRevision() : null,
          "frequency", definition.frequency(), "creatorId", creatorId, "domainId", domainId, "executorId", executorId, "version", version,
          "summary", owner ? summary : array(), "timeZone", definition.timeZone(), "notifyEmail", owner ? definition.notifyEmail() : null,
          "locale", locale, "taskRevision", taskRevision);
    }
  }

  public record Run(
      UUID id, String taskId, Snapshot snapshot, String trigger, String status,
      Instant scheduledAt, Instant startedAt, Instant finishedAt, Instant dispatchedAt, Instant deadline,
      JsonNode handle, JsonNode resultLink, String resultSummary, JsonNode executionDetails,
      Failure error, String result, Long spendTime) {
    public ScheduleApplication.Execution execution() {
      return new ScheduleApplication.Execution(taskId, id, snapshot.domainId(), snapshot.executorId(),
          snapshot.definition(), snapshot.locale(), trigger, scheduledAt, startedAt);
    }

    public JsonNode summaryView(String member) {
      boolean owner = member.equals(snapshot.executorId());
      return object(
          "id", id, "taskId", taskId, "trigger", trigger, "status", status,
          "scheduledAt", scheduledAt, "startedAt", startedAt, "finishedAt", finishedAt,
          "error", owner ? error : null,
          "resultSummary", owner ? resultSummary : null, "resultLink", owner ? resultLink : null,
          "spendTime", spendTime);
    }

    public JsonNode wire(String member) {
      var value = (com.fasterxml.jackson.databind.node.ObjectNode) summaryView(member);
      boolean owner = member.equals(snapshot.executorId());
      value.set("snapshot", snapshot.wire(owner));
      value.set("result", JSON.valueToTree(owner ? result : null));
      value.set("executionDetails", owner ? JSON.valueToTree(executionDetails) : object("legacyIdentity", "unknown"));
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

  public static Timestamp timestamp(Instant value) { return value == null ? null : Timestamp.from(value); }

  private static Trigger task(ResultSet row, int index) throws SQLException {
    var definition = new TaskDefinition(row.getString("title"), row.getString("app_id"), json(row, "content"),
        row.getString("form_revision"), json(row, "frequency"), row.getString("time_zone"), row.getString("notify_email"),
        row.getString("description"), row.getString("target_kind"), row.getString("target_id"));
    List<String> coauthors = JSON.convertValue(json(row, "coauthor_ids"), new com.fasterxml.jackson.core.type.TypeReference<>() {});
    return new Trigger(row.getString("id"), row.getString("domain_id"), row.getString("creator_id"),
        row.getString("executor_id"), coauthors, row.getString("reviewed_by"), row.getString("status"), row.getInt("version"),
        definition, row.getString("notify_email_set_by"), json(row, "summary"), row.getString("locale"), row.getBoolean("enabled"),
        row.getString("pause_code") == null ? null : new Failure(row.getString("pause_code"), row.getString("pause_message")),
        instant(row, "next_run_at"), instant(row, "last_fired_at"), row.getLong("revision"),
        instant(row, "created_at"), instant(row, "updated_at"));
  }

  private static Run mapRun(ResultSet row, int index) throws SQLException {
    Snapshot snapshot;
    try {
      snapshot = JSON.treeToValue(json(row, "definition_snapshot"), Snapshot.class);
    } catch (JsonProcessingException error) {
      throw new SQLException("Invalid execution snapshot", error);
    }
    return new Run(row.getObject("id", UUID.class), row.getString("task_id"), snapshot, row.getString("trigger"),
        row.getString("status"), instant(row, "scheduled_at"), instant(row, "started_at"), instant(row, "finished_at"),
        instant(row, "dispatched_at"), instant(row, "deadline"), json(row, "handle"), json(row, "result_link"),
        row.getString("result_summary"), json(row, "execution_details"),
        row.getString("error_code") == null ? null : new Failure(row.getString("error_code"), row.getString("error_message")),
        row.getString("result"), row.getObject("spend_time", Long.class));
  }

  public Trigger get(String id, boolean lock) {
    return db.query("SELECT * FROM trigger_def WHERE id=?" + (lock ? " FOR UPDATE" : ""), TaskStore::task, id)
        .stream().findFirst().orElse(null);
  }

  public List<Trigger> candidates(String domain, String app, String kind, String status) {
    return db.query("""
        SELECT t.* FROM trigger_def t WHERE t.domain_id=? AND (?::text IS NULL OR t.app_id=?)
        AND (?::text IS NULL OR t.target_kind=?) AND (?::text IS NULL OR t.status=?)
        """, TaskStore::task, domain, app, app, kind, kind, status, status);
  }

  public Set<String> registeredIds(String domain, Set<String> ids) {
    return Set.copyOf(new NamedParameterJdbcTemplate(db).queryForList(
        "SELECT id FROM trigger_def WHERE domain_id=:domain AND id IN (:ids)",
        Map.of("domain", domain, "ids", ids), String.class));
  }

  public long creatorCount(String domain, String creator, String app) {
    return db.queryForObject("SELECT count(*) FROM trigger_def WHERE domain_id=? AND creator_id=? AND app_id=?",
        Long.class, domain, creator, app);
  }

  public List<Trigger> executedBy(String domain, String executor) {
    return db.query("SELECT * FROM trigger_def WHERE domain_id=? AND executor_id=? AND target_kind<>'action'",
        TaskStore::task, domain, executor);
  }

  public List<Trigger> due(Instant now) {
    return db.query("""
        SELECT * FROM trigger_def WHERE status='PUBLISHED' AND enabled AND pause_code IS NULL AND next_run_at<=?
        ORDER BY next_run_at,id LIMIT 100 FOR UPDATE SKIP LOCKED
        """, TaskStore::task, timestamp(now));
  }

  public void advance(Trigger trigger, Instant next, Instant lastFiredAt) {
    db.update("UPDATE trigger_def SET next_run_at=?,last_fired_at=? WHERE id=?",
        timestamp(next), timestamp(lastFiredAt), trigger.id());
  }

  public boolean insert(String id, String domain, String creator, String executor, List<String> coauthors,
      TaskDefinition definition, String notifyEmailSetBy, JsonNode summary, String locale, String status, String reviewer, Instant next, boolean enabled) {
    return db.update("""
        INSERT INTO trigger_def(id,domain_id,creator_id,executor_id,coauthor_ids,app_id,title,description,
        target_kind,target_id,content,form_revision,summary,frequency,time_zone,notify_email,notify_email_set_by,locale,status,reviewed_by,next_run_at,enabled)
        VALUES(?,?,?,?,?::jsonb,?,?,?,?,?,?::jsonb,?,?::jsonb,?::jsonb,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING
        """, id, domain, creator, executor, JSON.valueToTree(coauthors).toString(), definition.appId(),
        definition.title(), definition.description(), definition.targetKind(), definition.targetId(), definition.content().toString(),
        definition.formRevision(), summary.toString(), definition.frequency().toString(), definition.timeZone(), definition.notifyEmail(),
        notifyEmailSetBy, locale, status, reviewer, timestamp(next), enabled) == 1;
  }

  public void update(String id, String executor, List<String> coauthors, TaskDefinition definition,
      String notifyEmailSetBy, JsonNode summary, String locale, String reviewer, boolean publish, Instant next) {
    db.update("""
        UPDATE trigger_def SET executor_id=?,coauthor_ids=?::jsonb,title=?,description=?,app_id=?,target_kind=?,target_id=?,
        content=?::jsonb,form_revision=?,summary=?::jsonb,frequency=?::jsonb,time_zone=?,notify_email=?,notify_email_set_by=?,locale=?,
        reviewed_by=?,version=version+?,next_run_at=?,pause_code=NULL,pause_message=NULL,revision=revision+1,updated_at=now() WHERE id=?
        """, executor, JSON.valueToTree(coauthors).toString(), definition.title(), definition.description(), definition.appId(),
        definition.targetKind(), definition.targetId(), definition.content().toString(), definition.formRevision(), summary.toString(),
        definition.frequency().toString(), definition.timeZone(), definition.notifyEmail(), notifyEmailSetBy, locale, reviewer, publish ? 1 : 0, timestamp(next), id);
  }

  public void lifecycle(String id, String status, boolean enabled, String reviewer, boolean publish, Instant next) {
    db.update("""
        UPDATE trigger_def SET status=?,enabled=?,reviewed_by=?,version=version+?,next_run_at=?,
        pause_code=NULL,pause_message=NULL,revision=revision+1,updated_at=now() WHERE id=?
        """, status, enabled, reviewer, publish ? 1 : 0, timestamp(next), id);
  }

  public Run run(UUID id) {
    return db.query("SELECT * FROM trigger_run WHERE id=?", TaskStore::mapRun, id).stream().findFirst().orElse(null);
  }

  public List<Run> history(Trigger task, String owner, Instant before, UUID beforeId, int limit) {
    return db.query("""
        SELECT * FROM trigger_run WHERE task_id=? AND definition_snapshot->>'domainId'=?
        AND (definition_snapshot->>'executorId'=? OR (? AND definition_snapshot->>'executorId' IS NULL))
        AND (?::timestamptz IS NULL OR (started_at,id)<(?,?)) ORDER BY started_at DESC,id DESC LIMIT ?
        """, TaskStore::mapRun, task.id(), task.domain(), owner, owner.equals(task.creator()), timestamp(before), timestamp(before), beforeId, limit);
  }

  public UUID active(String id) {
    return db.queryForList("SELECT id FROM trigger_run WHERE task_id=? AND status='running'", UUID.class, id)
        .stream().findFirst().orElse(null);
  }

  record RunViews(String id, UUID active, UUID latestResult, JsonNode link, Run lastRun) {}

  List<RunViews> runViews(List<String> ids, String member) {
    if (ids.isEmpty()) return List.of();
    return new NamedParameterJdbcTemplate(db).query("""
        SELECT t.id AS definition_id, active.id AS active_id, result.id AS result_id, result.result_link AS owner_link, last_run.*
        FROM trigger_def t
        LEFT JOIN trigger_run active ON active.task_id=t.id AND active.status='running'
        LEFT JOIN LATERAL (SELECT * FROM trigger_run WHERE task_id=t.id ORDER BY started_at DESC,id DESC LIMIT 1) last_run ON true
        LEFT JOIN LATERAL (SELECT id,result_link FROM trigger_run WHERE task_id=t.id AND result_link IS NOT NULL
          AND definition_snapshot->>'domainId'=t.domain_id AND definition_snapshot->>'executorId'=:member
          ORDER BY started_at DESC,id DESC LIMIT 1) result ON true
        WHERE t.id IN (:ids)
        """, Map.of("ids", ids, "member", member), (row, index) -> new RunViews(row.getString("definition_id"),
        row.getObject("active_id", UUID.class), row.getObject("result_id", UUID.class), json(row, "owner_link"),
        row.getString("id") == null ? null : mapRun(row, index)));
  }

  private static String snapshot(Trigger task, String executor) {
    return JSON.valueToTree(new Snapshot(task.domain(), task.creator(), task.definition(), task.summary(),
        task.locale(), task.revision(), executor, task.version(), task.notifyEmailSetBy())).toString();
  }

  public Run admit(Trigger task, String executor, UUID id, String trigger, Instant scheduledAt) {
    int rows = db.update("""
        INSERT INTO trigger_run(id,task_id,definition_snapshot,trigger,scheduled_at) VALUES(?,?,?::jsonb,?,?) ON CONFLICT DO NOTHING
        """, id, task.id(), snapshot(task, executor), trigger, timestamp(scheduledAt));
    return rows == 1 ? run(id) : null;
  }

  public void skipped(Trigger task, Instant scheduledAt) {
    db.update("""
        INSERT INTO trigger_run(id,task_id,definition_snapshot,trigger,status,scheduled_at,finished_at,error_code,error_message)
        VALUES(?,?,?::jsonb,'schedule','skipped',?,now(),'prior_run_active','The previous execution is still running')
        """, UUID.randomUUID(), task.id(), snapshot(task, task.executor()), timestamp(scheduledAt));
  }

  public static UUID session(UUID runId) {
    return UUID.nameUUIDFromBytes(("platform-task-session:" + runId).getBytes(StandardCharsets.UTF_8));
  }

  public void deleteUser(String id) {
    db.update("DELETE FROM trigger_def WHERE creator_id=?", id);
    db.update("DELETE FROM platform_task_credential WHERE creator_id=?", id);
  }
}
