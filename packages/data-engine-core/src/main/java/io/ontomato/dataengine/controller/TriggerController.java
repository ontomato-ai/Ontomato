package io.ontomato.dataengine.controller;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.bean.workflow.Workflow;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.TriggerDao;
import io.ontomato.dataengine.schedules.TriggerMigration;
import io.ontomato.dataengine.service.ActionService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.SubjectDirectory;
import io.ontomato.dataengine.service.TriggerForm;
import io.ontomato.dataengine.service.TriggerService;
import io.ontomato.dataengine.service.WorkflowService;
import io.ontomato.dataengine.util.SystemUtils;
import lombok.extern.slf4j.Slf4j;

/**
 * Triggers as a capability: create, edit, publish, retire, and fire once by hand.
 *
 * <p>The shape follows the other capability controllers (`/action/save`, `/workflow/save`): the body carries the
 * object, the caller is the authenticated subject, and the answer is `{success, data|message}`.</p>
 */
@Slf4j
@RestController
public class TriggerController {

	@Autowired
	private TriggerDao triggers;

	@Autowired
	private TriggerService service;

	@Autowired
	private TriggerMigration migration;

	@Autowired
	private ActionService actionService;

	@Autowired
	private WorkflowService workflowService;

	@Autowired
	private SubjectDirectory subjectDirectory;

	@Autowired
	private LangService langService;

	@Autowired
	private ObjectMapper objectMapper;

