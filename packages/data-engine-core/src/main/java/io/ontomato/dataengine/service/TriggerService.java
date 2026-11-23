package io.ontomato.dataengine.service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.node.ObjectNode;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.TriggerDao;
import io.ontomato.dataengine.schedules.ScheduleIdentity;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.identity.UserCredentials;
import lombok.extern.slf4j.Slf4j;

/**
 * Fires a Trigger.
 *
 * <p>Two effects have an executor: an Action runs through the same service an interactive call uses, and a Workflow
 * starts a Run in Ontopraxis. Everything else — authorization, the business write, the audit — stays where it already
 * lives; the trigger only supplies the moment and the identity.</p>
 *
 * <p>The identity is the one the definition names, never an elevated service account. A trigger armed by an operator
 * runs as that operator's principal, so an Action it fires is refused if that principal lost the grant — which is the
 * point of arming it under a person rather than under the scheduler.</p>
 */
@Slf4j
@Service
public class TriggerService {

	@Autowired
	private TriggerDao triggers;

	@Autowired
	private ActionService actions;

	@Autowired
	private WorkflowService workflows;

	@Autowired
	private LangService langService;

	@Autowired
	private ScheduleIdentity identity;

	@Autowired
	private UserCredentials credentials;

	private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

	/**
	 * Owner form description for creating or editing a Trigger.
	 *
	 * <p>A read without {@code values} returns the stored Trigger or creation defaults with no errors; a refresh with
	 * {@code changedField} updates effect-dependent fields without errors; a draft with {@code values} and no
	 * {@code changedField} returns field errors alongside the values.</p>
	 */
	public JSONObject definitionForm(JSONObject request, String lang, String domainId) {
		JSONObject target = request == null ? null : request.getJSONObject("target");
		if (target == null) throw new IllegalArgumentException("target is required");
		String kind = target.getString("kind");
		Trigger trigger = null;
		boolean existing;
		if ("object".equals(kind)) {
			if (!"platform:Trigger".equals(target.getString("objectType"))) {
				throw new IllegalArgumentException("target.objectType: expected platform:Trigger");
			}
			String id = target.getString("primaryKey");
			if (id == null || id.isBlank()) {
				throw new IllegalArgumentException("target.primaryKey is required");
			}
			trigger = triggers.queryById(id);
			if (trigger == null || !domainId.equals(trigger.getDomainId())) {
				throw new OwnerRefusal("TRIGGER_NOT_FOUND", text(lang, "Trigger.notFound"));
			}
			existing = true;
		} else if ("draft".equals(kind)) {
			existing = false;
		} else {
			throw new IllegalArgumentException("target.kind: expected object or draft");
		}

		List<Action> domainActions = actions.queryList(null, null, null, domainId);
		List<Workflow> domainWorkflows = workflows.queryList(null, domainId);
		JSONObject values = request.getJSONObject("values");
		String changedField = request.getString("changedField");
		List<ObjectNode> errors = List.of();
		if (values == null) {
			values = existing ? TriggerForm.fromTrigger(trigger) : TriggerForm.defaultValues();
		} else {
			values = TriggerForm.normalizeDraft(values, changedField);
			if (changedField == null) {
				errors = TriggerForm.fieldErrors(
						values, actionIds(domainActions), workflowIds(domainWorkflows), lang, langService);
			}
		}
		return TriggerForm.describe(values, errors, existing, domainActions, domainWorkflows, lang, langService);
	}

	/**
	 * Validates and persists a Trigger save request (whole object or partial {@code submittedFields}), enforcing domain
	 * isolation, structured field refusals, and interactive-login credential checks for workflow triggers.
	 */
	public Trigger saveDefinition(JSONObject request, User user, String lang) {
		JSONObject param = submittedValues(request, user.getDomainId(), lang);
		String id = param.getString("id");
		Trigger existing = null;
		if (id != null && !id.isBlank()) {
			existing = triggers.queryById(id);
			if (existing != null && !user.getDomainId().equals(existing.getDomainId())) {
				throw new OwnerRefusal("TRIGGER_NOT_FOUND", text(lang, "Trigger.notFound"));
			}
		}

		if (param.get("conditionKind") == null) param.put("conditionKind", Trigger.CONDITION_TIME);
		List<Action> domainActions = actions.queryList(null, null, null, user.getDomainId());
		List<Workflow> domainWorkflows = workflows.queryList(null, user.getDomainId());
		List<ObjectNode> errors = TriggerForm.fieldErrors(
				param, actionIds(domainActions), workflowIds(domainWorkflows), lang, langService);
		if (!errors.isEmpty()) {
			String firstMessage = errors.getFirst().path("message").asText("Invalid trigger");
			throw new OwnerFieldRefusal("TRIGGER_INVALID", errors, firstMessage);
		}

		boolean explicitEnabled = param.containsKey("enabled") && param.get("enabled") != null;
		Boolean requestedEnabled = param.getBoolean("enabled");
		normalizeForSave(param, existing);

		Trigger trigger = param.to(Trigger.class);
		trigger.setDomainId(user.getDomainId());
		if (trigger.getCreatedBy() == null || trigger.getCreatedBy().isBlank()) {
			trigger.setCreatedBy(existing != null && existing.getCreatedBy() != null ? existing.getCreatedBy() : user.getId());
		}
		if (trigger.getStatus() == null || trigger.getStatus().isBlank()) {
			trigger.setStatus(Trigger.STATUS_PENDING_REVIEW);
		}
		if (Trigger.STATUS_PUBLISHED.equals(trigger.getStatus())) {
			trigger.setEnabled(explicitEnabled ? requestedEnabled : Boolean.TRUE);
		} else {
			trigger.setEnabled(Boolean.FALSE);
		}

		prepareCredentialOrRefuse(trigger, user, lang);
		return triggers.save(trigger, user.getId(), System.currentTimeMillis());
	}

