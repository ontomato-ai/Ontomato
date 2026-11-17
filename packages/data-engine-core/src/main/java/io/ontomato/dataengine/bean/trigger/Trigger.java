package io.ontomato.dataengine.bean.trigger;

import java.util.LinkedHashSet;
import java.util.Set;

import com.alibaba.fastjson2.JSONObject;

import lombok.Data;

/**
 * A Trigger: the capability-layer object that answers "when does an execution start".
 *
 * <p>It is a capability object in the same sense as an Action or a Workflow — its own table, its own status, its own
 * revision — and it is deliberately not a fact-layer class: nothing in the ontology models it, exactly as nothing
 * models an Action.</p>
 *
 * <p>Both halves of the definition are closed enumerations. A trigger whose condition could hold any expression would
 * grow into a rule language and then into a second query engine; a trigger whose effect could name anything could not
 * be authorized. New kinds are added here, as constants, and go through the same review as a new capability.</p>
 */
@Data
public class Trigger {

	public static final String STATUS_PENDING_REVIEW = "PENDING_REVIEW";
	public static final String STATUS_PUBLISHED = "PUBLISHED";
	public static final String STATUS_UNUSED = "UNUSED";

	/**
	 * What makes the moment: a Definition's membership changing, a MetricView crossing a threshold, the time table
	 * reaching a slot, or an Action completing.
	 *
	 * <p>Only {@link #CONDITION_TIME} has an evaluator today. The other three have no source that reports the change,
	 * so they are accepted as vocabulary and refused as definitions — see {@link #validate()}.</p>
	 */
	public static final String CONDITION_DEFINITION_MEMBERSHIP = "definition-membership";
	public static final String CONDITION_METRIC_THRESHOLD = "metric-threshold";
	public static final String CONDITION_TIME = "time";
	public static final String CONDITION_ACTION_COMPLETED = "action-completed";

	public static final Set<String> CONDITION_KINDS = new LinkedHashSet<>(java.util.List.of(
			CONDITION_DEFINITION_MEMBERSHIP, CONDITION_METRIC_THRESHOLD, CONDITION_TIME, CONDITION_ACTION_COMPLETED));

	/** The kinds of condition an evaluator exists for. */
	public static final Set<String> EVALUATED_CONDITION_KINDS = Set.of(CONDITION_TIME);

	/** What the moment starts: an Action, a Workflow, a Skill, or a notification. */
	public static final String EFFECT_ACTION = "action";
	public static final String EFFECT_WORKFLOW = "workflow";
	public static final String EFFECT_SKILL = "skill";
	public static final String EFFECT_NOTIFICATION = "notification";

	public static final Set<String> EFFECT_KINDS = new LinkedHashSet<>(java.util.List.of(
			EFFECT_ACTION, EFFECT_WORKFLOW, EFFECT_SKILL, EFFECT_NOTIFICATION));

	/** The kinds of effect an executor exists for. */
	public static final Set<String> EXECUTED_EFFECT_KINDS = Set.of(EFFECT_ACTION, EFFECT_WORKFLOW);

	private String id;
	private String name;
	private String description;
	private String status;
	/** Revision of the definition; publishing bumps it, saving a draft does not. */
	private Integer version;

	private String conditionKind;
	/**
	 * Condition parameters. For the time table: `{frequency:{kind:"interval",every:60,unit:"minute"}, timeZone:"..."}`,
	 * the same shape the platform's scheduler already stores.
	 */
	private JSONObject condition;

	private String effectKind;
	/**
	 * Effect parameters. For an action: `{actionId, parameters:{...}}`; for a workflow: `{workflowId, requester}`.
	 * A reference is stored as an id, never as a copy, so a renamed capability is still the same capability.
	 */
	private JSONObject effect;

	/** Who runs it: `requester` (= the creator), `principal:<id>`, or null for the creator. */
	private String executor;

	/** Armed or not. An unarmed trigger keeps its definition and fires nothing. */
	private Boolean enabled;

	/** The next slot the evaluator will consider; null when the trigger is not armed or not time based. */
	private java.time.Instant nextRunAt;
	private java.time.Instant lastFiredAt;
	/** The idempotency key of the last firing, so a re-evaluated slot cannot fire twice. */
	private String lastFireKey;

	private String domainId;
	private String createdBy;
	/** The subject who last published it — publication is the review moment. */
	private String reviewedBy;
	private Long createTimestamp;
	private Long modifyTimestamp;

	/**
	 * Refuse a definition that cannot be evaluated or executed.
	 *
	 * <p>The rejection is explicit rather than silent: accepting a `metric-threshold` trigger and then never firing it
	 * would leave an operator believing the threshold is watched. The message names the kinds that do work.</p>
	 */
	public void validate() {
		if (name == null || name.isBlank()) throw new IllegalArgumentException("Trigger.name is required");
		if (conditionKind == null || !CONDITION_KINDS.contains(conditionKind))
			throw new IllegalArgumentException("Trigger.conditionKind must be one of " + CONDITION_KINDS);
		if (!EVALUATED_CONDITION_KINDS.contains(conditionKind))
			throw new IllegalArgumentException(
					"Trigger.conditionKind " + conditionKind + " has no evaluator yet; only " + EVALUATED_CONDITION_KINDS
							+ " can be saved. An unwired condition would never fire, so it is refused rather than stored.");
		if (effectKind == null || !EFFECT_KINDS.contains(effectKind))
			throw new IllegalArgumentException("Trigger.effectKind must be one of " + EFFECT_KINDS);
		if (!EXECUTED_EFFECT_KINDS.contains(effectKind))
			throw new IllegalArgumentException(
					"Trigger.effectKind " + effectKind + " has no executor yet; only " + EXECUTED_EFFECT_KINDS
							+ " can be saved.");
		if (condition == null || condition.isEmpty())
			throw new IllegalArgumentException("Trigger.condition is required");
		if (effect == null || effect.isEmpty()) throw new IllegalArgumentException("Trigger.effect is required");
		if (EFFECT_ACTION.equals(effectKind) && blank(effect.getString("actionId")))
			throw new IllegalArgumentException("A trigger whose effect is an action must name effect.actionId");
		if (EFFECT_WORKFLOW.equals(effectKind) && blank(effect.getString("workflowId")))
			throw new IllegalArgumentException("A trigger whose effect is a workflow must name effect.workflowId");
		if (CONDITION_TIME.equals(conditionKind)) {
			var frequency = condition.getJSONObject("frequency");
			if (frequency == null || blank(frequency.getString("kind")))
				throw new IllegalArgumentException("A time trigger needs condition.frequency.kind");
		}
	}

	private static boolean blank(String value) {
		return value == null || value.isBlank();
	}
}
