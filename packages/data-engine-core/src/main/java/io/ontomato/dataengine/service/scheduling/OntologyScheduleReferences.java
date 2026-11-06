package io.ontomato.dataengine.service.scheduling;

import jakarta.annotation.PostConstruct;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Ontology-owned task references protect both published actions and their underlying functions. */
@Repository
@DependsOn({"taskStore", "actionDao"})
@RequiredArgsConstructor
public class OntologyScheduleReferences {
  private final JdbcTemplate db;

  @PostConstruct
  void initialize() {
    createSchema(db);
  }

  public static void createSchema(JdbcTemplate db) {
    db.execute(
        """
CREATE TABLE IF NOT EXISTS ontology_schedule_reference (
task_id uuid PRIMARY KEY REFERENCES platform_task(id) ON DELETE CASCADE,
action_id varchar(64) REFERENCES action(id), function_id varchar(64) NOT NULL REFERENCES function(id));
CREATE INDEX IF NOT EXISTS ontology_schedule_function ON ontology_schedule_reference(function_id);
CREATE INDEX IF NOT EXISTS ontology_schedule_action ON ontology_schedule_reference(action_id);
""");
  }

  public void attach(UUID task, String action, String function) {
    db.update(
        "INSERT INTO ontology_schedule_reference VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET"
            + " action_id=EXCLUDED.action_id,function_id=EXCLUDED.function_id",
        task,
        action,
        function);
  }

  public void detach(UUID task) {
    db.update("DELETE FROM ontology_schedule_reference WHERE task_id=?", task);
  }

  public List<String> referencedFunctions() {
    return db.queryForList(
        "SELECT DISTINCT function_id FROM ontology_schedule_reference", String.class);
  }

  public boolean references(String function) {
    return Boolean.TRUE.equals(
        db.queryForObject(
            "SELECT EXISTS(SELECT FROM ontology_schedule_reference WHERE function_id=?)",
            Boolean.class,
            function));
  }

  public boolean referencesAction(String action) {
    return Boolean.TRUE.equals(
        db.queryForObject(
            "SELECT EXISTS(SELECT FROM ontology_schedule_reference WHERE action_id=?)",
            Boolean.class,
            action));
  }
}
