package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.scheduling.OntologyScheduleApplication;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** Offline conversion. Check and upgrade share the same creator selection and input validation. */
public class ScheduleMigration {
  private final JdbcTemplate db;
  private final TaskStore store;
  private final boolean oss;

  public ScheduleMigration(JdbcTemplate db, TaskStore store, boolean oss) {
    this.db = db;
    this.store = store;
    this.oss = oss;
  }

  static String env(String key, String fallback) {
    String value = System.getenv(key);
    return value == null || value.isBlank() ? fallback : value;
  }

  private static DriverManagerDataSource source(String url, String prefix) {
    return new DriverManagerDataSource(
        url,
        env(prefix + "_USER", System.getenv("POSTGRES_USER")),
        env(prefix + "_PASSWORD", System.getenv("POSTGRES_PASSWORD")));
  }

  public static void main(String[] args) {
    if (args.length < 2
        || !List.of("forms-check", "forms-upgrade", "import", "retire").contains(args[0])
        || !List.of("oss", "enterprise").contains(args[1]))
      throw new IllegalArgumentException(
          "Usage: forms-check|forms-upgrade oss|enterprise; import|retire oss|enterprise <old Node"
              + " zone> <old Java zone>");
    String pg =
        "jdbc:postgresql://"
            + env("POSTGRES_HOST", "postgres")
            + ":"
            + env("POSTGRES_PORT", "5432")
            + "/";
    var target = source(env("DATA_ENGINE_JDBC_URL", pg + "datarag"), "SCHEDULE_TARGET");
    var db = new JdbcTemplate(target);
    var store = new TaskStore(db, new ObjectMapper(), target);
    var migration = new ScheduleMigration(db, store, args[1].equals("oss"));
    if (args[0].equals("forms-check")) migration.check();
    else if (args[0].equals("forms-upgrade"))
      new TransactionTemplate(new DataSourceTransactionManager(target))
          .executeWithoutResult(tx -> migration.upgrade());
    else {
      if (args.length != 4)
        throw new IllegalArgumentException(
            "The original import requires the old Node and Java time zones");
      var old =
          source(
              env("SCHEDULE_SOURCE_JDBC_URL", pg + (migration.oss ? "ontomato" : "data_agent")),
              "SCHEDULE_SOURCE");
      var properties = new java.util.Properties();
      properties.setProperty("currentSchema", env("PG_SCHEMA", "public"));
      old.setConnectionProperties(properties);
      var node = new JdbcTemplate(old);
      if (args[0].equals("retire")) migration.retire(node);
      else
        new TransactionTemplate(new DataSourceTransactionManager(target))
            .executeWithoutResult(
                tx ->
                    migration.importOriginal(
                        node, ZoneId.of(args[2]).getId(), ZoneId.of(args[3]).getId()));
    }
    System.out.println("Platform schedules " + args[0] + " complete");
  }

