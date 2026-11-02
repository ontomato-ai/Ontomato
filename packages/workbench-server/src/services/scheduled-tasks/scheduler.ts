import { environment } from "../../config/environment";
import { createLogger } from "../../logging/logger";
import { settleScheduledRuns, startScheduledRun } from "./runner";
import { nextRunAfterSlot } from "./schedule";
import { scheduledTaskStore } from "./store";

const logger = createLogger("scheduled-task-scheduler");
const TICK_MS = 30_000;
const DUE_BATCH = 20;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

/**
 * One pass: end runs that have stopped, then fire due tasks. A due slot is claimed by moving it to the next slot
 * after now (see nextRunAfterSlot), so a slot fires once across instances and a long outage fires once, not once per
 * missed slot.
 */
export async function runSchedulerTick(now = Date.now()) {
  await settleScheduledRuns(now);
  const zone = environment.scheduleTimeZone();
  const due = await scheduledTaskStore.due(new Date(now), DUE_BATCH);
  await Promise.allSettled(
    due.map(async (task) => {
      // Due tasks always have a slot; it anchors an interval's next one.
      const next = nextRunAfterSlot(task.frequency, task.nextRunAt!.getTime(), now, zone);
      const claimed = await scheduledTaskStore.claim(task, new Date(next));
      if (claimed) await startScheduledRun(claimed, "schedule");
    }),
  );
}

export function startScheduledTaskScheduler() {
  if (timer) return;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runSchedulerTick();
    } catch (error) {
      logger.error("Scheduled task tick failed", { errorName: error instanceof Error ? error.name : typeof error, cause: error instanceof Error ? error.message : String(error) });
    } finally {
      ticking = false;
    }
  };
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  logger.info("Scheduled task scheduler started", { tickMs: TICK_MS, timeZone: environment.scheduleTimeZone() });
  void tick();
}