	/** Changes publication status and arming for a Trigger in the caller's domain. */
	public Trigger changeStatus(String id, String status, Boolean requestedEnabled, User user, String lang) {
		Trigger trigger = triggers.queryById(id);
		if (trigger == null || !user.getDomainId().equals(trigger.getDomainId())) {
			throw new OwnerRefusal("TRIGGER_NOT_FOUND", text(lang, "Trigger.notFound"));
		}
		if (!Trigger.STATUS_PUBLISHED.equals(status)
				&& !Trigger.STATUS_UNUSED.equals(status)
				&& !Trigger.STATUS_PENDING_REVIEW.equals(status)) {
			throw new OwnerRefusal("TRIGGER_STATUS_INVALID", text(lang, "Trigger.statusInvalid"));
		}
		trigger.setStatus(status);
		// Arming follows publication: an unpublished trigger has no slot, so it cannot fire.
		trigger.setEnabled(Trigger.STATUS_PUBLISHED.equals(status) && !Boolean.FALSE.equals(requestedEnabled));
		if (Boolean.TRUE.equals(trigger.getEnabled())) {
			prepareCredentialOrRefuse(trigger, user, lang);
		}
		return triggers.save(trigger, user.getId(), System.currentTimeMillis());
	}

	/** Deletes a Trigger in the caller's domain, refusing when missing or outside the domain. */
	public void deleteInDomain(String id, String domainId, String lang) {
		Trigger trigger = triggers.queryById(id);
		if (trigger == null || !domainId.equals(trigger.getDomainId())) {
			throw new OwnerRefusal("TRIGGER_NOT_FOUND", text(lang, "Trigger.notFound"));
		}
		triggers.delete(id, domainId);
	}

	private JSONObject submittedValues(JSONObject request, String domainId, String lang) {
		JSONObject param = request == null ? new JSONObject() : new JSONObject(request);
		List<String> submitted = param.getList("submittedFields", String.class);
		param.remove("submittedFields");
		if (submitted == null) return param;
		String id = param.getString("id");
		JSONObject saved;
		if (id == null || id.isBlank()) {
			saved = TriggerForm.defaultValues();
		} else {
			Trigger stored = triggers.queryById(id);
			if (stored == null || !domainId.equals(stored.getDomainId())) {
				throw new OwnerRefusal("TRIGGER_NOT_FOUND", text(lang, "Trigger.notFound"));
			}
			saved = TriggerForm.fromTrigger(stored);
		}
		JSONObject values = PanelFormFields.withSubmitted(saved, param, submitted);
		if (id != null && !id.isBlank()) values.put("id", id);
		return values;
	}