  public static boolean exists(JdbcTemplate db, String table) {
    return Boolean.TRUE.equals(
        db.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, table));
  }

  private String creator(String domain, String owner) {
    if (oss) {
      if (!"1".equals(domain) || owner != null && !List.of("system", "admin").contains(owner))
        throw new IllegalStateException("Unexpected OSS creator/domain");
      return "admin";
    }
    if (owner != null) return owner;
    var candidates =
        db.queryForList(
            """
SELECT m.user_id,m.create_time FROM sys_domain_membership m JOIN sys_user u ON u.id=m.user_id
JOIN sys_domain d ON d.id=m.domain_id WHERE m.domain_id=? AND m.is_admin=1 AND u.active=1 AND u.enable=1
ORDER BY m.create_time ASC NULLS LAST,m.user_id ASC
""",
            domain);
    System.out.println(
        object(
            "domainId",
            domain,
            "adminCandidates",
            candidates,
            "selectedCreator",
            candidates.isEmpty() ? null : candidates.getFirst().get("user_id")));
    if (candidates.isEmpty())
      throw new IllegalStateException("No active built-in domain administrator: " + domain);
    return candidates.getFirst().get("user_id").toString();
  }

  public void check() {
    if (!exists(db, "platform_task")) {
      System.out.println(
          "No platform schedule tables; fresh installation or original import required");
      return;
    }
    if (!TaskStore.column(db, "platform_task", "target")) {
      System.out.println("Application-form schema already installed");
      verify();
      return;
    }
    if (Boolean.TRUE.equals(
        db.queryForObject(
            "SELECT EXISTS(SELECT FROM platform_task_run WHERE status='running')", Boolean.class)))
      throw new IllegalStateException("In-flight executions must be settled before conversion");
    if (Boolean.TRUE.equals(
        db.queryForObject(
            "SELECT EXISTS(SELECT FROM platform_task_run WHERE status NOT IN ('completed','failed')"
                + " OR finished_at IS NULL)",
            Boolean.class)))
      throw new IllegalStateException(
          "Review incomplete or invalid historical execution states before conversion");
    for (var row : db.queryForList("SELECT * FROM platform_task ORDER BY domain_id,id")) {
      String domain = string(row, "domain_id");
      String owner = creator(domain, string(row, "owner_id"));
      var target = parse(row.get("target").toString());
      var definition = converted(row, target);
      definition.validate();
      System.out.println(
          object(
              "taskId",
              row.get("id"),
              "appId",
              definition.appId(),
              "creatorId",
              owner,
              "title",
              definition.title()));
    }
    System.out.println(
        object(
            "tasks",
            db.queryForObject("SELECT count(*) FROM platform_task", Long.class),
            "runs",
            db.queryForObject("SELECT count(*) FROM platform_task_run", Long.class)));
  }

  private Function function(String id) {
    var rows = db.queryForList("SELECT * FROM function WHERE id=?", id);
    if (rows.isEmpty()) return null;
    var row = rows.getFirst();
    var value = new Function();
    value.setId(id);
    value.setName(string(row, "name"));
    value.setDomainId(string(row, "domain_id"));
    value.setOperation(string(row, "operation"));
    value.setCode(string(row, "code"));
    if (row.get("return_def") != null)
      value.setReturnDef(
          com.alibaba.fastjson2.JSON.parseObject(
              row.get("return_def").toString(),
              io.ontomato.dataengine.bean.function.ReturnDef.class));
    value.setParameters(
        com.alibaba.fastjson2.JSON.parseArray(
            java.util.Objects.toString(row.get("parameters"), "[]"), Parameter.class));
    if (row.get("query_package") != null)
      value.setQueryPackage(
          com.alibaba.fastjson2.JSON.parseObject(row.get("query_package").toString()));
    return value;
  }

  private TaskDefinition converted(Map<String, Object> row, JsonNode target) {
    String kind = target.path("kind").asText(), title = string(row, "name"), app, revision;
    JsonNode content;
    if (kind.equals("agent")) {
      app = "agents";
      revision = "agents-v1";
      String prompt = text(target, "prompt");
      UUID.fromString(text(target, "agentId"));
      content = object("agentId", target.path("agentId").asText(), "instruction", prompt);
      if (title == null || title.isBlank())
        title = prompt.lines().filter(line -> !line.isBlank()).findFirst().orElseThrow();
    } else if (kind.equals("function")) {
      app = "ontology";
      String id = text(target, "functionId");
      var function = function(id);
      if (function != null
          && !java.util.Objects.equals(string(row, "domain_id"), function.getDomainId()))
        function = null;
      content = object("execution", "function:" + id);
      revision =
          function == null
              ? "unavailable"
              : OntologyScheduleApplication.formRevision(function, null);
      if (title == null || title.isBlank())
        title =
            function == null || function.getName() == null || function.getName().isBlank()
                ? "Scheduled function " + id
                : function.getName();
    } else throw new IllegalStateException("Unknown legacy target on task " + row.get("id"));
    title = title.trim();
    if (title.length() > 200) title = title.substring(0, 200);
    return new TaskDefinition(
        title,
        app,
        content,
        revision,
        parse(row.get("frequency").toString()),
        string(row, "time_zone"),
        string(row, "notify_email"));
  }

  private JsonNode summary(TaskDefinition definition) {
    var values = array();
    var fields = definition.content().fields();
    while (fields.hasNext()) {
      var field = fields.next();
      String label =
          switch (field.getKey()) {
            case "agentId" -> "Agent";
            case "instruction" -> "Instruction";
            case "execution" -> "Execute";
            default -> field.getKey();
          };
      String value = field.getValue().asText();
      if (field.getKey().equals("execution") && value.startsWith("function:"))
        value = value.substring(9);
      values.add(
          object(
              "key",
              field.getKey(),
              "label",
              label,
              "value",
              value.substring(0, Math.min(160, value.length()))));
    }
    return values;
  }

  private void references() {
    io.ontomato.dataengine.service.scheduling.OntologyScheduleReferences.createSchema(db);
  }

  public void upgrade() {
    db.execute("SELECT pg_advisory_xact_lock(42861475)");
    check();
    if (!exists(db, "platform_task")) {
      store.createTables();
      references();
      return;
    }
    if (!TaskStore.column(db, "platform_task", "target")) return;
    db.execute(
        "LOCK TABLE platform_task,platform_task_run,platform_task_credential IN ACCESS EXCLUSIVE"
            + " MODE");
    var tasks = db.queryForList("SELECT * FROM platform_task");
    var runs = db.queryForList("SELECT * FROM platform_task_run");
    // Drop the legacy target/owner constraint, then replace the model in one transaction.
    for (var constraint :
        db.queryForList(
            "SELECT conname FROM pg_constraint WHERE conrelid='platform_task'::regclass AND"
                + " contype='c'",
            String.class))
      db.execute(
          "ALTER TABLE platform_task DROP CONSTRAINT \"" + constraint.replace("\"", "\"\"") + "\"");
    db.execute(
        """
ALTER TABLE platform_task DROP COLUMN function_id;
ALTER TABLE platform_task RENAME COLUMN owner_id TO creator_id;
ALTER TABLE platform_task RENAME COLUMN name TO title;
ALTER TABLE platform_task ADD COLUMN content jsonb, ADD COLUMN form_revision text, ADD COLUMN summary jsonb,
ADD COLUMN revision bigint NOT NULL DEFAULT 1, ADD COLUMN pause_code text, ADD COLUMN pause_message text;
ALTER TABLE platform_task_run ADD COLUMN definition_snapshot jsonb, ADD COLUMN scheduled_at timestamptz,
ADD COLUMN handle jsonb, ADD COLUMN result_link jsonb, ADD COLUMN result_summary text, ADD COLUMN execution_details jsonb;
ALTER TABLE platform_task_credential RENAME COLUMN owner_id TO creator_id;
""");
    references();
    for (var row : tasks) {
      UUID id = (UUID) row.get("id");
      var target = parse(row.get("target").toString());
      String domain = string(row, "domain_id");
      var definition = converted(row, target);
      String owner = creator(domain, string(row, "owner_id"));
      String pause = string(row, "paused_reason");
      if ("agent_unavailable".equals(pause)) pause = "target_unavailable";
      if (!Boolean.TRUE.equals(row.get("enabled"))) pause = null;
      if (target.path("kind").asText().equals("function")) {
        var function = function(target.path("functionId").asText());
        if (function != null && domain.equals(function.getDomainId())) {
          db.update(
              "INSERT INTO ontology_schedule_reference VALUES(?,NULL,?)", id, function.getId());
          if (!Function.OPERATION_WRITE.equals(function.getOperation())
              || function.getParameters() == null
              || !function.getParameters().isEmpty()) pause = "target_unavailable";
        } else pause = "target_unavailable";
      }
      if (!Boolean.TRUE.equals(row.get("enabled"))) pause = null;
      db.update(
          """
UPDATE platform_task SET title=?,app_id=?,creator_id=?,content=?::jsonb,form_revision=?,summary=?::jsonb,
pause_code=?,pause_message=?,next_run_at=CASE WHEN ?::text IS NOT NULL THEN NULL ELSE next_run_at END WHERE id=?
""",
          definition.title(),
          definition.appId(),
          owner,
          definition.content().toString(),
          definition.formRevision(),
          summary(definition).toString(),
          pause,
          pause == null ? null : "Migrated task requires attention: " + pause,
          pause,
          id);
    }
    for (var row : runs) {
      var task =
          tasks.stream()
              .filter(value -> value.get("id").equals(row.get("task_id")))
              .findFirst()
              .orElseThrow();
      var definition = converted(task, parse(row.get("target").toString()));
      String domain = string(task, "domain_id");
      String owner = creator(domain, string(task, "owner_id"));
      var snapshot =
          new TaskStore.Snapshot(
              domain, owner, definition, summary(definition), string(task, "locale"), 1);
      String error = legacyError(string(row, "status"), string(row, "error_code"));
      JsonNode handle = null, link = null;
      Object session = row.get("session_id");
      if (session != null) {
        handle = object("sessionId", session.toString());
        link = object("appId", "agents", "path", "/agents/chat?sessionId=" + session);
      }
      if (definition.appId().equals("ontology"))
        link =
            object(
                "appId",
                "ontology",
                "path",
                "/schedules?taskId=" + row.get("task_id") + "&runId=" + row.get("id"));
      db.update(
          "UPDATE platform_task_run SET"
              + " definition_snapshot=?::jsonb,handle=?::jsonb,result_link=?::jsonb,error_code=?,execution_details=?::jsonb"
              + " WHERE id=?",
          JSON.valueToTree(snapshot).toString(),
          handle == null ? null : handle.toString(),
          link == null ? null : link.toString(),
          error,
          definition.appId().equals("ontology")
              ? object("legacyIdentity", "unknown").toString()
              : null,
          row.get("id"));
    }
    db.execute(
        """
ALTER TABLE platform_task ALTER COLUMN creator_id SET NOT NULL, ALTER COLUMN content SET NOT NULL,
ALTER COLUMN form_revision SET NOT NULL, ALTER COLUMN summary SET NOT NULL;
ALTER TABLE platform_task DROP COLUMN target,DROP COLUMN description,DROP COLUMN paused_reason;
ALTER TABLE platform_task_run ALTER COLUMN definition_snapshot SET NOT NULL;
ALTER TABLE platform_task_run DROP COLUMN target,DROP COLUMN session_id;
DROP INDEX IF EXISTS platform_task_owner,platform_task_due,platform_task_one_running,platform_task_history;
""");
    store.createTables();
    verify();
  }

  private void verify() {
    if (Boolean.TRUE.equals(
        db.queryForObject(
            "SELECT EXISTS(SELECT FROM platform_task WHERE creator_id IS NULL OR title IS NULL OR"
                + " content IS NULL OR form_revision IS NULL)",
            Boolean.class))) throw new IllegalStateException("Incomplete schedule conversion");
    if (Boolean.TRUE.equals(
        db.queryForObject(
            "SELECT EXISTS(SELECT FROM platform_task_run r LEFT JOIN platform_task t ON"
                + " t.id=r.task_id WHERE t.id IS NULL OR r.definition_snapshot IS NULL)",
            Boolean.class)))
      throw new IllegalStateException("Incomplete execution history conversion");
  }

  private static String string(Map<String, Object> row, String key) {
    return row.get(key) == null ? null : row.get(key).toString();
  }

  private void importOriginal(JdbcTemplate node, String nodeZone, String javaZone) {
    db.execute("SELECT pg_advisory_xact_lock(42861475)");
    if (exists(db, "platform_task_import")) {
      checkSource(node);
      verify();
      return;
    }
    if (exists(db, "platform_task") && TaskStore.column(db, "platform_task", "target"))
      throw new IllegalStateException(
          "Convert existing platform tasks before an original-source import");
    store.createTables();
    references();
    if (Boolean.TRUE.equals(
        db.queryForObject("SELECT EXISTS(SELECT FROM platform_task)", Boolean.class)))
      throw new IllegalStateException("Import before creating platform tasks");
    if (exists(node, "analysis_schedule_rules") && !exists(node, "scheduled_tasks"))
      throw new IllegalStateException("An older baseline requires its own upgrade first");
    if (exists(node, "scheduled_task_credentials"))
      for (var row : node.queryForList("SELECT * FROM scheduled_task_credentials")) {
        String key = oldKey(string(row, "sealed_key"), env("AGENT_RUNTIME_SERVICE_TOKEN", ""));
        db.update(
            "INSERT INTO platform_task_credential VALUES(?,?,?,?)",
            string(row, "domain_id"),
            creator(string(row, "domain_id"), string(row, "owner_id")),
            TaskCredentials.seal(key, env("AGENT_RUNTIME_ONTOLOGY_TOKEN", "")),
            "valid".equals(row.get("state")) && (oss || key != null));
      }
    if (exists(node, "scheduled_tasks"))
      for (var row : node.queryForList("SELECT * FROM scheduled_tasks")) {
        var old = new java.util.HashMap<String, Object>(row);
        old.put("name", null);
        old.put("time_zone", nodeZone);
        var target =
            object(
                "kind",
                "agent",
                "agentId",
                string(row, "agent_id"),
                "prompt",
                string(row, "prompt"));
        var definition = converted(old, target);
        definition.validate();
        String domain = string(row, "domain_id"), owner = creator(domain, string(row, "owner_id"));
        boolean enabled = Boolean.TRUE.equals(row.get("enabled"));
        db.update(
            "INSERT INTO platform_task_credential VALUES(?,?,NULL,?) ON CONFLICT DO NOTHING",
            domain,
            owner,
            oss);
        boolean valid =
            Boolean.TRUE.equals(
                db.queryForObject(
                    "SELECT valid FROM platform_task_credential WHERE domain_id=? AND creator_id=?",
                    Boolean.class,
                    domain,
                    owner));
        store.insert(
            (UUID) row.get("id"),
            domain,
            owner,
            definition,
            summary(definition),
            string(row, "locale"),
            row.get("next_run_at") == null
                ? null
                : ((java.sql.Timestamp) row.get("next_run_at")).toInstant(),
            enabled);
        String pause = string(row, "paused_reason");
        if ("agent_unavailable".equals(pause)) pause = "target_unavailable";
        if (enabled && !valid) pause = "credential_invalid";
        db.update(
            "UPDATE platform_task SET"
                + " created_at=?,updated_at=?,pause_code=?,pause_message=?,next_run_at=CASE WHEN"
                + " NOT enabled OR ?::text IS NOT NULL THEN NULL ELSE next_run_at END WHERE id=?",
            row.get("created_at"),
            row.get("updated_at"),
            enabled ? pause : null,
            pause == null ? null : "Migrated task requires attention",
            pause,
            row.get("id"));
      }
    if (exists(db, "write_task"))
      for (var row : db.queryForList("SELECT * FROM write_task")) {
        if (!env("SERVICE_ID", "").equals(row.get("service_id")))
          throw new IllegalStateException("Different SERVICE_ID on task " + row.get("id"));
        String domain = string(row, "domain_id"), owner = creator(domain, null);
        UUID id = UUID.fromString(string(row, "id"));
        var old = new java.util.HashMap<String, Object>(row);
        old.put("time_zone", javaZone);
        old.put("frequency", object("kind", "cron", "expression", row.get("cron")).toString());
        var definition =
            converted(old, object("kind", "function", "functionId", row.get("function_id")));
        definition.validate();
        boolean enabled = "RUNNING".equals(row.get("status"));
        if (!enabled && !"STOPPED".equals(row.get("status")))
          throw new IllegalStateException("Unknown task status");
        Instant now = Instant.now();
        store.insert(
            id,
            domain,
            owner,
            definition,
            summary(definition),
            "en",
            enabled ? definition.next(now, now) : null,
            enabled);
        var function = function(string(row, "function_id"));
        if (function != null && domain.equals(function.getDomainId()))
          db.update(
              "INSERT INTO ontology_schedule_reference VALUES(?,NULL,?)", id, function.getId());
        else if (enabled)
          db.update(
              "UPDATE platform_task SET pause_code='target_unavailable',pause_message='Target"
                  + " unavailable',next_run_at=NULL WHERE id=?",
              id);
        db.update(
            "UPDATE platform_task SET"
                + " created_at=coalesce(to_timestamp(?::bigint/1000.0),created_at),updated_at=coalesce(to_timestamp(?::bigint/1000.0),updated_at)"
                + " WHERE id=?",
            row.get("create_timestamp"),
            row.get("modify_timestamp"),
            id);
      }
    importOriginalRuns(node);
    db.execute(
        "CREATE TABLE platform_task_import(completed_at timestamptz NOT NULL,source_database text"
            + " NOT NULL,source_schema text NOT NULL)");
    var location =
        node.queryForMap("SELECT current_database() AS database,current_schema() AS schema");
    db.update(
        "INSERT INTO platform_task_import VALUES(now(),?,?)",
        location.get("database"),
        location.get("schema"));
    verify();
  }

  private static String legacyError(String status, String code) {
    if (!"failed".equals(status)) return null;
    if ("agent_unavailable".equals(code)) return "target_unavailable";
    return code != null
            && List.of(
                    "credential_invalid",
                    "target_unavailable",
                    "dependency_unavailable",
                    "start_failed",
                    "run_failed",
                    "interrupted")
                .contains(code)
        ? code
        : "legacy_failure";
  }

  private void importOriginalRuns(JdbcTemplate node) {
    if (exists(node, "scheduled_task_runs"))
      for (var row : node.queryForList("SELECT * FROM scheduled_task_runs")) {
        if (!List.of("completed", "failed").contains(string(row, "status"))
            || row.get("finished_at") == null)
          throw new IllegalStateException(
              "Review unfinished original execution history before importing");
        var task = store.get((UUID) row.get("task_id"), false);
        if (task == null) throw new IllegalStateException("Orphan scheduled execution");
        var snapshot =
            new TaskStore.Snapshot(
                task.domain(), task.creator(), task.definition(), task.summary(), task.locale(), 1);
        Object session = row.get("session_id");
        JsonNode handle = session == null ? null : object("sessionId", session.toString());
        JsonNode link =
            session == null
                ? null
                : object("appId", "agents", "path", "/agents/chat?sessionId=" + session);
        String error = legacyError(string(row, "status"), string(row, "error_code"));
        db.update(
            "INSERT INTO"
                + " platform_task_run(id,task_id,definition_snapshot,trigger,status,started_at,finished_at,error_code,error_message,handle,result_link,result)"
                + " VALUES(?,?,?::jsonb,?,?,?,?,?,?,?::jsonb,?::jsonb,?)",
            row.get("id"),
            task.id(),
            JSON.valueToTree(snapshot).toString(),
            row.get("trigger"),
            row.get("status"),
            row.get("started_at"),
            row.get("finished_at"),
            error,
            row.get("error_message"),
            handle == null ? null : handle.toString(),
            link == null ? null : link.toString(),
            row.get("result"));
      }
    if (exists(db, "write_task_result"))
      for (var row : db.queryForList("SELECT * FROM write_task_result")) {
        var task = store.get(UUID.fromString(string(row, "write_task_id")), false);
        if (task == null) throw new IllegalStateException("Orphan write task result");
        var snapshot =
            new TaskStore.Snapshot(
                task.domain(), task.creator(), task.definition(), task.summary(), task.locale(), 1);
        long spent =
            row.get("spend_time") == null ? 0 : ((Number) row.get("spend_time")).longValue();
        long started = ((Number) row.get("execute_timestamp")).longValue();
        db.update(
            "INSERT INTO"
                + " platform_task_run(id,task_id,definition_snapshot,trigger,status,started_at,finished_at,result,error_code,error_message,spend_time,result_link,execution_details)"
                + " VALUES(?,?,?::jsonb,'unknown',?,?,?,?,?,?,?,?::jsonb,?::jsonb)",
            UUID.fromString(string(row, "id")),
            task.id(),
            JSON.valueToTree(snapshot).toString(),
            row.get("error") == null ? "completed" : "failed",
            TaskStore.timestamp(Instant.ofEpochMilli(started)),
            TaskStore.timestamp(Instant.ofEpochMilli(started + spent)),
            row.get("result"),
            row.get("error") == null ? null : "run_failed",
            row.get("error"),
            spent,
            object(
                    "appId",
                    "ontology",
                    "path",
                    "/schedules?taskId=" + task.id() + "&runId=" + row.get("id"))
                .toString(),
            object("legacyIdentity", "unknown").toString());
      }
  }

  private void checkSource(JdbcTemplate node) {
    var source =
        node.queryForMap(
            "SELECT current_database() AS source_database,current_schema() AS source_schema");
    if (!db.queryForMap("SELECT source_database,source_schema FROM platform_task_import")
        .equals(source)) throw new IllegalStateException("Import source changed");
  }

  private void retire(JdbcTemplate node) {
    if (!exists(db, "platform_task_import"))
      throw new IllegalStateException("Import has not committed");
    checkSource(node);
    verify();
    node.execute(
        "DROP TABLE IF EXISTS scheduled_task_runs,scheduled_tasks,scheduled_task_credentials");
    db.execute("DROP TABLE IF EXISTS write_task_result,write_task");
  }

  static String oldKey(String sealed, String token) {
    if (sealed == null || token.isEmpty() || !sealed.startsWith("stc1.")) return null;
    try {
      byte[] bytes = Base64.getUrlDecoder().decode(sealed.substring(5));
      if (bytes.length < 28) return null;
      byte[] key =
          MessageDigest.getInstance("SHA-256")
              .digest(
                  ("workbench-scheduled-credential-v1\0" + token).getBytes(StandardCharsets.UTF_8));
      var cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec(key, "AES"),
          new GCMParameterSpec(128, bytes, 0, 12));
      var input =
          ByteBuffer.allocate(bytes.length - 12)
              .put(bytes, 28, bytes.length - 28)
              .put(bytes, 12, 16);
      return new String(cipher.doFinal(input.array()), StandardCharsets.UTF_8);
    } catch (Exception invalid) {
      return null;
    }
  }
}
