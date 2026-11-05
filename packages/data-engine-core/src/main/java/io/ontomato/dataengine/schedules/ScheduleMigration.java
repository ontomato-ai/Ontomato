package io.ontomato.dataengine.schedules;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** Offline cutover, run from the new DataRAG image with both old applications stopped. */
public class ScheduleMigration {
  private final JdbcTemplate node;
  private final TaskStore store;
  private final String targetToken;
  private final ObjectMapper json = new ObjectMapper();
  private final boolean oss;
  private final String nodeZone, javaZone, serviceId, sourceToken;

  ScheduleMigration(
      JdbcTemplate node,
      TaskStore store,
      boolean oss,
      String nodeZone,
      String javaZone,
      String serviceId,
      String sourceToken,
      String targetToken) {
    this.node = node;
    this.store = store;
    this.oss = oss;
    this.nodeZone = ZoneId.of(nodeZone).getId();
    this.javaZone = ZoneId.of(javaZone).getId();
    this.serviceId = serviceId;
    this.sourceToken = sourceToken;
    this.targetToken = targetToken;
  }

  private static String env(String key, String fallback) {
    var value = System.getenv(key);
    return value == null || value.isBlank() ? fallback : value;
  }

  private static DriverManagerDataSource source(String jdbc, String prefix) {
    return new DriverManagerDataSource(
        jdbc,
        env(prefix + "_USER", System.getenv("POSTGRES_USER")),
        env(prefix + "_PASSWORD", System.getenv("POSTGRES_PASSWORD")));
  }

  public static void main(String[] args) {
    if (args.length != 4
        || !(args[0].equals("import") || args[0].equals("retire"))
        || !(args[1].equals("oss") || args[1].equals("enterprise")))
      throw new IllegalArgumentException(
          "Usage: import|retire oss|enterprise <old Node zone> <old Java zone>");
    boolean oss = args[1].equals("oss");
    String pg =
        "jdbc:postgresql://"
            + env("POSTGRES_HOST", "postgres")
            + ":"
            + env("POSTGRES_PORT", "5432")
            + "/";
    var target = source(env("DATA_ENGINE_JDBC_URL", pg + "datarag"), "SCHEDULE_TARGET");
    String schema = env("PG_SCHEMA", "public");
    // Set the source connection's search path, including when a custom JDBC URL is provided.
    var old =
        source(
            env("SCHEDULE_SOURCE_JDBC_URL", pg + (oss ? "ontomato" : "data_agent")),
            "SCHEDULE_SOURCE");
    var properties = new java.util.Properties();
    properties.setProperty("currentSchema", schema);
    old.setConnectionProperties(properties);
    var db = new JdbcTemplate(target);
    var store = new TaskStore(db, new ObjectMapper(), target);
    var migration =
        new ScheduleMigration(
            new JdbcTemplate(old),
            store,
            oss,
            args[2],
            args[3],
            env("SERVICE_ID", ""),
            env("AGENT_RUNTIME_SERVICE_TOKEN", ""),
            env("AGENT_RUNTIME_ONTOLOGY_TOKEN", ""));
    if (args[0].equals("retire")) migration.retire();
    else {
      store.createTables();
      new TransactionTemplate(new DataSourceTransactionManager(target))
          .executeWithoutResult(tx -> migration.copy());
    }
    System.out.println("Platform schedule " + args[0] + " complete");
  }

