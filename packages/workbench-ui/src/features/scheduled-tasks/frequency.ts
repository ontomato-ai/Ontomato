import type { ScheduledTaskFrequency } from "@ontomato/contracts/scheduled-tasks";

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string;

/** Weekday 1 = Monday … 7 = Sunday, named in the reader's language. 2024-01-01 was a Monday. */
export function weekdayName(weekday: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday)));
}

/** How often a task runs, in one phrase. */
export function describeFrequency(frequency: ScheduledTaskFrequency, t: Translate, locale: string): string {
  switch (frequency.kind) {
    case "interval":
      return t(`scheduledTasks.every.${frequency.unit}`, { n: frequency.every }, frequency.every);
    case "daily":
      return t("scheduledTasks.describe.daily", { time: frequency.time });
    case "weekly":
      return t("scheduledTasks.describe.weekly", { weekday: weekdayName(frequency.weekday, locale), time: frequency.time });
    case "monthly":
      return t("scheduledTasks.describe.monthly", { day: frequency.day, time: frequency.time });
  }
}