	/**
	 * Move the ontology application's scheduled tasks onto Triggers.
	 *
	 * <p>Idempotent and safe to run twice: a migrated task is disarmed and excluded by its marker, so the second run
	 * copies nothing. Kept as an operator action rather than an automatic startup step because a migration that runs on
	 * boot would move rows before anyone had a chance to inspect them.</p>
	 */
	@PostMapping("/trigger/migrate-ontology-tasks")
	@ResponseBody
	public JSONObject migrateOntologyTasks() {
		JSONObject ret = new JSONObject();
		try {
			var report = migration.migrateOntologyTasks();
			ret.put("data", JSONObject.of(
					"migrated", report.migrated(),
					"fromFunction", report.fromFunction(),
					"skippedNoAction", report.skippedNoAction(),
					"skippedOther", report.skippedOther(),
					"skippedIds", report.skippedIds()));
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/trigger/form")
	@ResponseBody
	public JSONObject form(
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
			@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("data", service.definitionForm(param, lang, user.getDomainId()));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/trigger/save")
	@ResponseBody
	public JSONObject save(
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
			@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Trigger saved = service.saveDefinition(param, user, lang);
			ret.put("data", withDisplay(saved, displayContext(user.getDomainId()), lang));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/trigger/delete")
	@ResponseBody
	public JSONObject delete(
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
			@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			service.deleteInDomain(param == null ? null : param.getString("id"), user.getDomainId(), lang);
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/trigger/queryById")
	@ResponseBody
	public JSONObject queryById(
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
			@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			var trigger = triggers.queryById(param == null ? null : param.getString("id"));
			// A trigger of another domain is not this domain's authority; answering "not found" is also the honest
			// answer, because the caller has no way to tell the difference and should not learn that it exists.
			if (trigger == null || !user.getDomainId().equals(trigger.getDomainId()))
				throw new OwnerRefusal("TRIGGER_NOT_FOUND", langService.get(lang, "Trigger.notFound"));
			ret.put("data", withDisplay(trigger, displayContext(user.getDomainId()), lang));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/trigger/queryList")
	@ResponseBody
	public JSONObject queryList(
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
			@RequestBody(required = false) JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String status = param == null ? null : param.getString("status");
			List<Trigger> list = triggers.queryList(user.getDomainId(), status);
			ret.put("data", withDisplay(list, user.getDomainId(), lang));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	/**
	 * Publish or retire.
	 *
	 * <p>Publishing is the review moment: it bumps the revision and arms the schedule. Retiring stops firing while
	 * keeping the definition readable, which is the difference between "switched off" and "deleted".</p>
	 */
	@PostMapping("/trigger/status")
	@ResponseBody
	public JSONObject status(
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
			@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Trigger saved = service.changeStatus(
					param == null ? null : param.getString("id"),
					param == null ? null : param.getString("status"),
					param == null ? null : param.getBoolean("enabled"),
					user,
					lang);
			ret.put("data", withDisplay(saved, displayContext(user.getDomainId()), lang));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	/** Fire once by hand, whatever the schedule says. The same path the evaluator takes, minus the clock. */
	@PostMapping("/trigger/run")
	@ResponseBody
	public JSONObject run(
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, defaultValue = "en") String lang,
			@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			var trigger = triggers.queryById(param == null ? null : param.getString("id"));
			if (trigger == null || !user.getDomainId().equals(trigger.getDomainId()))
				throw new OwnerRefusal("TRIGGER_NOT_FOUND", langService.get(lang, "Trigger.notFound"));
			ret.put("data", service.fire(trigger, Instant.now(), lang));
			ret.put("success", true);
		} catch (OwnerRefusal e) {
			e.writeTo(ret);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	private record DisplayContext(
			Map<String, String> subjectNames,
			Map<String, String> actionNames,
			Map<String, String> workflowNames) {}

	private DisplayContext displayContext(String domainId) {
		return new DisplayContext(subjectNames(domainId), actionNames(domainId), workflowNames(domainId));
	}

	private ArrayNode withDisplay(List<Trigger> list, String domainId, String lang) {
		DisplayContext context = displayContext(domainId);
		ArrayNode items = objectMapper.createArrayNode();
		for (Trigger trigger : list) items.add(withDisplay(trigger, context, lang));
		return items;
	}

	private ObjectNode withDisplay(Trigger trigger, DisplayContext context, String lang) {
		ObjectNode item = objectMapper.valueToTree(trigger);
		item.put("nextRunAt", trigger.getNextRunAt() == null ? null : trigger.getNextRunAt().toString());
		item.put("lastFiredAt", trigger.getLastFiredAt() == null ? null : trigger.getLastFiredAt().toString());
		item.put("createdByName", context.subjectNames().get(trigger.getCreatedBy()));
		item.put("reviewedByName", context.subjectNames().get(trigger.getReviewedBy()));
		item.put("statusLabel", statusLabel(trigger.getStatus(), lang));
		item.put("conditionKindLabel", conditionKindLabel(trigger.getConditionKind(), lang));
		String effectKindLabel = effectKindLabel(trigger.getEffectKind(), lang);
		item.put("effectKindLabel", effectKindLabel);

		String targetId = effectTargetId(trigger);
		String targetName = effectTargetName(trigger, targetId, context);
		item.put("effectTargetId", targetId);
		item.put("effectTargetName", targetName);
		item.put("effectLabel", formatEffectLabel(effectKindLabel, targetName, targetId));
		item.put("cadenceSummary", TriggerForm.cadenceSummary(trigger.getCondition(), lang, langService));
		item.put("executorName", executorDisplayName(trigger, context.subjectNames()));
		return item;
	}

	private String executorDisplayName(Trigger trigger, Map<String, String> subjects) {
		String executorId = service.executorOf(trigger);
		if (executorId != null && subjects.containsKey(executorId)) return subjects.get(executorId);
		String raw = trigger.getExecutor();
		return raw == null || raw.isBlank() ? subjects.get(trigger.getCreatedBy()) : raw;
	}

	private static String effectTargetId(Trigger trigger) {
		if (trigger.getEffect() == null) return null;
		if (Trigger.EFFECT_ACTION.equals(trigger.getEffectKind())) return trigger.getEffect().getString("actionId");
		if (Trigger.EFFECT_WORKFLOW.equals(trigger.getEffectKind())) return trigger.getEffect().getString("workflowId");
		return null;
	}

	private static String effectTargetName(Trigger trigger, String targetId, DisplayContext context) {
		if (targetId == null || targetId.isBlank()) return null;
		if (Trigger.EFFECT_ACTION.equals(trigger.getEffectKind())) return context.actionNames().get(targetId);
		if (Trigger.EFFECT_WORKFLOW.equals(trigger.getEffectKind())) return context.workflowNames().get(targetId);
		return null;
	}

	private static String formatEffectLabel(String kindLabel, String targetName, String targetId) {
		String target = targetName != null && !targetName.isBlank() ? targetName : targetId;
		if (kindLabel == null || kindLabel.isBlank()) return target == null ? "" : target;
		if (target == null || target.isBlank()) return kindLabel;
		return kindLabel + " · " + target;
	}

	private Map<String, String> subjectNames(String domainId) {
		Map<String, String> names = new HashMap<>();
		for (SubjectDirectory.Subject subject : subjectDirectory.subjectsInDomain(domainId)) {
			names.put(
					subject.id(),
					subject.displayName() == null || subject.displayName().isBlank()
							? subject.loginCode()
							: subject.displayName());
		}
		return names;
	}

	private Map<String, String> actionNames(String domainId) {
		Map<String, String> names = new HashMap<>();
		List<Action> list = actionService.queryList(null, null, null, domainId);
		if (list != null) {
			for (Action action : list) {
				if (action != null && action.getId() != null) names.put(action.getId(), action.getName());
			}
		}
		return names;
	}

	private Map<String, String> workflowNames(String domainId) {
		Map<String, String> names = new HashMap<>();
		List<Workflow> list = workflowService.queryList(null, domainId);
		if (list != null) {
			for (Workflow workflow : list) {
				if (workflow != null && workflow.getId() != null) names.put(workflow.getId(), workflow.getName());
			}
		}
		return names;
	}

	private String statusLabel(String status, String lang) {
		if (status == null) return null;
		return switch (status) {
			case Trigger.STATUS_PENDING_REVIEW -> langService.get(lang, "PanelForm.status.pendingReview");
			case Trigger.STATUS_PUBLISHED -> langService.get(lang, "PanelForm.status.published");
			case Trigger.STATUS_UNUSED -> langService.get(lang, "PanelForm.status.unused");
			default -> status;
		};
	}

	private String conditionKindLabel(String conditionKind, String lang) {
		if (conditionKind == null) return null;
		return Trigger.CONDITION_TIME.equals(conditionKind)
				? langService.get(lang, "Trigger.condition.time")
				: conditionKind;
	}

	private String effectKindLabel(String effectKind, String lang) {
		if (effectKind == null) return null;
		return switch (effectKind) {
			case Trigger.EFFECT_ACTION -> langService.get(lang, "Trigger.effect.action");
			case Trigger.EFFECT_WORKFLOW -> langService.get(lang, "Trigger.effect.workflow");
			default -> effectKind;
		};
	}
}
