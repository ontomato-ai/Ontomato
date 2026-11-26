import type { PlatformTaskRun } from "@ontomato/contracts/platform-schedules";

/** A trigger only starts a workflow; the workflow's eventual outcome belongs to its own run. */
export function taskRunStatusKey(run: PlatformTaskRun): string {
  const status = run.status === "completed" && run.snapshot.targetKind === "workflow" ? "workflowStarted" : run.status;
  return `platformSchedules.runStatus.${status}`;
}
