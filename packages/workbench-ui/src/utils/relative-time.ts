import { t, workbenchI18n } from "../i18n";
import { getSynchronizedNow } from "./server-time";


/**
 * Format a date string as a human-readable relative time. The count is also the plural choice, so a language whose
 * message has a singular form ("1 hour ago | {n} hours ago") uses it for one; a message of one form reads the same.
 */
export function relativeTime(dateStr: string): string {
  const now = getSynchronizedNow();
  const then = new Date(dateStr).getTime();

  if (Number.isNaN(then)) return "";

  const diffMs = now - then;
  if (diffMs < 0) return t("common.justNow");

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 60) return t("common.justNow");
  if (minutes < 60) return t("common.minutesAgo", { n: minutes }, minutes);
  if (hours < 24) return t("common.hoursAgo", { n: hours }, hours);
  if (days < 7) return t("common.daysAgo", { n: days }, days);
  if (weeks < 5) return t("common.weeksAgo", { n: weeks }, weeks);
  return t("common.monthsAgo", { n: months }, months);
}

/**
 * Format a timestamp with relative time for recent items,
 * falling back to a locale-aware absolute date.
 * @param ts timestamp as string or number (milliseconds)
 * @param opts.showYear include year in fallback (default false)
 * @param opts.showSeconds include seconds in fallback (default false)
 */
export function formatRelativeTime(
  ts?: string | number,
  opts?: { showYear?: boolean; showSeconds?: boolean }
): string {
  if (!ts) return "";
  const time = new Date(ts).getTime();
  if (Number.isNaN(time)) return "";
  const now = getSynchronizedNow();
  const diff = now - time;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3600_000);
  if (diff < 60_000) return t("common.justNow");
  if (diff < 3600_000) return t("common.minutesAgo", { n: minutes }, minutes);
  if (diff < 86400_000) return t("common.hoursAgo", { n: hours }, hours);
  const localeStr = workbenchI18n().global.locale.value as string;
  const opts_base: Intl.DateTimeFormatOptions = {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  if (opts?.showYear) opts_base.year = "numeric";
  if (opts?.showSeconds) opts_base.second = "2-digit";
  return new Date(time).toLocaleString(localeStr, opts_base);
}

/**
 * A time in a list a reader scans, where neighbouring times must keep their order at a glance (panelisation lead,
 * 2026-11-22): within a minute "just now", within an hour how many minutes ago, today's and yesterday's by their clock
 * time, an older one by its date and time — in the reader's language and time zone. A value that is no time gives "".
 */
export function formatListTime(ts: string): string {
  const time = new Date(ts);
  if (Number.isNaN(time.getTime())) return "";
  const now = new Date(getSynchronizedNow());
  const diff = now.getTime() - time.getTime();
  if (diff >= 0 && diff < 60_000) return t("common.justNow");
  if (diff >= 0 && diff < 3600_000) {
    const minutes = Math.floor(diff / 60_000);
    return t("common.minutesAgo", { n: minutes }, minutes);
  }
  const locale = workbenchI18n().global.locale.value as string;
  const clock = time.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(time)) / 86_400_000);
  if (days === 0) return t("common.todayAt", { time: clock });
  if (days === 1) return t("common.yesterdayAt", { time: clock });
  return time.toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
