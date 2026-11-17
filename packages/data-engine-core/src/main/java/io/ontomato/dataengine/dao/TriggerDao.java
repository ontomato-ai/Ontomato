package io.ontomato.dataengine.dao;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.trigger.Trigger;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

/**
 * Storage for Triggers.
 *
 * <p>A trigger is a capability object, so it owns a real table with a primary key, a status and a revision — not a
 * projection onto a fact class. The table lives beside the other capability tables in the data engine's own database,
 * which is where Action, MetricView, Function and Workflow already keep theirs.</p>
 */
@Slf4j
@Component("triggerDao")
public class TriggerDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	private static final String TABLE_NAME = "trigger_def";

	private static final String COLUMNS = "id, name, description, status, version, condition_kind, condition_config,"
			+ " effect_kind, effect_config, executor, enabled, next_run_at, last_fired_at,"
			+ " last_fire_key, domain_id, created_by, reviewed_by, create_timestamp, modify_timestamp";

	@PostConstruct
	public void initIndex() {
		// `trigger` is a reserved word in PostgreSQL, so the table is named for what it holds.
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "name VARCHAR(255) NOT NULL, "
				+ "description TEXT, "
				+ "status VARCHAR(32) NOT NULL, "
				+ "version INTEGER NOT NULL DEFAULT 1, "
				+ "condition_kind VARCHAR(32) NOT NULL, "
				+ "condition_config TEXT NOT NULL, "
				+ "effect_kind VARCHAR(32) NOT NULL, "
				+ "effect_config TEXT NOT NULL, "
				+ "executor VARCHAR(128), "
				+ "enabled BOOLEAN NOT NULL DEFAULT FALSE, "
				+ "next_run_at TIMESTAMPTZ, "
				+ "last_fired_at TIMESTAMPTZ, "
				+ "last_fire_key VARCHAR(160), "
				+ "domain_id VARCHAR(64) NOT NULL, "
				+ "created_by VARCHAR(64), "
				+ "reviewed_by VARCHAR(64), "
				+ "create_timestamp BIGINT, "
				+ "modify_timestamp BIGINT, "
				+ "CHECK (version > 0))");
		// The approval mode was removed: the Action a trigger starts already carries that gate, and a second, unenforced
		// field on the trigger only made it look like there was a second checkpoint. Dropped idempotently so an install
		// that already created the column converges.
		jdbcTemplate.execute("ALTER TABLE " + TABLE_NAME + " DROP COLUMN IF EXISTS approval_mode");
		// The evaluator asks this question every second: armed, published, due.
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS trigger_due ON " + TABLE_NAME
				+ " (next_run_at) WHERE enabled AND status = 'PUBLISHED'");
		jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS trigger_domain ON " + TABLE_NAME + " (domain_id, status)");
	}

	public Trigger save(Trigger trigger, String actor, long now) {
		trigger.validate();
		boolean creating = trigger.getId() == null || trigger.getId().isBlank();
		if (creating) {
			trigger.setId(UUID.randomUUID().toString());
			trigger.setVersion(1);
			trigger.setCreateTimestamp(now);
			trigger.setCreatedBy(actor);
		} else {
			var existing = queryById(trigger.getId());
			if (existing != null) {
				if (trigger.getCreatedBy() == null) trigger.setCreatedBy(existing.getCreatedBy());
				if (trigger.getVersion() == null) trigger.setVersion(existing.getVersion());
				if (trigger.getLastFireKey() == null) trigger.setLastFireKey(existing.getLastFireKey());
				if (trigger.getLastFiredAt() == null) trigger.setLastFiredAt(existing.getLastFiredAt());
			}
		}
		// Publication is the review moment and the only event that moves the revision: a draft edit is not a new
		// revision, otherwise "which revision is in force" would change every time someone fixed a typo.
		if (Trigger.STATUS_PUBLISHED.equals(trigger.getStatus())) {
			trigger.setReviewedBy(actor);
			if (!creating) trigger.setVersion((trigger.getVersion() == null ? 1 : trigger.getVersion()) + 1);
			// Publishing arms: an operator who approves a trigger expects it to start firing, and a published trigger
			// that stayed disarmed would look identical in the list while never running.
			if (trigger.getEnabled() == null) trigger.setEnabled(true);
		} else if (trigger.getEnabled() == null) {
			trigger.setEnabled(false);
		}
		trigger.setModifyTimestamp(now);
		trigger.setNextRunAt(nextSlotFor(trigger, Instant.ofEpochMilli(now)));
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
						+ "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,"
						+ " status=EXCLUDED.status, version=EXCLUDED.version, condition_kind=EXCLUDED.condition_kind,"
						+ " condition_config=EXCLUDED.condition_config, effect_kind=EXCLUDED.effect_kind,"
						+ " effect_config=EXCLUDED.effect_config, executor=EXCLUDED.executor,"
						+ " enabled=EXCLUDED.enabled,"
						+ " next_run_at=EXCLUDED.next_run_at, last_fired_at=EXCLUDED.last_fired_at,"
						+ " last_fire_key=EXCLUDED.last_fire_key, reviewed_by=EXCLUDED.reviewed_by,"
						+ " modify_timestamp=EXCLUDED.modify_timestamp",
				trigger.getId(),
				trigger.getName(),
				trigger.getDescription(),
				trigger.getStatus(),
				trigger.getVersion(),
				trigger.getConditionKind(),
				JSON.toJSONString(trigger.getCondition()),
				trigger.getEffectKind(),
				JSON.toJSONString(trigger.getEffect()),
				trigger.getExecutor(),
				Boolean.TRUE.equals(trigger.getEnabled()),
				trigger.getNextRunAt() == null ? null : st(trigger.getNextRunAt()),
				trigger.getLastFiredAt() == null ? null : st(trigger.getLastFiredAt()),
				trigger.getLastFireKey(),
				trigger.getDomainId(),
				trigger.getCreatedBy(),
				trigger.getReviewedBy(),
				trigger.getCreateTimestamp(),
				trigger.getModifyTimestamp());
		return trigger;
	}

	public Trigger queryById(String id) {
		var rows = jdbcTemplate.query("SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE id=?", this::map, id);
		return rows.isEmpty() ? null : rows.get(0);
	}

	public List<Trigger> queryList(String domainId, String status) {
		if (status == null || status.isBlank())
			return jdbcTemplate.query("SELECT " + COLUMNS + " FROM " + TABLE_NAME
					+ " WHERE domain_id=? ORDER BY modify_timestamp DESC", this::map, domainId);
		return jdbcTemplate.query("SELECT " + COLUMNS + " FROM " + TABLE_NAME
				+ " WHERE domain_id=? AND status=? ORDER BY modify_timestamp DESC", this::map, domainId, status);
	}

	public void delete(String id, String domainId) {
		jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE id=? AND domain_id=?", id, domainId);
	}

	/**
	 * The triggers the evaluator must consider now: armed, published, time based, and due.
	 *
	 * <p>`FOR UPDATE SKIP LOCKED` is what lets two instances of the engine run side by side without firing the same
	 * slot twice; the slot is claimed by advancing `next_run_at` in the same transaction.</p>
	 */
	public List<Trigger> due(Instant now, int limit) {
		return jdbcTemplate.query("SELECT " + COLUMNS + " FROM " + TABLE_NAME
				+ " WHERE enabled AND status='PUBLISHED' AND condition_kind='" + Trigger.CONDITION_TIME
				+ "' AND next_run_at IS NOT NULL AND next_run_at<=?"
				+ " ORDER BY next_run_at, id LIMIT ? FOR UPDATE SKIP LOCKED", this::map, st(now), limit);
	}

	/**
	 * Advance the slot under the row lock the caller already holds.
	 *
	 * <p>Deliberately not keyed on the old timestamp: PostgreSQL keeps microseconds while an `Instant` round trip may
	 * not, and a guard that fails on that difference would silently freeze the schedule. The caller holds
	 * `FOR UPDATE SKIP LOCKED`, which is what actually serialises two engine instances.</p>
	 */
	public void advance(String id, Instant next, Instant slot) {
		jdbcTemplate.update(
				"UPDATE " + TABLE_NAME + " SET next_run_at=?, last_fired_at=?, last_fire_key=? WHERE id=?",
				next == null ? null : st(next), st(slot), id + ":" + slot.getEpochSecond(), id);
	}

	/**
	 * An instant as a JDBC parameter.
	 *
	 * <p>`java.time.Instant` is not accepted here: the driver cannot infer a SQL type for it, so every timestamp
	 * parameter goes through this conversion. `Timestamp` is the type the other tables already compare against.</p>
	 */
	private static java.sql.Timestamp st(Instant instant) {
		return java.sql.Timestamp.from(instant);
	}

	/** One firing per (trigger, slot), so a re-evaluated slot is a duplicate key at the run side rather than a new run. */
	public static String fireKey(Trigger trigger, Instant slot) {
		return trigger.getId() + ":" + slot.getEpochSecond();
	}

	/**
	 * The next slot after `slot`.
	 *
	 * <p>The same four shapes the platform's task table supports, computed here rather than borrowed: a trigger is not
	 * a platform task, and coupling the two would mean a change in one silently changes the other's cadence.</p>
	 */
	public Instant nextSlotFor(Trigger trigger, Instant slot) {
		if (trigger.getCondition() == null) return null;
		var frequency = trigger.getCondition().getJSONObject("frequency");
		if (frequency == null) return null;
		if (!Boolean.TRUE.equals(trigger.getEnabled()) || !Trigger.STATUS_PUBLISHED.equals(trigger.getStatus()))
			return null;
		String zoneName = trigger.getCondition().getString("timeZone");
		ZoneId zone;
		try {
			zone = zoneName == null || zoneName.isBlank() ? ZoneId.systemDefault() : ZoneId.of(zoneName);
		} catch (Exception invalid) {
			zone = ZoneId.systemDefault();
		}
		String kind = frequency.getString("kind");
		if (kind == null) return null;
		try {
			return switch (kind) {
				case "interval" -> {
					long unit = switch (frequency.getString("unit")) {
						case "minute" -> 60L;
						case "hour" -> 3600L;
						case "day" -> 86400L;
						default -> throw new IllegalArgumentException("Invalid interval unit");
					};
					long step = Math.max(1, frequency.getIntValue("every")) * unit;
					long elapsed = Math.max(0, Duration.between(slot, Instant.now()).getSeconds());
					yield slot.plusSeconds((elapsed / step + 1) * step);
				}
				case "daily" -> nextDaily(slot, frequency.getString("time"), zone, 1);
				case "weekly" -> nextWeekly(slot, frequency.getIntValue("weekday"), frequency.getString("time"), zone);
				case "monthly" -> nextMonthly(slot, frequency.getIntValue("day"), frequency.getString("time"), zone);
				case "cron" -> {
					var next = CronExpression.parse(frequency.getString("expression"))
							.next(slot.atZone(zone).toLocalDateTime());
					yield next == null ? null : next.atZone(zone).toInstant();
				}
				default -> null;
			};
		} catch (RuntimeException invalid) {
			log.warn(">>>Trigger {} has an unusable frequency: {}", trigger.getId(), invalid.getMessage());
			return null;
		}
	}

	private Instant nextDaily(Instant slot, String time, ZoneId zone, int stepDays) {
		var local = slot.atZone(zone).toLocalDate().plusDays(stepDays);
		var at = java.time.LocalTime.parse(time == null ? "00:00" : time);
		return local.atTime(at).atZone(zone).toInstant();
	}

	private Instant nextWeekly(Instant slot, int weekday, String time, ZoneId zone) {
		var day = slot.atZone(zone).toLocalDate().plusDays(1);
		while (day.getDayOfWeek().getValue() != Math.max(1, Math.min(7, weekday))) day = day.plusDays(1);
		var at = java.time.LocalTime.parse(time == null ? "00:00" : time);
		return day.atTime(at).atZone(zone).toInstant();
	}

	private Instant nextMonthly(Instant slot, int dayOfMonth, String time, ZoneId zone) {
		var start = slot.atZone(zone).toLocalDate().withDayOfMonth(1).plusMonths(1);
		int day = Math.max(1, Math.min(31, dayOfMonth));
		day = Math.min(day, start.lengthOfMonth());
		var at = java.time.LocalTime.parse(time == null ? "00:00" : time);
		return start.withDayOfMonth(day).atTime(at).atZone(zone).toInstant();
	}

	private Trigger map(ResultSet rs, int row) throws SQLException {
		var trigger = new Trigger();
		trigger.setId(rs.getString("id"));
		trigger.setName(rs.getString("name"));
		trigger.setDescription(rs.getString("description"));
		trigger.setStatus(rs.getString("status"));
		trigger.setVersion(rs.getInt("version"));
		trigger.setConditionKind(rs.getString("condition_kind"));
		trigger.setCondition(parse(rs.getString("condition_config")));
		trigger.setEffectKind(rs.getString("effect_kind"));
		trigger.setEffect(parse(rs.getString("effect_config")));
		trigger.setExecutor(rs.getString("executor"));
		trigger.setEnabled(rs.getBoolean("enabled"));
		var next = rs.getTimestamp("next_run_at");
		trigger.setNextRunAt(next == null ? null : next.toInstant());
		var fired = rs.getTimestamp("last_fired_at");
		trigger.setLastFiredAt(fired == null ? null : fired.toInstant());
		trigger.setLastFireKey(rs.getString("last_fire_key"));
		trigger.setDomainId(rs.getString("domain_id"));
		trigger.setCreatedBy(rs.getString("created_by"));
		trigger.setReviewedBy(rs.getString("reviewed_by"));
		trigger.setCreateTimestamp(rs.getLong("create_timestamp"));
		trigger.setModifyTimestamp(rs.getLong("modify_timestamp"));
		return trigger;
	}

	private static JSONObject parse(String text) {
		if (text == null || text.isBlank()) return new JSONObject();
		try {
			return JSON.parseObject(text);
		} catch (Exception unreadable) {
			return new JSONObject();
		}
	}
}
