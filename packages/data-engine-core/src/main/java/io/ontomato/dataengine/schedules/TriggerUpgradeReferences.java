package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.parse;
import static io.ontomato.dataengine.schedules.TriggerUpgrade.predecessor;
import static io.ontomato.dataengine.schedules.TriggerUpgrade.table;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.schedules.TriggerUpgrade.TaskKey;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Only persisted product configuration is rewritten; dependency closures are rebuilt by their owner. */
final class TriggerUpgradeReferences {
  private static final String OLD_PANEL = "builtin-product-ontology-triggers";
  private static final String PANEL = "builtin-product-scheduled-tasks";
  private static final String OLD_TYPE = "platform:ScheduledTask";
  private static final String TYPE = "platform:Trigger";
  private static final Map<String, String> OPERATIONS = Map.of(
      OLD_TYPE + ".save", TYPE + ".save",
      OLD_TYPE + ".create", "triggers.create",
      OLD_TYPE + ".setEnabled", "triggers.setEnabled",
      OLD_TYPE + ".delete", "triggers.delete",
      "schedules.runNow", "triggers.runNow",
      "schedules.renewCredential", "triggers.renewCredential");
  private static final Pattern LINK = Pattern.compile("^(/schedules\\?taskId=)([0-9a-fA-F-]{36})(&.*)?$");
  private final DataSource workbench;
  private final JdbcTemplate node;

  TriggerUpgradeReferences(DataSource workbench) {
    this.workbench = workbench;
    this.node = new JdbcTemplate(workbench);
  }

  void checkPredecessors(List<String> issues) {
    predecessor(node, "analysis_schedule_rules", "id", issues);
    // Even an empty scheduled_tasks table must be retired by its owning predecessor before Node starts.
    if (table(node, "scheduled_tasks")) {
      var ids = node.queryForList("SELECT id::text FROM scheduled_tasks ORDER BY id", String.class);
      issues.add("Complete the predecessor import and retirement of scheduled_tasks first; source IDs: " + ids);
    }
    predecessor(node, "scheduled_task_runs", "id", issues);
    if (table(node, "scheduled_task_credentials"))
      issues.add("Complete the predecessor import and retirement of scheduled_task_credentials first");
  }

  Runnable catalog(JdbcTemplate db, Map<TaskKey, String> mapping, List<String> issues) {
    var updates = new ArrayList<Runnable>();
    jsonRows(db, "sys_application", "id", "panel_uses", mapping, issues, updates);
    jsonRows(db, "sys_application", "id", "panel_settings", mapping, issues, updates);
    return () -> updates.forEach(Runnable::run);
  }

  void workbench(Map<TaskKey, String> mapping, boolean apply) {
    var tx = new TransactionTemplate(new DataSourceTransactionManager(workbench));
    tx.setReadOnly(!apply);
    tx.executeWithoutResult(status -> {
      var issues = new ArrayList<String>();
      var updates = new ArrayList<Runnable>();
      jsonRows(node, "product_panels", "id", "definition", mapping, issues, updates);
      jsonRows(node, "product_projections", "id", "definition", mapping, issues, updates);
      jsonRows(node, "platform_home_preferences", "user_id", "pinned_objects", mapping, issues, updates);
      panelColumn(node, "product_object_details", "panel_id", updates);
      panelColumn(node, "platform_home_preferences", "home_panel_id", updates);
      if (!issues.isEmpty()) throw new IllegalStateException("Trigger references blocked:\n" + String.join("\n", issues));
      if (apply) updates.forEach(Runnable::run);
    });
  }

  private static boolean column(JdbcTemplate db, String table, String column) {
    return db.queryForObject("""
        SELECT EXISTS (SELECT FROM information_schema.columns
        WHERE table_schema=current_schema() AND table_name=? AND column_name=?)
        """, Boolean.class, table, column);
  }

  private static void panelColumn(JdbcTemplate db, String table, String column, List<Runnable> updates) {
    if (column(db, table, column)) updates.add(() -> db.update(
        "UPDATE " + table + " SET " + column + "=? WHERE " + column + "=?", PANEL, OLD_PANEL));
  }

