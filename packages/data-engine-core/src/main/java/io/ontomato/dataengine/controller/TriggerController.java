package io.ontomato.dataengine.controller;

import java.time.Instant;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.TriggerDao;
import io.ontomato.dataengine.schedules.TriggerMigration;
import io.ontomato.dataengine.service.TriggerService;
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

	@PostMapping("/trigger/save")
	@ResponseBody
	public JSONObject save(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			var trigger = param.to(Trigger.class);
			trigger.setDomainId(user.getDomainId());
			if (trigger.getCreatedBy() == null) trigger.setCreatedBy(user.getId());
			if (trigger.getStatus() == null) trigger.setStatus(Trigger.STATUS_PENDING_REVIEW);
			service.prepareCredential(trigger, user);
			ret.put("data", triggers.save(trigger, user.getId(), System.currentTimeMillis()));
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/trigger/delete")
	@ResponseBody
	public JSONObject delete(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			triggers.delete(param.getString("id"), user.getDomainId());
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/trigger/queryById")
	@ResponseBody
	public JSONObject queryById(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			var trigger = triggers.queryById(param.getString("id"));
			// A trigger of another domain is not this domain's authority; answering "not found" is also the honest
			// answer, because the caller has no way to tell the difference and should not learn that it exists.
			if (trigger != null && !user.getDomainId().equals(trigger.getDomainId())) trigger = null;
			ret.put("data", trigger);
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/trigger/queryList")
	@ResponseBody
	public JSONObject queryList(@RequestBody(required = false) JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String status = param == null ? null : param.getString("status");
			List<Trigger> list = triggers.queryList(user.getDomainId(), status);
			ret.put("data", JSONArray.from(list.toArray()));
			ret.put("success", true);
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
	public JSONObject status(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			var trigger = triggers.queryById(param.getString("id"));
			if (trigger == null || !user.getDomainId().equals(trigger.getDomainId()))
				throw new IllegalArgumentException("Trigger not found");
			String status = param.getString("status");
			if (!Trigger.STATUS_PUBLISHED.equals(status) && !Trigger.STATUS_UNUSED.equals(status)
					&& !Trigger.STATUS_PENDING_REVIEW.equals(status))
				throw new IllegalArgumentException("Unknown trigger status: " + status);
			trigger.setStatus(status);
			// arming follows publication: an unpublished trigger has no slot, so it cannot fire.
			trigger.setEnabled(Boolean.TRUE.equals(param.getBoolean("enabled"))
					|| Trigger.STATUS_PUBLISHED.equals(status));
			if (trigger.getEnabled()) service.prepareCredential(trigger, user);
			ret.put("data", triggers.save(trigger, user.getId(), System.currentTimeMillis()));
			ret.put("success", true);
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
	public JSONObject run(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			var trigger = triggers.queryById(param.getString("id"));
			if (trigger == null || !user.getDomainId().equals(trigger.getDomainId()))
				throw new IllegalArgumentException("Trigger not found");
			ret.put("data", service.fire(trigger, Instant.now(), lang));
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
}
