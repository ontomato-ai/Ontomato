package io.ontomato.dataengine.migration;

import java.util.ArrayList;
import java.util.List;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import io.ontomato.dataengine.service.ActionPreconditionService;

/** Upgrade the stored declarations, never publish a revision or infer authority from an Action program. */
@Component
public record ActionTargetScopeMigration(JdbcTemplate jdbc) implements DataEngineMigration {
    @Override public String id() { return "20261111-scope-1-definitions"; }

    @Override public void run() {
        List<String> unresolved = new ArrayList<>();
        for (String query : List.of(
                "SELECT domain_id, id, submission_criteria AS criteria FROM action WHERE submission_criteria IS NOT NULL",
                "SELECT domain_id, id, action->>'submissionCriteria' AS criteria FROM action_drafts WHERE consumed_at IS NULL AND expires_at > now()")) {
            jdbc.query(query, (org.springframework.jdbc.core.RowCallbackHandler) row -> {
                try { ActionPreconditionService.requireBusinessConditions(JSON.parseObject(row.getString("criteria"))); }
                catch (IllegalArgumentException e) { unresolved.add(row.getString("domain_id") + "/" + row.getString("id") + ": " + e.getMessage()); }
            });
        }
        if (!unresolved.isEmpty()) throw new IllegalStateException("Actions/drafts requiring explicit role and target migration: " + unresolved);
        jdbc.execute("ALTER TABLE action ADD COLUMN IF NOT EXISTS target TEXT");
        for (String table : List.of("workflow", "workflow_version")) {
            for (var row : jdbc.queryForList("SELECT id, domain_id, version, steps FROM " + table + " WHERE steps IS NOT NULL")) {
                JSONArray steps = JSON.parseArray((String) row.get("steps"));
                boolean changed = false;
                for (int i = 0; i < steps.size(); i++) {
                    var step = steps.getJSONObject(i);
                    if (!step.containsKey("assignRule") && step.getString("scope") != null) continue;
                    String old = step.getString("assignRule");
                    String kind = switch (String.valueOf(old)) {
                        case "dept_role" -> "self_organization";
                        case "global_role" -> "all";
                        case "initiator" -> "initiated_by_self";
                        default -> throw new IllegalStateException(table + " " + row.get("domain_id") + "/" + row.get("id")
                                + " version " + row.get("version") + " step " + step.get("stepNo") + ": unresolved assignRule " + old);
                    };
                    step.remove("assignRule");
                    step.put("scope", kind);
                    changed = true;
                }
                if (changed) jdbc.update("UPDATE " + table + " SET steps=? WHERE id=?", steps.toJSONString(), row.get("id"));
            }
        }
    }
}
