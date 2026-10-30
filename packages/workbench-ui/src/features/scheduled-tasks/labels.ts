import { useI18n } from "vue-i18n";
import type { ScheduledTask, ScheduledTaskRun } from "@ontomato/contracts/scheduled-tasks";

/** Display text of run and task states, shared by the list and the run history. */
export function useRunLabels() {
  const { t, locale } = useI18n();
  return {
    time: (iso: string) =>
      new Intl.DateTimeFormat(locale.value, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)),
    status: (status: ScheduledTaskRun["status"]) => t(`scheduledTasks.runStatus.${status}`),
    statusType: (status: ScheduledTaskRun["status"]) =>
      status === "failed" ? ("danger" as const) : status === "completed" ? ("success" as const) : ("primary" as const),
    trigger: (trigger: ScheduledTaskRun["trigger"]) => t(`scheduledTasks.trigger.${trigger}`),
    error: (error: NonNullable<ScheduledTaskRun["error"]>) =>
      [t(`scheduledTasks.error.${error.code}`), error.message].filter(Boolean).join(" "),
    taskState: (task: ScheduledTask) =>
      task.pausedReason ? t(`scheduledTasks.paused.${task.pausedReason}`) : task.enabled ? t("scheduledTasks.on") : t("scheduledTasks.off"),
  };
}
