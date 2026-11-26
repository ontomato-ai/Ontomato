package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.ParameterForms;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.transaction.support.TransactionTemplate;

/** Offline cutover. The old services must not be writing when apply runs. */
public final class TriggerUpgrade {
  private final DataSource source;
  private final JdbcTemplate db;
  private final TriggerUpgradeReferences references;
  private final String legacyZone;

  TriggerUpgrade(DataSource source, DataSource workbench, String legacyZone) {
    this.source = source;
    this.db = new JdbcTemplate(source);
    this.references = new TriggerUpgradeReferences(workbench);
    this.legacyZone = legacyZone;
  }

  public static void main(String[] args) {
    if (args.length != 2 || !List.of("check", "apply").contains(args[0])
        || !List.of("oss", "enterprise").contains(args[1]))
      throw new IllegalArgumentException("Usage: TriggerUpgrade check|apply oss|enterprise");
    String pg = "jdbc:postgresql://" + env("POSTGRES_HOST", "postgres") + ":"
        + env("POSTGRES_PORT", "5432") + "/";
    var datarag = new DriverManagerDataSource(env("DATA_ENGINE_JDBC_URL", pg + "datarag"),
        env("POSTGRES_USER", ""), env("POSTGRES_PASSWORD", ""));
    var workbench = workbenchSource(pg, args[1].equals("oss") ? "ontomato" : "data_agent");
    new TriggerUpgrade(datarag, workbench, ZoneId.systemDefault().getId()).run(args[0].equals("apply"));
  }

