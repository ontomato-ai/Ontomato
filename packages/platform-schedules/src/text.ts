import { useI18n } from "vue-i18n";
import type {
  PlatformScheduleRunError,
  PlatformScheduleSummaryItem,
  PlatformTaskFrequency,
  PlatformTaskRunStatus,
} from "@ontomato/contracts/platform-schedules";
import { scheduleFailure } from "./api";
import { weekdayName } from "./frequency";

/** Fills `{name}` placeholders; a plural message is `one | many` and picks its side by `count`. */
export type Translate = (key: string, named?: Record<string, unknown>, count?: number) => string;

const DAY = 86_400_000;

/** The calendar day an instant falls on in a zone, as a day count, so two instants compare by date there. */
function dayIn(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(instant);
  const part = (type: string) => Number(parts.find((candidate) => candidate.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY;
}

/**
 * The page's words and the formats it shows them in. The host's one vue-i18n instance carries this package's text under
 * `platformSchedules` (the public English tree, an edition translating the rest), so the page reads the same language
 * as the shell around it.
 */
export function useScheduleText() {
  const { t: translate, locale } = useI18n();
  const t: Translate = (key, named = {}, count) =>
    count === undefined
      ? translate(`platformSchedules.${key}`, named)
      : translate(`platformSchedules.${key}`, named, count);

  /** "Today 16:00", "yesterday 23:00", "Nov 3 09:00": the calendar day and the time, both read in the task's zone. */
  function moment(iso: string, timeZone: string, now: number = Date.now()): string {
    const instant = new Date(iso);
    const days = dayIn(instant, timeZone) - dayIn(new Date(now), timeZone);
    const day =
      Math.abs(days) <= 1
        ? new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" }).format(days, "day")
        : new Intl.DateTimeFormat(locale.value, {
            timeZone,
            month: "short",
            day: "numeric",
            year: new Date(now).getUTCFullYear() === instant.getUTCFullYear() ? undefined : "numeric",
          }).format(instant);
    const time = new Intl.DateTimeFormat(locale.value, { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(instant);
    return t("time.dayAt", { day, time });
  }

  /** A run's duration from the service's milliseconds: tenths below ten seconds, whole units above. */
  function duration(milliseconds: number): string {
    const seconds = milliseconds / 1000;
    if (seconds < 10) return t("duration.seconds", { n: Math.round(seconds * 10) / 10 });
    const whole = Math.round(seconds);
    if (whole < 3600) {
      return whole < 60
        ? t("duration.seconds", { n: whole })
        : t("duration.minutes", { m: Math.floor(whole / 60), s: whole % 60 });
    }
    return t("duration.hours", { h: Math.floor(whole / 3600), m: Math.floor((whole % 3600) / 60) });
  }

  /** How often a task runs, in one phrase: the four fixed cadences, or the Cron expression as written. */
  function frequency(value: PlatformTaskFrequency): string {
    switch (value.kind) {
      case "interval":
        return t(`frequency.every.${value.unit}`, { n: value.every }, value.every);
      case "daily":
        return t("frequency.daily", { time: value.time });
      case "weekly":
        return t("frequency.weekly", { weekday: weekdayName(value.weekday, locale.value), time: value.time });
      case "monthly":
        return t("frequency.monthly", { day: value.day, time: value.time });
      case "cron":
        return t("frequency.cron", { expression: value.expression });
    }
  }

  /** A sentence with its detail: "category: specifics", or the category alone when the detail only repeats it. */
  function detailed(head: string, detail: string | null | undefined): string {
    const extra = detail?.trim();
    return extra && extra !== head ? t("detail", { head, detail: extra }) : head;
  }

  return {
    t,
    locale,
    moment,
    duration,
    frequency,
    runStatus: (status: PlatformTaskRunStatus) => t(`runStatus.${status}`),
    trigger: (trigger: "manual" | "schedule" | "unknown") => t(`trigger.${trigger}`),
    /** Why a run failed or was skipped, in full: the machine code's own words, then the application's message. */
    runError: (error: PlatformScheduleRunError) => detailed(t(`runError.${error.code}`), error.message),
    /** The same reason in short, where one line holds it: the application's message, or the code's words without one. */
    runReason: (error: PlatformScheduleRunError) => error.message?.trim() || t(`runError.${error.code}`),
    /** What went wrong with a request: the service's refusal by its code and message, or that no answer came. */
    failure(error: unknown): string {
      const refusal = scheduleFailure(error).refusal;
      return refusal ? detailed(t(`httpError.${refusal.code}`), refusal.message) : t("httpError.noAnswer");
    },
    /** The filled-in content as the card shows it: every "name: value" of the application's summary, in its order. */
    summary: (items: readonly PlatformScheduleSummaryItem[]) =>
      items
        .map((item) => t("summaryItem", { label: item.label, value: item.value.replace(/\s+/g, " ").trim() }))
        .join(t("summarySeparator")),
  };
}

export type ScheduleText = ReturnType<typeof useScheduleText>;