	private static void normalizeForSave(JSONObject param, Trigger existing) {
		String name = param.getString("name");
		if (name != null) param.put("name", name.trim());
		String description = param.getString("description");
		param.put("description", description == null || description.isBlank() ? null : description.trim());
		String executor = param.getString("executor");
		param.put("executor", executor == null || executor.isBlank() ? null : executor.trim());

		JSONObject condition = param.getJSONObject("condition");
		if (condition != null) {
			String tz = condition.getString("timeZone");
			if (tz != null) condition.put("timeZone", tz.trim());
		}

		String effectKind = param.getString("effectKind");
		JSONObject rawEffect = param.getJSONObject("effect");
		JSONObject cleanEffect = new JSONObject();
		if (Trigger.EFFECT_ACTION.equals(effectKind) && rawEffect != null) {
			cleanEffect.put("actionId", rawEffect.getString("actionId").trim());
			JSONObject parameters = rawEffect.getJSONObject("parameters");
			cleanEffect.put("parameters", parameters == null ? new JSONObject() : parameters);
		} else if (Trigger.EFFECT_WORKFLOW.equals(effectKind) && rawEffect != null) {
			String workflowId = rawEffect.getString("workflowId").trim();
			cleanEffect.put("workflowId", workflowId);
			JSONObject inputs = rawEffect.getJSONObject("inputs");
			cleanEffect.put("inputs", inputs == null ? new JSONObject() : inputs);
			// Preserve backend-level workflow trigger metadata when editing through the panel form.
			JSONObject prior = existing != null && Trigger.EFFECT_WORKFLOW.equals(existing.getEffectKind())
					&& workflowId.equals(existing.getEffect() == null ? null : existing.getEffect().getString("workflowId"))
					? existing.getEffect() : null;
			String requester = rawEffect.getString("requester");
			if ((requester == null || requester.isBlank()) && prior != null) requester = prior.getString("requester");
			if (requester != null && !requester.isBlank()) cleanEffect.put("requester", requester);
			String goalText = rawEffect.getString("goalText");
			if ((goalText == null || goalText.isBlank()) && prior != null) goalText = prior.getString("goalText");
			if (goalText != null && !goalText.isBlank()) cleanEffect.put("goalText", goalText);
		}
		param.put("effect", cleanEffect);
	}

	private void prepareCredentialOrRefuse(Trigger trigger, User user, String lang) {
		try {
			prepareCredential(trigger, user);
		} catch (AgentHttpException error) {
			throw new OwnerRefusal(error.code(), error.message(langService, lang));
		}
	}

	private static Set<String> actionIds(List<Action> list) {
		Set<String> ids = new HashSet<>();
		if (list != null) {
			for (Action item : list) {
				if (item != null && item.getId() != null) ids.add(item.getId());
			}
		}
		return ids;
	}

	private static Set<String> workflowIds(List<Workflow> list) {
		Set<String> ids = new HashSet<>();
		if (list != null) {
			for (Workflow item : list) {
				if (item != null && item.getId() != null) ids.add(item.getId());
			}
		}
		return ids;
	}

	private String text(String lang, String key) {
		if (langService == null) return key;
		String value = langService.get(lang, key);
		return value == null || value.isBlank() ? key : value;
	}

	/**
	 * Make sure a workflow trigger's executor has a background credential before the trigger is armed.
	 *
	 * <p>Only the executor can provide it, from an interactive sign-in, exactly as for the platform's scheduled tasks;
	 * someone else saving or publishing the trigger leaves the executor's credential as it is.</p>
	 */
	public void prepareCredential(Trigger trigger, User user) {
		if (Trigger.EFFECT_WORKFLOW.equals(trigger.getEffectKind()) && user.getId().equals(executorOf(trigger)))
			credentials.prepareForSetup(user);
	}

	/** The principal the effect runs as: the declared executor, else the creator. */
	public String executorOf(Trigger trigger) {
		String declared = trigger.getExecutor();
		if (declared == null || declared.isBlank() || "requester".equals(declared)) return trigger.getCreatedBy();
		if (declared.startsWith("principal:")) return declared.substring("principal:".length());
		return declared;
	}

	/**
	 * Fire once.
	 *
	 * <p>The slot is part of the idempotency key, so firing the same slot twice — a replayed evaluation, a manual run
	 * on a slot the clock already claimed — produces one execution, not two. The check is at the receiving side: the
	 * ledger has a unique partial index on `trigger_key`.</p>
	 */
	public JSONObject fire(Trigger trigger, Instant slot, String lang) {
		String executor = executorOf(trigger);
		if (executor == null || executor.isBlank())
			throw new IllegalArgumentException("Trigger " + trigger.getId() + " has no executor");
		String key = TriggerDao.fireKey(trigger, slot);
		var result = new JSONObject();
		result.put("triggerId", trigger.getId());
		result.put("slot", slot.toString());
		result.put("triggerKey", key);
		result.put("executor", executor);

		if (Trigger.EFFECT_ACTION.equals(trigger.getEffectKind())) return fireAction(trigger, slot, key, executor, lang, result);
		if (Trigger.EFFECT_WORKFLOW.equals(trigger.getEffectKind()))
			return fireWorkflow(trigger, slot, key, executor, result);
		throw new IllegalArgumentException("Trigger.effectKind " + trigger.getEffectKind() + " has no executor");
	}

