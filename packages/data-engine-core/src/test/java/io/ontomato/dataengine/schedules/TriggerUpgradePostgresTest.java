package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.object;
import static io.ontomato.dataengine.schedules.ScheduleJson.parse;
import static org.junit.jupiter.api.Assertions.*;

import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.test.PostgresTestDatabase;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class TriggerUpgradePostgresTest extends PostgresTestDatabase {
  private final String nodeSchema = "test_workbench_" + UUID.randomUUID().toString().replace("-", "");
  private JdbcTemplate workbench;
  private TriggerUpgrade upgrade;

  @BeforeEach
  void installLegacySources() {
    jdbc.execute("CREATE SCHEMA " + nodeSchema);
    var node = new DriverManagerDataSource(dataSource.getUrl(), dataSource.getUsername(), dataSource.getPassword());
    var properties = new java.util.Properties();
    properties.setProperty("currentSchema", nodeSchema);
    node.setConnectionProperties(properties);
    workbench = new JdbcTemplate(node);
    upgrade = new TriggerUpgrade(dataSource, node, "Asia/Shanghai");
    workbench.execute("""
        CREATE TABLE platform_home_preferences (domain_id text,user_id text,home_panel_id text,pinned_objects jsonb);
        CREATE TABLE product_panels (domain_id text,id text,definition jsonb);
        CREATE TABLE product_panel_entry_dependencies (domain_id text,panel_id text,dependencies jsonb);
        """);
    jdbc.execute("""
        CREATE TABLE action (id text PRIMARY KEY,domain_id text,function_id text,status text);
        CREATE TABLE function (id text PRIMARY KEY,domain_id text,parameters text);
        CREATE TABLE workflow (id text PRIMARY KEY,domain_id text);
        CREATE TABLE trigger_def (
          id varchar(64) PRIMARY KEY,name text NOT NULL,description text,status text NOT NULL,version integer NOT NULL,
          condition_kind text NOT NULL,condition_config text NOT NULL,effect_kind text NOT NULL,effect_config text NOT NULL,
          executor text,enabled boolean NOT NULL,next_run_at timestamptz,last_fired_at timestamptz,last_fire_key text,
          domain_id text NOT NULL,created_by text,reviewed_by text,create_timestamp bigint,modify_timestamp bigint,coauthor_ids text);
        CREATE TABLE platform_task (
          id uuid PRIMARY KEY,domain_id text NOT NULL,creator_id text NOT NULL,app_id text NOT NULL,title text NOT NULL,
          content jsonb NOT NULL,form_revision text NOT NULL,summary jsonb NOT NULL,revision bigint NOT NULL,
          frequency jsonb NOT NULL,time_zone text NOT NULL,enabled boolean NOT NULL,pause_code text,pause_message text,
          next_run_at timestamptz,notify_email text,locale text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),migrated_to_trigger text);
        CREATE TABLE platform_task_run (
          id uuid PRIMARY KEY,task_id uuid NOT NULL REFERENCES platform_task(id) ON DELETE CASCADE,
          definition_snapshot jsonb NOT NULL,trigger text NOT NULL,status text NOT NULL,scheduled_at timestamptz,
          dispatched_at timestamptz,deadline timestamptz,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
          handle jsonb,result_link jsonb,result_summary text,execution_details jsonb,
          result text,error_code text,error_message text,spend_time bigint);
        CREATE TABLE platform_task_credential (
          domain_id text NOT NULL,creator_id text NOT NULL,sealed_key text,valid boolean NOT NULL,
          PRIMARY KEY (domain_id,creator_id));
        CREATE TABLE ontology_schedule_reference (task_id uuid PRIMARY KEY REFERENCES platform_task(id));
        CREATE TABLE sys_application (id text PRIMARY KEY,domain_id text,panel_uses jsonb,panel_settings jsonb);
        """);
  }

  @AfterEach
  void dropWorkbenchSchema() {
    if (workbench != null) jdbc.execute("DROP SCHEMA " + nodeSchema + " CASCADE");
  }

  private static final String D1 = "domain-a", D2 = "domain-b";
  private static final String OLD_PANEL = "builtin-product-ontology-triggers", PANEL = "builtin-product-scheduled-tasks";

  @Test
  void keepsCurrentMarkedTriggerItsOldHistoryAndDomainScopedPersistedReferences() {
    var marked = UUID.randomUUID();
    var actionTask = UUID.randomUUID();
    var agentTask = UUID.randomUUID();
    var run = UUID.randomUUID();
    jdbc.update("INSERT INTO workflow VALUES ('flow',?)", D1);
    jdbc.update("""
        INSERT INTO trigger_def VALUES('flow-trigger','Original workflow','Reviewed definition','PUBLISHED',8,'time',
          '{"frequency":{"kind":"daily","time":"12:30"}}','workflow',
          '{"workflowId":"flow","requester":"applicant","inputs":{"quantity":2},"goalText":"Request"}',
          'principal:executor',true,'2030-08-16 08:30:00+00','2030-08-15 08:30:00+00','flow-trigger:previous',
          ?,'trigger-author','reviewer',10,20,'["coauthor"]')
        """, D1);
    var schema = object("name", "start", "type", Parameter.TYPE_TIME);
    var day = object("name", "day", "type", Parameter.TYPE_TIME);
    var numbers = object("name", "numbers", "type", Parameter.TYPE_NUMBER_ARRAY);
    jdbc.update("INSERT INTO function VALUES ('f',?,?)", D1, ScheduleJson.JSON.valueToTree(java.util.List.of(schema, day, numbers)).toString());
    jdbc.update("INSERT INTO action VALUES ('wrap','domain-a','f','PUBLISHED'), ('other-domain-wrap','domain-b','f','PUBLISHED')");
    insertTask(marked, D1, "ontology", """
        {"execution":"function:old-function","parameter:former":"keep the snapshot"}
        """, false, "flow-trigger");
    insertTask(actionTask, D1, "ontology", """
        {"execution":"function:f","parameter:start":"  ","parameter:day":"2026-11-26 09:30","parameter:numbers":"1\\n2.5"}
        """, true, null);
    insertTask(agentTask, D2, "agents", """
        {"agentId":"agent-1","instruction":"Write report"}
        """, true, null);
    jdbc.update("UPDATE platform_task SET pause_code='credential_invalid',pause_message='Renew as author',next_run_at=NULL WHERE id=?", agentTask);
    jdbc.update("INSERT INTO platform_task_credential VALUES (?, 'task-owner', 'ciphertext', false)", D2);
    jdbc.update("INSERT INTO ontology_schedule_reference VALUES (?)", marked);
    var before = object("creatorId", "task-owner", "domainId", D1, "taskRevision", 11, "locale", "en", "summary", object("label", "Old summary"),
        "definition", object("title", "Old failed execution", "appId", "ontology", "formRevision", "former-form",
            "frequency", object("kind", "weekly", "weekday", 3, "time", "11:00"), "timeZone", "Asia/Shanghai",
            "notifyEmail", "owner@example.test", "content", object("execution", "function:old-function", "parameter:former", "keep the snapshot")));
    insertRun(run, marked, before.toString(), "failed", "legacy_failure", "Exact cause");
    jdbc.update("UPDATE platform_task_run SET execution_details='{\"legacyIdentity\":\"unknown\"}' WHERE id=?", run);
    String literal = object("literal", object("className", "platform:ScheduledTask", "primaryKey", marked)).toString();
    jdbc.update("INSERT INTO sys_application VALUES ('custom',?,?::jsonb,'{}')", D1,
        "[{\"panelId\":\"" + OLD_PANEL + "\",\"inputs\":{\"selection\":" + literal + "}}]");
    workbench.update("INSERT INTO product_panels VALUES (?,'custom',?::jsonb)", D1,
        object("panelId", OLD_PANEL, "selection", parse(literal), "title", "platform:ScheduledTask").toString());
    workbench.update("INSERT INTO platform_home_preferences VALUES (?,'member',?,?::jsonb)", D1, OLD_PANEL,
        "[{\"className\":\"platform:ScheduledTask\",\"primaryKey\":\"" + marked + "\",\"title\":\"Old pinned\"}]");
    workbench.update("INSERT INTO product_panel_entry_dependencies VALUES (?,?,'[]')", D1, OLD_PANEL);

    upgrade.run(false);
    assertTrue(TriggerUpgrade.table(jdbc, "platform_task"));
    assertFalse(TriggerUpgrade.table(jdbc, "trigger_run"));
    assertEquals(OLD_PANEL, workbench.queryForObject("SELECT home_panel_id FROM platform_home_preferences", String.class));
    upgrade.run(true);
    upgrade.run(true);

    assertFalse(TriggerUpgrade.table(jdbc, "platform_task"));
    assertFalse(TriggerUpgrade.table(jdbc, "platform_task_run"));
    assertFalse(TriggerUpgrade.table(jdbc, "ontology_schedule_reference"));
    assertEquals(3L, jdbc.queryForObject("SELECT count(*) FROM trigger_def", Long.class));
    assertEquals(1L, jdbc.queryForObject("SELECT count(*) FROM trigger_run", Long.class));
    var original = loadDefinition("flow-trigger");
    assertEquals("trigger-author", original.get("creator_id"));
    assertEquals("executor", original.get("executor_id"));
    assertEquals("reviewer", original.get("reviewed_by"));
    assertNull(original.get("notify_email"));
    assertNull(original.get("notify_email_set_by"));
    assertEquals(8, original.get("version"));
    assertEquals(true, original.get("enabled"));
    assertEquals("Asia/Shanghai", original.get("time_zone"));
    assertEquals("2030-08-16T08:30:00Z", ((java.sql.Timestamp) original.get("next_run_at")).toInstant().toString());
    assertEquals("2030-08-15T08:30:00Z", ((java.sql.Timestamp) original.get("last_fired_at")).toInstant().toString());
    assertEquals("coauthor", parse(original.get("coauthor_ids").toString()).get(0).textValue());
    assertEquals(2, parse(original.get("content").toString()).at("/inputs/quantity").intValue());
    var action = loadDefinition(actionTask.toString());
    assertEquals("wrap", action.get("target_id"));
    assertEquals(7L, action.get("revision"));
    assertEquals("task-owner", action.get("executor_id"));
    var actionContent = parse(action.get("content").toString());
    assertEquals("start", actionContent.at("/runStartParameters/0").textValue());
    assertFalse(actionContent.path("parameters").has("start"));
    assertEquals("2026-11-26T01:30:00Z", actionContent.at("/parameters/day").textValue());
    assertEquals(2.5, actionContent.at("/parameters/numbers/1").doubleValue());
    var agent = loadDefinition(agentTask.toString());
    assertEquals("credential_invalid", agent.get("pause_code"));
    assertEquals("owner@example.test", agent.get("notify_email"));
    assertEquals("task-owner", agent.get("notify_email_set_by"));
    assertEquals("application", agent.get("target_kind"));
    assertEquals("form-a", agent.get("form_revision"));
    assertEquals("ciphertext", jdbc.queryForObject("SELECT sealed_key FROM platform_task_credential WHERE domain_id=? AND NOT valid", String.class, D2));
    var history = jdbc.queryForMap("SELECT * FROM trigger_run WHERE id=?", run);
    assertEquals("flow-trigger", history.get("task_id"));
    assertEquals("Exact cause", history.get("error_message"));
    assertEquals("historical result", history.get("result"));
    assertEquals("handle-1", parse(history.get("handle").toString()).path("id").textValue());
    var snapshot = parse(history.get("definition_snapshot").toString());
    assertTrue(snapshot.path("executorId").isNull());
    assertTrue(snapshot.path("notifyEmailSetBy").isNull());
    assertEquals("owner@example.test", snapshot.at("/definition/notifyEmail").textValue());
    assertEquals("Old failed execution", snapshot.at("/definition/title").textValue());
    assertEquals(before.at("/definition/content"), snapshot.at("/definition/content"));
    var restored = new TaskStore(jdbc, dataSource).run(run);
    assertEquals("flow-trigger", restored.taskId());
    assertNull(restored.snapshot().executorId());
    assertNull(restored.snapshot().notifyEmailSetBy());
    assertEquals(before.at("/definition/content"), restored.snapshot().definition().content());
    assertEquals("/schedules?taskId=flow-trigger&runId=" + run, parse(history.get("result_link").toString()).path("path").textValue());
    var app = parse(jdbc.queryForObject("SELECT panel_uses::text FROM sys_application", String.class));
    assertEquals(PANEL, app.at("/0/panelId").textValue());
    assertEquals("platform:Trigger", app.at("/0/inputs/selection/literal/className").textValue());
    assertEquals("flow-trigger", app.at("/0/inputs/selection/literal/primaryKey").textValue());
    assertEquals("flow-trigger", workbench.queryForObject("SELECT pinned_objects->0->>'primaryKey' FROM platform_home_preferences", String.class));
    assertEquals("platform:ScheduledTask", workbench.queryForObject("SELECT definition->>'title' FROM product_panels", String.class));
    assertEquals(OLD_PANEL, workbench.queryForObject("SELECT panel_id FROM product_panel_entry_dependencies", String.class));
  }

  @Test
  void attributesOnlyPreviouslyConfiguredRunMailToTheSnapshotOwner() {
    var task = UUID.randomUUID();
    var oldMail = UUID.randomUUID();
    var noMail = UUID.randomUUID();
    insertTask(task, D1, "agents", "{}", false, null);
    jdbc.update("UPDATE platform_task SET notify_email='' WHERE id=?", task);
    var oldBody = object("title", "Legacy", "appId", "agents", "formRevision", "form-a", "content", object(),
        "frequency", object("kind", "daily", "time", "11:00"), "timeZone", "Asia/Shanghai", "notifyEmail", "old@example.test");
    var old = object("creatorId", "historical-owner", "domainId", D1, "taskRevision", 3, "locale", "en",
        "summary", ScheduleJson.array(), "definition", oldBody);
    insertRun(oldMail, task, old.toString(), "completed", null, null);
    oldBody.putNull("notifyEmail");
    old.set("definition", oldBody);
    insertRun(noMail, task, old.toString(), "completed", null, null);

    upgrade.run(true);

    var definition = loadDefinition(task.toString());
    assertNull(definition.get("notify_email"));
    assertNull(definition.get("notify_email_set_by"));
    var store = new TaskStore(jdbc, dataSource);
    var withMail = store.run(oldMail).snapshot();
    assertEquals("old@example.test", withMail.definition().notifyEmail());
    assertEquals("historical-owner", withMail.notifyEmailSetBy());
    assertNull(store.run(noMail).snapshot().notifyEmailSetBy());
  }

  @Test
  void reportsSourceIdsForDanglingMarkersCollisionsAmbiguousFunctionsAndRunningRuns() {
    jdbc.update("INSERT INTO action VALUES ('a',?,'f','PUBLISHED'), ('b',?,'f','PUBLISHED')", D1, D1);
    var dangling = UUID.randomUUID();
    var ambiguous = UUID.randomUUID();
    var colliding = UUID.randomUUID();
    var task = UUID.randomUUID();
    var run = UUID.randomUUID();
    jdbc.update("""
        INSERT INTO trigger_def(id,name,status,version,condition_kind,condition_config,effect_kind,effect_config,enabled,domain_id,created_by,create_timestamp,modify_timestamp)
        VALUES (?,'Unrelated','UNUSED',1,'time','{"frequency":{"kind":"daily","time":"00:00"}}','action','{"actionId":"a"}',false,?,'creator',10,20)
        """, colliding.toString(), D1);
    insertTask(dangling, D1, "ontology", "{\"execution\":\"action:a\"}", false, "no-such-trigger");
    insertTask(ambiguous, D1, "ontology", "{\"execution\":\"function:f\"}", false, null);
    insertTask(colliding, D2, "agents", "{}", false, null);
    insertTask(task, D1, "agents", "{}", false, null);
    insertRun(run, task, "{}", "running", null, null);

    var stopped = assertThrows(IllegalStateException.class, () -> upgrade.run(true));
    for (var id : new UUID[] {dangling, ambiguous, colliding, run}) assertTrue(stopped.getMessage().contains(id.toString()));
    assertTrue(stopped.getMessage().contains("[a, b]"));
    assertTrue(TriggerUpgrade.table(jdbc, "platform_task"));
    assertFalse(TriggerUpgrade.table(jdbc, "trigger_run"));
  }

  @Test
  void rollsBackDataRagWhenWorkbenchReferenceHasNoSameDomainMapping() {
    var task = UUID.randomUUID();
    insertTask(task, D1, "agents", "{}", false, null);
    workbench.update("INSERT INTO platform_home_preferences VALUES (?,'member',?,?::jsonb)", D2, OLD_PANEL,
        "[{\"className\":\"platform:ScheduledTask\",\"primaryKey\":\"" + task + "\",\"title\":\"Wrong domain\"}]");

    var stopped = assertThrows(IllegalStateException.class, () -> upgrade.run(true));
    assertTrue(stopped.getMessage().contains(task.toString()));
    assertTrue(stopped.getMessage().contains(D2));
    assertTrue(TriggerUpgrade.table(jdbc, "platform_task"));
    assertFalse(TriggerUpgrade.table(jdbc, "trigger_run"));
    assertEquals(OLD_PANEL, workbench.queryForObject("SELECT home_panel_id FROM platform_home_preferences", String.class));
  }

  @Test
  void refusesEarlierReleaseSourceInsteadOfTreatingItAsAnEmptyUpgrade() {
    workbench.execute("CREATE TABLE analysis_schedule_rules(id text PRIMARY KEY); INSERT INTO analysis_schedule_rules VALUES ('source-rule')");
    var stopped = assertThrows(IllegalStateException.class, () -> upgrade.run(false));
    assertTrue(stopped.getMessage().contains("analysis_schedule_rules"));
    assertTrue(stopped.getMessage().contains("source-rule"));
    assertFalse(TriggerUpgrade.table(jdbc, "trigger_run"));
  }

  private void insertTask(UUID id, String domain, String app, String content, boolean enabled, String marker) {
    jdbc.update("""
        INSERT INTO platform_task(id,domain_id,creator_id,app_id,title,content,form_revision,summary,revision,frequency,
          time_zone,enabled,notify_email,locale,migrated_to_trigger)
        VALUES (?,?,'task-owner',?,'Legacy',?::jsonb,'form-a','[]',7,'{"kind":"weekly","weekday":3,"time":"11:00"}',
          'Asia/Shanghai',?,'owner@example.test','en',?)
        """, id, domain, app, content, enabled, marker);
  }

  private void insertRun(UUID run, UUID task, String snapshot, String status, String code, String message) {
    var link = object("appId", "ontology", "path", "/schedules?taskId=" + task + "&runId=" + run);
    jdbc.update("""
        INSERT INTO platform_task_run(id,task_id,definition_snapshot,trigger,status,finished_at,handle,result_link,
          execution_details,result,error_code,error_message)
        VALUES (?,?,?::jsonb,'manual',?,now(),'{"id":"handle-1"}',?::jsonb,NULL,
          'historical result',?,?)
        """, run, task, snapshot, status, link.toString(), code, message);
  }

  private java.util.Map<String, Object> loadDefinition(String id) {
    return jdbc.queryForMap("SELECT * FROM trigger_def WHERE id=?", id);
  }
}
