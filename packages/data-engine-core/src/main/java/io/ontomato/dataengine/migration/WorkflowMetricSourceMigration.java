package io.ontomato.dataengine.migration;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Existing metrics have no proven workflow owner. Only later publication writes a source. */
@Component
public record WorkflowMetricSourceMigration(JdbcTemplate jdbc) implements DataEngineMigration {
    @Override public String id() { return "20261111-scope-3-pending"; }

    @Override public void run() {
        jdbc.execute("ALTER TABLE metric_view ADD COLUMN IF NOT EXISTS workflow_source JSONB");
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_metric_purpose ON metric_view "
                + "(domain_id, (workflow_source->>'workflowId'), (workflow_source->>'purpose')) WHERE workflow_source IS NOT NULL");
    }
}
