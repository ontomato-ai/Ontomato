package io.ontomato.dataengine.schedules;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.dao.TriggerDao;
import io.ontomato.dataengine.service.TriggerService;
import lombok.extern.slf4j.Slf4j;

/**
 * Evaluates the time table and fires what is due.
 *
 * <p>Evaluation and firing live in the kernel for the same reason the workflow engine does: a trigger that fired inside
 * a request would need a request to fire. The definition stays in the capability layer (a row an operator edits); this
 * loop only decides that its slot has arrived.</p>
 *
 * <p>Two steps, two transactions. The slot is claimed first — advancing `next_run_at` under the row lock — and the
 * firing happens after that commits. A crash between the two loses one firing rather than repeating it, which is the
 * safe direction: a duplicated business write cannot be undone, a missed run can be fired by hand.</p>
 */
@Slf4j
@Service
public class TriggerScheduler {

	@Autowired
	private TriggerDao triggers;

	@Autowired
	private TriggerService service;

	@Autowired
	private TransactionTemplate transactions;

	@Scheduled(fixedDelay = 1000)
	public void tick() {
		Instant now = Instant.now();
		List<Trigger> claimed = new ArrayList<>();
		List<Instant> slots = new ArrayList<>();
		try {
			transactions.executeWithoutResult(tx -> {
				for (Trigger trigger : triggers.due(now, 50)) {
					Instant slot = trigger.getNextRunAt();
					if (slot == null) continue;
					Instant next = triggers.nextSlotFor(trigger, slot);
					// Advance first: the next evaluation must not see this slot again, even if firing throws.
					triggers.advance(trigger.getId(), next, slot);
					claimed.add(trigger);
					slots.add(slot);
				}
			});
		} catch (Exception error) {
			log.error("Trigger evaluation failed", error);
			return;
		}
		for (int index = 0; index < claimed.size(); index += 1) {
			var trigger = claimed.get(index);
			var slot = slots.get(index);
			try {
				var result = service.fire(trigger, slot, "zh-CN");
				log.info(">>>Trigger {} fired for slot {}: {} {}", trigger.getId(), slot,
						result.getString("status"), result.getString("runId"));
			} catch (Exception error) {
				log.warn(">>>Trigger {} failed for slot {}: {}", trigger.getId(), slot, error.getMessage());
			}
		}
	}
}
