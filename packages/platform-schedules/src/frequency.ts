import type { PlatformTaskRun, PlatformTask } from "@ontomato/contracts/platform-schedules";
import type { Translate } from "./i18n";

/**
 * Weekday 1 = Monday … 7 = Sunday, named in the reader's language. 2024-01-01 was a Monday, and UTC keeps the date
 * from drifting with the reader's zone.
 */
export function weekdayName(weekday: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, weekday)),
  );
}

/** How often a task runs, in one phrase: the four fixed cadences, or the Cron expression as written. */
export function describeFrequency(
  frequency: PlatformTask["frequency"],
  t: Translate,
  locale: string,
): string {
  switch (frequency.kind) {
    case "interval":
      return t(`frequency.every.${frequency.unit}`, { n: frequency.every }, frequency.every);
    case "daily":
      return t("frequency.daily", { time: frequency.time });
    case "weekly":
      return t("frequency.weekly", { weekday: weekdayName(frequency.weekday, locale), time: frequency.time });
    case "monthly":
      return t("frequency.monthly", { day: frequency.day, time: frequency.time });
    case "cron":
      return t("frequency.cron", { expression: frequency.expression });
  }
}

/** What a task runs: the agent's prompt, or the function's name. */
export function targetSummary(task: PlatformTask, functionName: (id: string) => string): string {
  return task.target.kind === "function" ? functionName(task.target.functionId) : task.target.prompt;
}

/** A run's duration in whole seconds (the service reports milliseconds), or null while it has not stopped. */
export function runSeconds(run: PlatformTaskRun): number | null {
  return run.spendTime === null ? null : Math.round(run.spendTime / 100) / 10;
}