  static boolean exists(JdbcTemplate db, String table) {
    return Boolean.TRUE.equals(
        db.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, table));
  }

  private String owner(String domain, String user) {
    if (!oss) return user;
    if (!"system".equals(user) || !"1".equals(domain))
      throw new IllegalStateException("Unexpected open-source owner/domain");
    return "admin";
  }

  private static UUID uuid(Map<String, Object> row, String key) {
    return UUID.fromString(row.get(key).toString());
  }

  private static String string(Map<String, Object> row, String key) {
    return (String) row.get(key);
  }

  static String oldKey(String sealed, String token) {
    if (sealed == null) return null;
    if (token.isEmpty() || !sealed.startsWith("stc1.")) return null;
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
    } catch (GeneralSecurityException | IllegalArgumentException e) {
      return null;
    }
  }

  void copy() {
    store.jdbc().execute("SELECT pg_advisory_xact_lock(42861475)");
    if (exists(store.jdbc(), "platform_task_import")) {
      checkSource();
      return;
    }
    if (Boolean.TRUE.equals(
        store.jdbc().queryForObject("SELECT EXISTS(SELECT FROM platform_task)", Boolean.class)))
      throw new IllegalStateException("Import before creating new platform tasks");
    if (exists(node, "analysis_schedule_rules") && !exists(node, "scheduled_tasks"))
      throw new IllegalStateException(
          "Expected the agent-runtime scheduled_tasks baseline; preserve the older database");
    requireHistoryParent(node, "scheduled_task_runs", "scheduled_tasks");
    requireHistoryParent(store.jdbc(), "write_task_result", "write_task");
    if (exists(node, "scheduled_task_credentials")) {
      for (var r : node.queryForList("SELECT * FROM scheduled_task_credentials")) {
        var domain = string(r, "domain_id");
        String plain = oldKey(string(r, "sealed_key"), sourceToken);
        store.jdbc().update(
            "INSERT INTO platform_task_credential VALUES(?,?,?,?)",
            domain,
            owner(domain, string(r, "owner_id")),
            TaskCredentials.seal(plain, targetToken),
            "valid".equals(r.get("state")) && (oss || plain != null));
      }
    }
    if (exists(node, "scheduled_tasks")) {
      for (var r : node.queryForList("SELECT * FROM scheduled_tasks")) importAgent(r);
      if (exists(node, "scheduled_task_runs")) {
        // Stream the source by task, then catch any unrelated/orphan record with the total below.
        for (var t :
            store.jdbc().queryForList(
                "SELECT id FROM platform_task WHERE owner_id IS NOT NULL", UUID.class))
          for (var r : node.queryForList("SELECT * FROM scheduled_task_runs WHERE task_id=?", t))
            store.jdbc().update(
                """
INSERT INTO platform_task_run(id,task_id,target,session_id,trigger,status,error_code,error_message,
    started_at,finished_at,dispatched_at,deadline)
SELECT ?,id,target,?,?,?,?,?,?,?,?,? FROM platform_task WHERE id=?""",
                r.get("id"),
                r.get("session_id"),
                r.get("trigger"),
                r.get("status"),
                r.get("error_code"),
                r.get("error_message"),
                r.get("started_at"),
                r.get("finished_at"),
                r.get("started_at"),
                TaskStore.timestamp(Instant.now().plusSeconds(600)),
                t);
        compareCount(node, "scheduled_task_runs", "platform_task_run");
      }
      compareCount(node, "scheduled_tasks", "platform_task");
    }
    if (exists(store.jdbc(), "write_task")) {
      for (var r : store.jdbc().queryForList("SELECT * FROM write_task")) importFunction(r);
      if (exists(store.jdbc(), "write_task_result")) {
        int rows =
            store.jdbc().update(
                """
INSERT INTO platform_task_run(id,task_id,target,trigger,status,started_at,finished_at,result,
    error_code,error_message,spend_time)
SELECT r.id::uuid,t.id,t.target,'unknown',CASE WHEN r.error IS NULL THEN 'completed' ELSE 'failed' END,
to_timestamp(r.execute_timestamp/1000.0),to_timestamp((r.execute_timestamp+coalesce(r.spend_time,0))/1000.0),
r.result,CASE WHEN r.error IS NULL THEN NULL ELSE 'run_failed' END,r.error,r.spend_time
FROM write_task_result r JOIN platform_task t ON t.id=r.write_task_id::uuid AND t.owner_id IS NULL""");
        if (rows
            != store.jdbc().queryForObject("SELECT count(*) FROM write_task_result", Integer.class))
          throw new IllegalStateException(
              "Orphan write_task_result; archive or restore its task before cutover");
      }
    }
    store.jdbc().execute(
        "CREATE TABLE platform_task_import (completed_at timestamptz NOT NULL, source_database text"
            + " NOT NULL, source_schema text NOT NULL)");
    var source = sourceLocation();
    store.jdbc().update(
        "INSERT INTO platform_task_import VALUES(now(),?,?)",
        source.get("source_database"),
        source.get("source_schema"));
  }

  private void requireHistoryParent(JdbcTemplate db, String history, String parent) {
    if (!exists(db, parent)
        && exists(db, history)
        && Boolean.TRUE.equals(
            db.queryForObject("SELECT EXISTS(SELECT FROM " + history + ")", Boolean.class)))
      throw new IllegalStateException(
          "Orphan history in " + history + "; archive or restore missing tasks");
  }

  private void compareCount(JdbcTemplate source, String sourceTable, String targetTable) {
    long expected = source.queryForObject("SELECT count(*) FROM " + sourceTable, Long.class);
    if (expected != store.jdbc().queryForObject("SELECT count(*) FROM " + targetTable, Long.class))
      throw new IllegalStateException("Count mismatch in " + sourceTable);
  }

  private void importAgent(Map<String, Object> r) {
    UUID id = uuid(r, "id");
    try {
      String domain = string(r, "domain_id"),
          user = owner(domain, string(r, "owner_id")),
          prompt = string(r, "prompt");
      var target =
          json.createObjectNode()
              .put("kind", "agent")
              .put("agentId", uuid(r, "agent_id").toString())
              .put("prompt", prompt);
      var d =
          new TaskDefinition(
              prompt.lines().filter(l -> !l.isBlank()).findFirst().orElse(prompt),
              null,
              target,
              json.readTree(r.get("frequency").toString()),
              nodeZone,
              string(r, "notify_email"));
      d.validate();
      store.insert(id, domain, user, d, string(r, "locale"), null);
      store.jdbc().update(
          "INSERT INTO platform_task_credential VALUES(?,?,NULL,?) ON CONFLICT DO NOTHING",
          domain,
          user,
          oss);
      boolean valid =
          store.jdbc().queryForObject(
              "SELECT valid FROM platform_task_credential WHERE domain_id=? AND owner_id=?",
              Boolean.class,
              domain,
              user);
      String pause = string(r, "paused_reason");
      if ((boolean) r.get("enabled") && pause == null && !valid) pause = "credential_invalid";
      store.jdbc().update(
          "UPDATE platform_task SET"
              + " enabled=?,paused_reason=?,next_run_at=?,created_at=?,updated_at=? WHERE id=?",
          r.get("enabled"),
          pause,
          pause == null ? r.get("next_run_at") : null,
          r.get("created_at"),
          r.get("updated_at"),
          id);
    } catch (Exception e) {
      throw new IllegalStateException("Cannot migrate scheduled_tasks " + id, e);
    }
  }

  private void importFunction(Map<String, Object> r) {
    UUID id = uuid(r, "id");
    try {
      String domain = string(r, "domain_id"), function = string(r, "function_id");
      if (!serviceId.equals(r.get("service_id")))
        throw new IllegalStateException("Different SERVICE_ID");
      if (!Boolean.TRUE.equals(
          store.jdbc().queryForObject(
              """
SELECT EXISTS(SELECT FROM function WHERE id=? AND domain_id=? AND operation=?
  AND coalesce(nullif(query_package::jsonb,'null'::jsonb)#>'{manifest,parameterDefs}', parameters::jsonb)='[]'::jsonb)""",
              Boolean.class,
              function,
              domain,
              io.ontomato.dataengine.bean.function.Function.OPERATION_WRITE)))
        throw new IllegalStateException("Missing or invalid function in task domain");
      var target = json.createObjectNode().put("kind", "function").put("functionId", function);
      var freq = json.createObjectNode().put("kind", "cron").put("expression", string(r, "cron"));
      var d =
          new TaskDefinition(
              string(r, "name"), string(r, "description"), target, freq, javaZone, null);
      d.validate();
      boolean enabled =
          switch (string(r, "status")) {
            case "RUNNING" -> true;
            case "STOPPED" -> false;
            default -> throw new IllegalStateException("Invalid status");
          };
      Instant now = Instant.now();
      store.insert(id, domain, null, d, "en", enabled ? d.next(now, now) : null);
      store.jdbc().update(
          """
UPDATE platform_task SET enabled=?,created_at=coalesce(to_timestamp(?::bigint/1000.0),created_at),
updated_at=coalesce(to_timestamp(?::bigint/1000.0),updated_at) WHERE id=?""",
          enabled,
          r.get("create_timestamp"),
          r.get("modify_timestamp"),
          id);
    } catch (Exception e) {
      throw new IllegalStateException("Cannot migrate write_task " + id, e);
    }
  }

  private Map<String, Object> sourceLocation() {
    return node.queryForMap(
        "SELECT current_database() AS source_database,current_schema() AS source_schema");
  }

  private void checkSource() {
    if (!store
        .jdbc()
        .queryForMap("SELECT source_database,source_schema FROM platform_task_import")
        .equals(sourceLocation()))
      throw new IllegalStateException(
          "Source database or schema differs from the completed import");
  }

  void retire() {
    if (!exists(store.jdbc(), "platform_task_import"))
      throw new IllegalStateException("Import has not committed");
    checkSource();
    node.execute(
        "DROP TABLE IF EXISTS scheduled_task_runs,scheduled_tasks,scheduled_task_credentials");
    store.jdbc().execute("DROP TABLE IF EXISTS write_task_result,write_task");
  }
}
