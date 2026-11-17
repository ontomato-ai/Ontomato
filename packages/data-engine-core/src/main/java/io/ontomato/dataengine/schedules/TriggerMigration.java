package io.ontomato.dataengine.schedules;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.dao.TriggerDao;
import lombok.extern.slf4j.Slf4j;

/**
 * Moves the ontology application's scheduled tasks onto Triggers.
 *
 * <p>The ontology application used to schedule an action through the platform's task table. That table is the kernel's
 * bookkeeping: no status, no revision, no review, and one row per person. A Trigger is the capability object with those
 * things, so the same execution must be authored there and only there.</p>
 *
 * <p>The migration is idempotent and conservative: it copies only tasks it can express exactly (an action effect), it
 * keeps the source row for its history, and it disarms that row so the same moment cannot fire twice. A task whose
 * effect is a function is left alone and reported — a Trigger has no function effect, and inventing one would make the
 * migration look complete while silently changing what runs.</p>
 */
@Slf4j
@Component
public class TriggerMigration {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private TriggerDao triggers;

	public record Report(int migrated, int fromFunction, int skippedNoAction, int skippedOther, List<String> skippedIds) {}

	private static final String SELECT = "SELECT id, domain_id, creator_id, title, content, frequency, time_zone, enabled"
			+ " FROM platform_task WHERE app_id='ontology' AND migrated_to_trigger IS NULL ORDER BY created_at";

	public Report migrateOntologyTasks() {
		var migrated = 0;
		var fromFunction = 0;
		var skippedNoAction = 0;
		var skippedOther = 0;
		var skippedIds = new ArrayList<String>();
		List<java.util.Map<String, Object>> rows = jdbcTemplate.queryForList(SELECT);
		for (var row : rows) {
			String id = String.valueOf(row.get("id"));
			String domain = String.valueOf(row.get("domain_id"));
			var content = parse(String.valueOf(row.get("content")));
			String execution = content == null ? null : content.getString("execution");
			String actionId = null;
			if (execution != null && execution.startsWith("action:")) {
				actionId = execution.substring("action:".length());
			} else if (execution != null && execution.startsWith("function:")) {
				// A scheduled write function was never the same object as an action, even though it runs the same write: the
				// function path checks only "may this subject execute anything" and never the per-action grant or the
				// action's preconditions. The replacement is therefore not a function effect on Trigger — it is the Action
				// that wraps that function, so the moment fires something governed.
				actionId = actionForFunction(execution.substring("function:".length()), domain);
				if (actionId == null) {
					skippedNoAction += 1;
					skippedIds.add(id);
					continue;
				}
				fromFunction += 1;
			} else {
				skippedOther += 1;
				skippedIds.add(id);
				continue;
			}
			// The task id becomes the trigger id, which is what makes a second run of this migration an upsert rather
			// than a duplicate: the same source row can only ever produce the same trigger row.
			var existing = triggers.queryById(id);
			if (existing != null) {
				// A previous attempt copied the trigger but did not get to disarm the task. Mark it and stop: saving again
				// would publish a second revision of a definition nobody edited.
				markMigrated(id);
				migrated += 1;
				continue;
			}
			var trigger = new Trigger();
			trigger.setId(id);
			trigger.setName(String.valueOf(row.get("title")));
			trigger.setDescription("Migrated from the platform task list");
			trigger.setDomainId(String.valueOf(row.get("domain_id")));
			trigger.setCreatedBy(String.valueOf(row.get("creator_id")));
			trigger.setConditionKind(Trigger.CONDITION_TIME);
			var condition = new JSONObject();
			condition.put("frequency", parse(String.valueOf(row.get("frequency"))));
			condition.put("timeZone", String.valueOf(row.get("time_zone")));
			trigger.setCondition(condition);
			trigger.setEffectKind(Trigger.EFFECT_ACTION);
			var effect = new JSONObject();
			effect.put("actionId", actionId);
			var parameters = new JSONObject();
			for (var entry : content.entrySet()) {
				if (entry.getKey().startsWith("parameter:")) {
					parameters.put(entry.getKey().substring("parameter:".length()), entry.getValue());
				}
			}
			effect.put("parameters", parameters);
			trigger.setEffect(effect);
			boolean enabled = Boolean.TRUE.equals(row.get("enabled"));
			trigger.setEnabled(enabled);
			trigger.setStatus(enabled ? Trigger.STATUS_PUBLISHED : Trigger.STATUS_PENDING_REVIEW);
			try {
				triggers.save(trigger, trigger.getCreatedBy(), System.currentTimeMillis());
			} catch (RuntimeException refused) {
				log.warn(">>>Trigger migration skipped task {}: {}", id, refused.getMessage());
				skippedOther += 1;
				skippedIds.add(id);
				continue;
			}
			// Disarm the source row last: if the copy failed above, the task keeps running exactly as before.
			markMigrated(id);
			migrated += 1;
		}
		log.info(">>>Trigger migration: migrated {} (from function {}), skipped no-action {}, skipped other {}, ids {}",
				migrated, fromFunction, skippedNoAction, skippedOther, skippedIds);
		return new Report(migrated, fromFunction, skippedNoAction, skippedOther, skippedIds);
	}

	/**
	 * The published Action that wraps a write function, when there is exactly one.
	 *
	 * <p>"Exactly one" is the whole rule: two actions over one function are two different capabilities — different
	 * preconditions, different approvers — and picking one would silently choose the governance for the operator.</p>
	 */
	private String actionForFunction(String functionId, String domain) {
		var ids = jdbcTemplate.queryForList(
				"SELECT id FROM action WHERE function_id=? AND domain_id=? AND status='PUBLISHED'",
				String.class, functionId, domain);
		return ids.size() == 1 ? ids.get(0) : null;
	}

	/**
	 * Disarm the source task and record what replaced it.
	 *
	 * <p>`platform_task.id` is a uuid column while a trigger id arrives as text, so the comparison needs its own cast —
	 * without it PostgreSQL refuses the statement rather than comparing across types.</p>
	 */
	private void markMigrated(String taskId) {
		jdbcTemplate.update(
				"UPDATE platform_task SET enabled=false, next_run_at=NULL, migrated_to_trigger=? WHERE id=?::uuid",
				taskId, taskId);
	}

	private static JSONObject parse(String text) {
		if (text == null || text.isBlank() || "null".equals(text)) return null;
		try {
			return JSON.parseObject(text);
		} catch (Exception unreadable) {
			return null;
		}
	}

	/** When the last migration ran, so an operator can tell "nothing to migrate" from "never migrated". */
	public Instant lastRun() {
		var rows = jdbcTemplate.queryForList(
				"SELECT max(modify_timestamp) AS at FROM trigger_def WHERE description='Migrated from the platform task list'");
		if (rows.isEmpty()) return null;
		var value = rows.get(0).get("at");
		return value == null ? null : Instant.ofEpochMilli(((Number) value).longValue());
	}
}