	private JSONObject fireAction(Trigger trigger, Instant slot, String key, String executor, String lang,
			JSONObject result) {
		String actionId = trigger.getEffect().getString("actionId");
		var action = actions.queryById(actionId);
		if (action == null) throw new IllegalArgumentException("Action not found: " + actionId);
		if (!action.getDomainId().equals(trigger.getDomainId()))
			throw new IllegalArgumentException("Action " + actionId + " belongs to another domain");
		var user = identity.creator(trigger.getDomainId(), executor);
		var permission = identity.dataPermission(trigger.getDomainId(), executor);
		var parameters = trigger.getEffect().getJSONObject("parameters");
		var runId = UUID.randomUUID();
		result.put("effect", "action");
		result.put("actionId", actionId);
		result.put("runId", runId.toString());
		try {
			var output = actions.executeScheduled(action, parameters == null ? new JSONObject() : parameters, lang, user,
					permission, 10, runId);
			boolean failed = output != null && output.getError() != null && !output.getError().isBlank();
			result.put("status", failed ? "failed" : "succeeded");
			if (failed) result.put("error", output.getError());
			else result.put("output", output == null ? null : output.getResult());
		} catch (Exception error) {
			log.warn(">>>Trigger {} failed to run action {}: {}", trigger.getId(), actionId, error.getMessage());
			result.put("status", "failed");
			result.put("error", error.getMessage());
		}
		return result;
	}

	/** The platform's internal subject id as the login code the execution plane uses. */
	private String loginCodeOf(String domainId, String subjectId) {
		try {
			var user = identity.creator(domainId, subjectId);
			if (user != null && user.getLoginCode() != null && !user.getLoginCode().isBlank())
				return user.getLoginCode();
		} catch (Exception unresolved) {
			log.warn(">>>Trigger could not resolve {} to a login code: {}", subjectId, unresolved.getMessage());
		}
		return subjectId;
	}

	/**
	 * Start a Run in Ontopraxis.
	 *
	 * <p>The trigger does not advance the run: it asks the execution plane to create one, with the trigger's key, and
	 * stops there. Anything else would make the scheduler a second workflow engine.</p>
	 */
	private JSONObject fireWorkflow(Trigger trigger, Instant slot, String key, String executor, JSONObject result) {
		String workflowId = trigger.getEffect().getString("workflowId");
		String base = System.getenv().getOrDefault("ONTOPRAXIS_BASE_URL", "http://127.0.0.1:18600");
		var body = new JSONObject();
		body.put("workflowId", workflowId);
		// The execution plane addresses subjects by login code, not by the platform's internal id. Resolving here keeps
		// that vocabulary out of Ontopraxis, and keeps one id space from leaking into another: the ledger stores what
		// the platform calls the person, not a row key that means nothing outside this database.
		var requester = trigger.getEffect().getString("requester");
		if (requester == null || requester.isBlank()) requester = loginCodeOf(trigger.getDomainId(), executor);
		body.put("requester", requester);
		body.put("triggerRef", "trigger:" + trigger.getId());
		// The ledger's unique index on trigger_key is what makes a replayed slot one run, so the key must carry the slot.
		body.put("triggerKey", key);
		var goal = trigger.getEffect().getString("goalText");
		if (goal != null && !goal.isBlank()) body.put("goalText", goal);
		var inputs = trigger.getEffect().getJSONObject("inputs");
		if (inputs != null && !inputs.isEmpty()) body.put("inputs", inputs);
		result.put("effect", "workflow");
		result.put("workflowId", workflowId);
		try {
			// The execution plane requires a credential for every mutating call. It is the executor's background
			// credential, the one the platform's scheduled tasks already hold: an internal key is a single slot per
			// member, so issuing a second one here would revoke the key those tasks run with.
			var request = HttpRequest.newBuilder(URI.create(base.replaceAll("/+$", "") + "/runs"))
					.header("content-type", "application/json")
					.header("authorization", "Bearer " + credentials.forOwner(trigger.getDomainId(), executor))
					.timeout(Duration.ofSeconds(60));
			var prepared = request.POST(HttpRequest.BodyPublishers.ofString(body.toJSONString())).build();
			var response = http.send(prepared, HttpResponse.BodyHandlers.ofString());
			result.put("status", response.statusCode() >= 200 && response.statusCode() < 300 ? "succeeded" : "failed");
			result.put("httpStatus", response.statusCode());
			var text = response.body();
			try {
				var parsed = JSON.parseObject(text);
				if (response.statusCode() >= 300) result.put("error", parsed.getString("error"));
				else result.put("runId", parsed.getString("id"));
			} catch (Exception unreadable) {
				result.put("body", text.length() > 300 ? text.substring(0, 300) : text);
			}
		} catch (UserCredentials.Invalid invalid) {
			result.put("status", "failed");
			result.put("error", "The executor's background credential is missing or invalid; the executor must sign in and save the trigger again");
		} catch (Exception error) {
			log.warn(">>>Trigger {} could not start workflow {}: {}", trigger.getId(), workflowId, error.getMessage());
			result.put("status", "failed");
			result.put("error", error.getMessage());
		}
		return result;
	}
}