  private static void jsonRows(JdbcTemplate db, String table, String key, String column, Map<TaskKey, String> mapping,
      List<String> issues, List<Runnable> updates) {
    if (!column(db, table, column)) return;
    var rows = db.queryForList("SELECT domain_id," + key + " AS row_id," + column + "::text AS payload FROM " + table
        + " WHERE strpos(" + column + "::text,?)>0 OR strpos(" + column + "::text,?)>0 OR strpos("
        + column + "::text,'/schedules?taskId=')>0 OR strpos(" + column + "::text,'schedules.')>0"
        + " ORDER BY domain_id," + key, OLD_PANEL, OLD_TYPE);
    for (var row : rows) {
      String domain = (String) row.get("domain_id"), id = (String) row.get("row_id");
      var json = parse((String) row.get("payload"));
      var before = json.deepCopy();
      rewrite(json, domain, mapping, issues, table + "." + column + " " + id + " [domain=" + domain + "]");
      if (!before.equals(json)) {
        if ("pinned_objects".equals(column)) deduplicatePins((ArrayNode) json);
        updates.add(() -> db.update("UPDATE " + table + " SET " + column
            + "=?::jsonb WHERE domain_id IS NOT DISTINCT FROM ? AND " + key + "=?", json.toString(), domain, id));
      }
    }
  }

  private static void deduplicatePins(ArrayNode pins) {
    var seen = new HashSet<TaskKey>();
    for (int i = 0; i < pins.size(); i++) {
      var pin = pins.get(i);
      if (!seen.add(new TaskKey(pin.path("className").textValue(), pin.path("primaryKey").textValue())))
        pins.remove(i--);
    }
  }

  static void rewrite(JsonNode node, String domain, Map<TaskKey, String> mapping, List<String> issues, String location) {
    if (node instanceof ObjectNode record) {
      for (String field : List.of("className", "objectType", "type")) {
        if (!OLD_TYPE.equals(record.path(field).textValue())) continue;
        if (record.has("primaryKey")) {
          String oldId = record.path("primaryKey").textValue();
          String canonical = mapping.get(new TaskKey(domain, oldId));
          if (canonical == null) {
            issues.add(location + " references missing same-domain task " + oldId);
            continue;
          }
          record.put("primaryKey", canonical);
        }
        record.put(field, TYPE);
      }
      for (String field : List.of("operation", "handlerRef")) {
        if (!record.path(field).isTextual()) continue;
        var operation = OPERATIONS.get(record.get(field).textValue());
        if (operation != null) record.put(field, operation);
      }
      for (String field : List.of("panelId", "framePanelId", "homePanelId"))
        if (OLD_PANEL.equals(record.path(field).textValue())) record.put(field, PANEL);
      if (record.path("panelIds") instanceof ArrayNode ids)
        for (int i = 0; i < ids.size(); i++)
          if (OLD_PANEL.equals(ids.get(i).textValue())) ids.set(i, PANEL);
      if (record.path("objectTypes") instanceof ArrayNode types)
        for (int i = 0; i < types.size(); i++)
          if (OLD_TYPE.equals(types.get(i).textValue())) types.set(i, TYPE);
      if (record.path("path").isTextual()) {
        var path = LINK.matcher(record.get("path").textValue());
        if (path.matches()) {
          String canonical = mapping.get(new TaskKey(domain, path.group(2)));
          if (canonical != null) record.put("path", path.group(1) + encode(canonical)
              + (path.group(3) == null ? "" : path.group(3)));
          // This path already also accepts stable Trigger IDs; do not infer its type from a URL alone.
        }
      }
      if (record.path("literal").isTextual() && record.get("literal").textValue().startsWith(OLD_TYPE + "~")) {
        String oldId = record.get("literal").textValue().substring(OLD_TYPE.length() + 1);
        String canonical = mapping.get(new TaskKey(domain, oldId));
        if (canonical == null) issues.add(location + " references missing same-domain task " + oldId);
        else record.put("literal", TYPE + "~" + canonical);
      }
      record.elements().forEachRemaining(child -> rewrite(child, domain, mapping, issues, location));
    } else if (node.isArray()) {
      node.elements().forEachRemaining(child -> rewrite(child, domain, mapping, issues, location));
    }
  }

  static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }
}
