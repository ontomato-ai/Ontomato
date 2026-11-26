package io.ontomato.dataengine.service.scheduling;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Native trigger definitions reference Actions and, through them, their backing functions. */
@Repository
@DependsOn({"taskStore", "actionDao"})
@RequiredArgsConstructor
public class OntologyScheduleReferences {
  private final JdbcTemplate db;

  private static final String ACTION_TARGETS = " FROM trigger_def t JOIN action a ON a.id=t.target_id AND a.domain_id=t.domain_id"
      + " WHERE t.target_kind='action'";

  public List<String> referencedFunctions() {
    return db.queryForList("SELECT DISTINCT a.function_id" + ACTION_TARGETS + " AND a.function_id IS NOT NULL", String.class);
  }

  public boolean references(String function) {
    return db.queryForObject("SELECT EXISTS(SELECT 1" + ACTION_TARGETS + " AND a.function_id=?)", Boolean.class, function);
  }

  public boolean referencesAction(String action) {
    return db.queryForObject("SELECT EXISTS(SELECT 1 FROM trigger_def WHERE target_kind='action' AND target_id=?)",
        Boolean.class, action);
  }
}
