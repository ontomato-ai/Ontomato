/** Frequency choices of the schedule forms; the server only sees the expression built from them. */
export type ScheduleFrequency = "hourly" | "daily" | "weekly" | "monthly";

export const SCHEDULE_FREQUENCIES: readonly ScheduleFrequency[] = [
  "hourly",
  "daily",
  "weekly",
  "monthly",
];

/** Hour intervals offered for the hourly frequency; each run is anchored at the previous scheduled slot. */
export const SCHEDULE_HOUR_INTERVALS = [1, 2, 3, 4, 6, 12] as const;

export interface ScheduleSettings {
  frequency: ScheduleFrequency;
  everyHours: number;
  time: string;
  dayOfWeek: number;
  dayOfMonth: number;
}

/** Builds the server's schedule expression: `Nh` for hourly, `1d@HH:MM`, `7d@HH:MM/W` or `30d@HH:MM/D` otherwise. */
export function buildScheduleExpression(settings: ScheduleSettings): string {
  switch (settings.frequency) {
    case "hourly":
      return `${settings.everyHours}h`;
    case "daily":
      return `1d@${settings.time}`;
    case "weekly":
      return `7d@${settings.time}/${settings.dayOfWeek}`;
    case "monthly":
      return `30d@${settings.time}/${settings.dayOfMonth}`;
  }
}