  private static DriverManagerDataSource workbenchSource(String pg, String database) {
    String explicit = env("DATABASE_URL", env("PG_CONNECTION_STRING", ""));
    var workbench = new DriverManagerDataSource(pg + database, env("POSTGRES_USER", ""),
        env("POSTGRES_PASSWORD", ""));
    if (!explicit.isEmpty()) {
      var uri = workbenchUri(explicit);
      workbench.setUrl("jdbc:postgresql://" + uri.getRawAuthority().substring(
          uri.getRawAuthority().lastIndexOf('@') + 1) + uri.getRawPath()
          + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()));
      workbench.setUsername(null);
      workbench.setPassword(null);
      if (uri.getRawUserInfo() != null) {
        var credentials = uri.getRawUserInfo().split(":", 2);
        workbench.setUsername(URLDecoder.decode(credentials[0].replace("+", "%2B"), StandardCharsets.UTF_8));
        if (credentials.length == 2)
          workbench.setPassword(URLDecoder.decode(credentials[1].replace("+", "%2B"), StandardCharsets.UTF_8));
      }
    }
    workbench.setSchema(env("PG_SCHEMA", "public"));
    return workbench;
  }

  private static URI workbenchUri(String value) {
    try {
      var uri = new URI(value);
      if (("postgres".equals(uri.getScheme()) || "postgresql".equals(uri.getScheme()))
          && uri.getRawAuthority() != null && uri.getRawFragment() == null) return uri;
    } catch (URISyntaxException malformed) {
      // A parser error includes the URL, which can contain the deployed password.
      throw new IllegalArgumentException("Malformed Workbench database URL");
    }
    throw new IllegalArgumentException("Workbench database URL must be PostgreSQL");
  }

  private static String env(String key, String fallback) {
    String value = System.getenv(key);
    return value == null || value.isBlank() ? fallback : value;
  }

  static boolean table(JdbcTemplate db, String table) {
    return db.queryForObject("SELECT to_regclass(quote_ident(current_schema()) || '.' || quote_ident(?)) IS NOT NULL",
        Boolean.class, table);
  }

  private boolean column(String table, String column) {
    return db.queryForObject("""
        SELECT EXISTS (SELECT FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=? AND column_name=?)
        """, Boolean.class, table, column);
  }

  void run(boolean apply) {
    var tx = new TransactionTemplate(new DataSourceTransactionManager(source));
    tx.setReadOnly(!apply);
    tx.executeWithoutResult(status -> convert(apply));
    System.out.println(apply ? "Trigger upgrade complete" : "Trigger upgrade check complete");
  }

  private record Definition(String id, String domain, String creator, String executor, JsonNode coauthors,
      String reviewer, String status, int version, TaskDefinition body, JsonNode summary, long revision,
      boolean enabled, String pause, String pauseMessage, Timestamp next, Timestamp last, String locale,
      Timestamp created, Timestamp modified) {}

  record TaskKey(String domain, String id) {}

  private void convert(boolean apply) {
    var issues = new ArrayList<String>();
    references.checkPredecessors(issues);
    predecessor(db, "write_task", "id", issues);
    predecessor(db, "write_task_result", "id", issues);
    boolean tasks = table(db, "platform_task");
    boolean runs = table(db, "platform_task_run");
    boolean triggers = table(db, "trigger_def");
    boolean oldTriggers = triggers && column("trigger_def", "condition_config");
    if (tasks && column("platform_task", "target")) predecessorRows(db, "platform_task", "id", issues);
    boolean markers = tasks && column("platform_task", "migrated_to_trigger");
    if (tasks != runs || (triggers && !oldTriggers) != table(db, "trigger_run"))
      issues.add("Incomplete definition/history table set; repair the source before conversion");
    if (table(db, "platform_task_credential") && !column("platform_task_credential", "creator_id"))
      issues.add("Complete the application-form conversion of platform_task_credential first");
    refuse(issues);

    if (!tasks && !oldTriggers) {
      var catalog = references.catalog(db, Map.of(), issues);
      refuse(issues);
      if (apply) catalog.run();
      references.workbench(Map.of(), apply);
      System.out.println(triggers ? "Unified trigger tables already installed" : "No schedule data to convert");
      return;
    }
    if (triggers && !oldTriggers && count(db, "trigger_def") != 0)
      predecessorRows(db, "platform_task", "id", issues);
    refuse(issues);

    var definitions = new LinkedHashMap<String, Definition>();
    var taskIds = new LinkedHashMap<TaskKey, String>();
    if (oldTriggers) {
      for (var row : db.queryForList("SELECT * FROM trigger_def ORDER BY domain_id,id"))
        inspect(issues, "trigger_def", row, () -> {
          var trigger = oldTrigger(row);
          definitions.put(trigger.id(), trigger);
        });
    }
    if (tasks) {
      for (var row : db.queryForList("SELECT * FROM platform_task ORDER BY domain_id,id"))
        inspect(issues, "platform_task", row, () -> {
          var key = new TaskKey(value(row, "domain_id"), value(row, "id"));
          String marked = markers ? value(row, "migrated_to_trigger") : null;
          if (marked != null) {
            var target = definitions.get(marked);
            if (!"ontology".equals(value(row, "app_id")) || target == null || !key.domain().equals(target.domain()))
              throw new IllegalArgumentException("migrated_to_trigger references no matching same-domain Trigger: " + marked);
            if (!key.id().equals(marked) && definitions.containsKey(key.id()))
              throw new IllegalArgumentException("Task ID collides with an unrelated Trigger: " + key.id());
            taskIds.put(key, marked);
          } else {
            if (definitions.containsKey(key.id())) throw new IllegalArgumentException("Unmarked task ID collides with a Trigger");
            var task = oldTask(row);
            definitions.put(key.id(), task);
            taskIds.put(key, key.id());
          }
        });
    }
    var runCounts = new LinkedHashMap<String, Long>();
    var convertedRuns = new ArrayList<Run>();
    if (runs) {
      // Large results stay in PostgreSQL; only metadata needed to transfer the historical reference is read here.
      for (var row : db.queryForList("""
          SELECT r.id,r.task_id,r.definition_snapshot,r.trigger,r.status,r.finished_at,r.result_link,
              r.execution_details->>'legacyIdentity' AS legacy_identity,t.domain_id
          FROM platform_task_run r LEFT JOIN platform_task t ON t.id=r.task_id ORDER BY t.domain_id,r.id
          """))
        inspect(issues, "platform_task_run", row, () -> {
          var key = new TaskKey(value(row, "domain_id"), value(row, "task_id"));
          var id = taskIds.get(key);
          if (id == null) throw new IllegalArgumentException("History has no convertible task: " + key.id());
          String status = value(row, "status");
          if ("running".equals(status) || row.get("finished_at") == null)
            throw new IllegalArgumentException("Old scheduler must settle this run before conversion (task " + key.id() + ")");
          if (!List.of("completed", "failed", "skipped").contains(status))
            throw new IllegalArgumentException("Unsupported run status: " + status);
          var snapshot = snapshot(row, key);
          var link = resultLink(row, key, id);
          convertedRuns.add(new Run(row.get("id"), id, snapshot, link));
          runCounts.merge(key.domain(), 1L, Long::sum);
        });
    }
    refuse(issues);
    var definitionCounts = new LinkedHashMap<String, Long>();
    definitions.values().forEach(d -> definitionCounts.merge(d.domain(), 1L, Long::sum));
    taskIds.forEach((task, canonical) -> System.out.println(object("domainId", task.domain(),
        "oldTaskId", task.id(), "triggerId", canonical)));
    definitionCounts.forEach((domain, count) -> System.out.println(object("domainId", domain,
        "triggers", count, "runs", runCounts.getOrDefault(domain, 0L))));
    var catalog = references.catalog(db, taskIds, issues);
    refuse(issues);
    if (apply) {
      if (oldTriggers) {
        // The source still owns trigger_def_pkey until its rows and references are installed.
        db.execute("ALTER TABLE trigger_def RENAME CONSTRAINT trigger_def_pkey TO trigger_upgrade_source_pkey");
        db.execute("ALTER TABLE trigger_def RENAME TO trigger_upgrade_source");
      }
      new ResourceDatabasePopulator(new ClassPathResource("triggers.sql")).execute(source);
      definitions.values().forEach(this::insertDefinition);
      convertedRuns.forEach(this::insertRun);
      verify(definitionCounts, runCounts);
      catalog.run();
      db.execute("DROP TABLE IF EXISTS ontology_schedule_reference,platform_task_run,platform_task,platform_task_import,trigger_upgrade_source");
      // Commit product references first. If this fails, the source transaction still has its original IDs on rerun.
      references.workbench(taskIds, true);
    } else {
      references.workbench(taskIds, false);
    }
  }

  private static void inspect(List<String> issues, String table, Map<String, Object> row, Runnable convert) {
    try {
      convert.run();
    } catch (IllegalArgumentException | DateTimeException | ScheduleException error) {
      issues.add(table + " " + value(row, "id") + " [domain=" + value(row, "domain_id") + "]: " + error.getMessage());
    }
  }

  private static void refuse(List<String> issues) {
    if (!issues.isEmpty()) throw new IllegalStateException("Trigger upgrade blocked:\n" + String.join("\n", issues));
  }

  static void predecessor(JdbcTemplate db, String table, String key, List<String> issues) {
    if (table(db, table) && count(db, table) != 0) predecessorRows(db, table, key, issues);
  }

  private static void predecessorRows(JdbcTemplate db, String table, String key, List<String> issues) {
    issues.add("Complete the predecessor conversion for " + table + " first; source IDs: "
        + db.queryForList("SELECT " + key + "::text FROM " + table + " ORDER BY 1", String.class));
  }

  private static long count(JdbcTemplate db, String table) {
    return db.queryForObject("SELECT count(*) FROM " + table, Long.class);
  }

  private Definition oldTrigger(Map<String, Object> row) {
    String id = value(row, "id"), domain = value(row, "domain_id"), creator = value(row, "created_by");
    String executor = value(row, "executor");
    if (executor == null || executor.isBlank() || "requester".equals(executor)) executor = creator;
    else if (executor.startsWith("principal:")) executor = executor.substring("principal:".length());
    String status = value(row, "status"), kind = value(row, "effect_kind");
    if (creator == null || creator.isBlank() || executor == null || executor.isBlank()
        || row.get("create_timestamp") == null || row.get("modify_timestamp") == null)
      throw new IllegalArgumentException("Missing creator, execution principal or timestamps");
    if (!"time".equals(value(row, "condition_kind"))) throw new IllegalArgumentException("Unsupported trigger condition");
    var condition = parse(value(row, "condition_config"));
    var effect = parse(value(row, "effect_config"));
    String zone = optionalText(condition, "timeZone");
    if (zone == null || zone.isBlank()) zone = legacyZone;
    var frequency = legacyFrequency(condition.path("frequency"));
    String target;
    ObjectNode content;
    switch (kind) {
      case "action" -> {
        target = text(effect, "actionId");
        content = object("parameters", effect.hasNonNull("parameters") ? effect.get("parameters") : object());
      }
      case "workflow" -> {
        target = text(effect, "workflowId");
        content = object("inputs", effect.hasNonNull("inputs") ? effect.get("inputs") : object());
        if (effect.hasNonNull("requester")) content.set("requester", effect.get("requester"));
        if (effect.hasNonNull("goalText")) content.set("goalText", effect.get("goalText"));
      }
      default -> throw new IllegalArgumentException("Unsupported trigger effect: " + kind);
    }
    requireTarget(kind, target, domain);
    var body = new TaskDefinition(value(row, "name"), null, content, null, frequency, zone, null,
        value(row, "description"), kind, target);
    body.validate();
    var coauthors = value(row, "coauthor_ids");
    var memberIds = coauthors == null ? array() : parse(coauthors);
    if (!memberIds.isArray()) throw new IllegalArgumentException("Invalid coauthor_ids");
    for (var member : memberIds)
      if (!member.isTextual() || member.asText().isBlank()) throw new IllegalArgumentException("Invalid coauthor ID");
    boolean enabled = (Boolean) row.get("enabled");
    var next = (Timestamp) row.get("next_run_at");
    if (!List.of("PENDING_REVIEW", "PUBLISHED", "UNUSED").contains(status)
        || enabled && !"PUBLISHED".equals(status) || !enabled && next != null)
      throw new IllegalArgumentException("Inconsistent trigger status, enabled state or next slot");
    return new Definition(id, domain, creator, executor, memberIds, value(row, "reviewed_by"), status,
        ((Number) row.get("version")).intValue(), body, array(), 1, enabled, null, null, next,
        (Timestamp) row.get("last_fired_at"), "zh-CN", millis(row, "create_timestamp"), millis(row, "modify_timestamp"));
  }

  private static JsonNode legacyFrequency(JsonNode value) {
    if (!(value instanceof ObjectNode clock)) throw new IllegalArgumentException("Missing time frequency");
    String kind = text(clock, "kind");
    if (List.of("daily", "weekly", "monthly").contains(kind) && !clock.hasNonNull("time")) clock.put("time", "00:00");
    String number = switch (kind) {
      case "interval" -> "every";
      case "weekly" -> "weekday";
      case "monthly" -> "day";
      default -> null;
    };
    // Old Trigger forms accepted whole JSON numbers written as 1.0 as well as 1.
    if (number != null && clock.path(number).isFloatingPointNumber()) {
      var decimal = clock.get(number).decimalValue().stripTrailingZeros();
      if (decimal.scale() <= 0 && decimal.precision() - decimal.scale() <= 4) clock.put(number, decimal.intValue());
    }
    return clock;
  }

  private Definition oldTask(Map<String, Object> row) {
    String app = value(row, "app_id"), domain = value(row, "domain_id"), creator = value(row, "creator_id");
    String form = value(row, "form_revision"), kind = "application", target = null;
    String zone = value(row, "time_zone"), locale = value(row, "locale");
    JsonNode content = parse(value(row, "content")), summary = parse(value(row, "summary"));
    if ("ontology".equals(app)) {
      kind = "action";
      target = scheduledAction(text(content, "execution"), domain);
      content = actionContent(target, domain, content, zone, locale);
      app = null;
      form = null;
      summary = array();
    }
    String notifyEmail = value(row, "notify_email");
    var body = new TaskDefinition(value(row, "title"), app, content, form, parse(value(row, "frequency")),
        zone, notifyEmail == null || notifyEmail.isBlank() ? null : notifyEmail, null, kind, target);
    body.validate();
    return new Definition(value(row, "id"), domain, creator, creator, array(), null, "PUBLISHED", 1, body,
        summary, ((Number) row.get("revision")).longValue(), (Boolean) row.get("enabled"), value(row, "pause_code"),
        value(row, "pause_message"), (Timestamp) row.get("next_run_at"), null, locale,
        (Timestamp) row.get("created_at"), (Timestamp) row.get("updated_at"));
  }

  private String scheduledAction(String execution, String domain) {
    if (execution.startsWith("action:")) {
      String id = execution.substring(7);
      requireTarget("action", id, domain);
      return id;
    }
    if (execution.startsWith("function:")) {
      String function = execution.substring(9);
      var actions = db.queryForList("SELECT id FROM action WHERE domain_id=? AND function_id=? AND status='PUBLISHED' ORDER BY id",
          String.class, domain, function);
      if (actions.size() != 1)
        throw new IllegalArgumentException("Function " + function + " needs one same-domain published wrapping Action; found " + actions);
      return actions.getFirst();
    }
    throw new IllegalArgumentException("Unsupported ontology execution: " + execution);
  }

  private JsonNode actionContent(String id, String domain, JsonNode content, String zone, String locale) {
    var rows = db.queryForList("""
        SELECT f.parameters::text FROM action a JOIN function f ON f.id=a.function_id
        WHERE a.id=? AND a.domain_id=? AND f.domain_id=?
        """, String.class, id, domain, domain);
    if (rows.size() != 1 || rows.getFirst() == null)
      throw new IllegalArgumentException("Missing same-domain function parameter declaration for Action " + id);
    var parameters = com.alibaba.fastjson2.JSON.parseArray(rows.getFirst(), Parameter.class);
    var dynamic = array();
    var staticParameters = new ArrayList<Parameter>();
    var fieldKeys = new HashSet<String>();
    for (var parameter : parameters) {
      String key = "parameter:" + parameter.getName();
      fieldKeys.add(key);
      if (Parameter.TYPE_TIME.equals(parameter.getType()) && content.path(key).asText().isBlank())
        dynamic.add(parameter.getName());
      else staticParameters.add(parameter);
    }
    content.fieldNames().forEachRemaining(key -> {
      if (!"execution".equals(key) && !fieldKeys.contains(key))
        throw new IllegalArgumentException("Stored Action parameter no longer exists: " + key);
    });
    var parsed = ParameterForms.scheduled(staticParameters, "parameter:", content, ZoneId.of(zone),
        Instant.EPOCH, "/content/", locale);
    if (!parsed.errors().isEmpty()) throw new IllegalArgumentException("Cannot convert Action parameters: " + parsed.errors());
    var target = object("parameters", parsed.values());
    if (!dynamic.isEmpty()) target.set("runStartParameters", dynamic);
    return target;
  }

  private void requireTarget(String kind, String id, String domain) {
    if (!db.queryForObject("SELECT EXISTS(SELECT FROM " + kind + " WHERE id=? AND domain_id=?)",
        Boolean.class, id, domain)) throw new IllegalArgumentException("Missing same-domain " + kind + " target: " + id);
  }

  private record Run(Object id, String taskId, JsonNode snapshot, JsonNode link) {}

  private JsonNode snapshot(Map<String, Object> row, TaskKey key) {
    var old = parse(value(row, "definition_snapshot"));
    if (!(old instanceof ObjectNode snapshot) || !(old.get("definition") instanceof ObjectNode definition)
        || !key.domain().equals(text(old, "domainId")))
      throw new IllegalArgumentException("Invalid or cross-domain definition snapshot");
    String creator = text(snapshot, "creatorId");
    boolean knownIdentity = !"unknown".equals(value(row, "legacy_identity"));
    snapshot.put("executorId", knownIdentity ? creator : null);
    String notifyEmail = optionalText(definition, "notifyEmail");
    snapshot.put("notifyEmailSetBy", knownIdentity && notifyEmail != null && !notifyEmail.isBlank() ? creator : null);
    snapshot.put("version", 1);
    String app = text(definition, "appId");
    definition.putNull("description");
    // A historical function may no longer have a wrapper, or a different Action may wrap it today.
    // Keep its exact original execution in content; do not claim the current Action ran in the past.
    if ("ontology".equals(app)) {
      var execution = text(definition.get("content"), "execution");
      if (execution.startsWith("action:")) {
        definition.put("targetKind", "action");
        definition.put("targetId", execution.substring(7));
        return snapshot;
      }
    }
    definition.put("targetKind", "application");
    definition.putNull("targetId");
    return snapshot;
  }

  private JsonNode resultLink(Map<String, Object> row, TaskKey key, String canonical) {
    String stored = value(row, "result_link");
    if (stored == null) return null;
    if (!(parse(stored) instanceof ObjectNode link)) throw new IllegalArgumentException("Invalid run result link");
    String path = text(link, "path");
    if (path.equals("/schedules?taskId=" + key.id() + "&runId=" + row.get("id"))) {
      link.put("appId", "schedules");
      link.put("path", "/schedules?taskId=" + TriggerUpgradeReferences.encode(canonical) + "&runId=" + row.get("id"));
    }
    return link;
  }

  private void insertDefinition(Definition d) {
    var b = d.body();
    db.update("""
        INSERT INTO trigger_def (id,domain_id,creator_id,executor_id,coauthor_ids,reviewed_by,status,version,
          target_kind,target_id,app_id,title,description,content,form_revision,summary,revision,frequency,time_zone,
          enabled,pause_code,pause_message,next_run_at,last_fired_at,notify_email,notify_email_set_by,locale,created_at,updated_at)
        VALUES (?,?,?,?,?::jsonb,?,?,?,?,?,?,?,?,?::jsonb,?,?::jsonb,?,?::jsonb,?,?,?,?,?,?,?,?,?,?,?)
        """, d.id(), d.domain(), d.creator(), d.executor(), d.coauthors().toString(), d.reviewer(), d.status(), d.version(),
        b.targetKind(), b.targetId(), b.appId(), b.title(), b.description(), b.content().toString(), b.formRevision(),
        d.summary().toString(), d.revision(), b.frequency().toString(), b.timeZone(), d.enabled(), d.pause(), d.pauseMessage(),
        d.next(), d.last(), b.notifyEmail(), b.notifyEmail() == null ? null : d.creator(), d.locale(), d.created(), d.modified());
  }

  private void insertRun(Run run) {
    db.update("""
        INSERT INTO trigger_run (id,task_id,definition_snapshot,trigger,status,scheduled_at,dispatched_at,deadline,
          started_at,finished_at,handle,result_link,result_summary,execution_details,result,error_code,error_message,spend_time)
        SELECT id,?,?::jsonb,trigger,status,scheduled_at,dispatched_at,deadline,started_at,finished_at,handle,
          ?::jsonb,result_summary,execution_details,result,error_code,error_message,spend_time FROM platform_task_run WHERE id=?
        """, run.taskId(), run.snapshot().toString(), run.link() == null ? null : run.link().toString(), run.id());
  }

  private void verify(Map<String, Long> definitions, Map<String, Long> runs) {
    var actualDefinitions = counts("SELECT domain_id,count(*) FROM trigger_def GROUP BY domain_id");
    var actualRuns = counts("SELECT t.domain_id,count(*) FROM trigger_run r JOIN trigger_def t ON t.id=r.task_id GROUP BY t.domain_id");
    if (!definitions.equals(actualDefinitions) || !runs.equals(actualRuns))
      throw new IllegalStateException("Trigger upgrade count mismatch. Expected definitions " + definitions + " and runs " + runs
          + "; wrote definitions " + actualDefinitions + " and runs " + actualRuns);
  }

  private Map<String, Long> counts(String sql) {
    return db.query(sql, rs -> {
      var counts = new LinkedHashMap<String, Long>();
      while (rs.next()) counts.put(rs.getString(1), rs.getLong(2));
      return counts;
    });
  }

  private static String value(Map<String, Object> row, String key) {
    return row.get(key) == null ? null : row.get(key).toString();
  }

  private static Timestamp millis(Map<String, Object> row, String key) {
    return Timestamp.from(Instant.ofEpochMilli(((Number) row.get(key)).longValue()));
  }
}
