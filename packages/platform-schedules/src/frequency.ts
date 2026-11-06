import type { PlatformTaskFrequency } from "@ontomato/contracts/platform-schedules";

type Kind = PlatformTaskFrequency["kind"];
type Unit = Extract<PlatformTaskFrequency, { kind: "interval" }>["unit"];

/**
 * The time controls' draft: every kind's own values are kept while the reader switches kinds, so going from "every
 * week" to "every day" and back does not lose the weekday. Only the chosen kind becomes the task's frequency.
 */
export interface FrequencyDraft {
  kind: Kind;
  every: number;
  unit: Unit;
  time: string;
  weekday: number;
  day: number;
  expression: string;
}

/** A new task runs every day at 09:00; an existing one starts from its own frequency. */
export function frequencyDraft(frequency?: PlatformTaskFrequency): FrequencyDraft {
  return {
    kind: frequency?.kind ?? "daily",
    every: frequency?.kind === "interval" ? frequency.every : 1,
    unit: frequency?.kind === "interval" ? frequency.unit : "hour",
    time: frequency && "time" in frequency ? frequency.time : "09:00",
    weekday: frequency?.kind === "weekly" ? frequency.weekday : 1,
    day: frequency?.kind === "monthly" ? frequency.day : 1,
    expression: frequency?.kind === "cron" ? frequency.expression : "0 0 9 * * *",
  };
}

export function frequencyOf(draft: FrequencyDraft): PlatformTaskFrequency {
  switch (draft.kind) {
    case "interval":
      return { kind: "interval", every: draft.every, unit: draft.unit };
    case "daily":
      return { kind: "daily", time: draft.time };
    case "weekly":
      return { kind: "weekly", weekday: draft.weekday, time: draft.time };
    case "monthly":
      return { kind: "monthly", day: draft.day, time: draft.time };
    case "cron":
      return { kind: "cron", expression: draft.expression };
  }
}

/**
 * Weekday 1 = Monday … 7 = Sunday, named in the reader's language. 2024-01-01 was a Monday, and UTC keeps the date
 * from drifting with the reader's zone.
 */
export function weekdayName(weekday: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, weekday)));
}
