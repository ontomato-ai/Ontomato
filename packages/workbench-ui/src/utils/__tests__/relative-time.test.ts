import { afterEach, describe, expect, it, vi } from "vitest";
import { workbenchI18n } from "../../i18n";
import { formatRelativeTime, relativeTime } from "../relative-time";

/*
 * Relative times are shared by the platform home, the app builder's history and the diagnosis pages. The distance picks
 * the unit and the count, and the message's own form follows the count; a language whose message has one form reads as
 * it always did.
 */
const now = Date.parse("2026-11-12T12:00:00Z");
const before = (ms: number) => new Date(now - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

afterEach(() => {
  vi.useRealTimers();
  workbenchI18n().global.locale.value = "en";
});

describe("relative times", () => {
  it("pick the unit and the count of the message each distance falls in", () => {
    vi.useFakeTimers({ now });
    const { t } = workbenchI18n().global;
    const ago = (key: string, n: number) => t(`common.${key}`, { n }, n);
    expect([MINUTE, 2 * MINUTE, HOUR, 3 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 35 * DAY, 70 * DAY].map((ms) => relativeTime(before(ms)))).toEqual([
      ago("minutesAgo", 1), ago("minutesAgo", 2), ago("hoursAgo", 1), ago("hoursAgo", 3), ago("daysAgo", 1), ago("daysAgo", 2),
      ago("weeksAgo", 1), ago("weeksAgo", 2), ago("monthsAgo", 1), ago("monthsAgo", 2),
    ]);
    expect([formatRelativeTime(before(MINUTE)), formatRelativeTime(before(HOUR)), formatRelativeTime(before(5 * HOUR))]).toEqual([
      ago("minutesAgo", 1), ago("hoursAgo", 1), ago("hoursAgo", 5),
    ]);
  });

  it("leave a message of one form as it is, whatever the count", () => {
    vi.useFakeTimers({ now });
    const i18n = workbenchI18n();
    i18n.global.setLocaleMessage("zh-CN", { common: { hoursAgo: "{n}小时前" } });
    i18n.global.locale.value = "zh-CN";
    expect([relativeTime(before(HOUR)), relativeTime(before(3 * HOUR))]).toEqual(["1小时前", "3小时前"]);
  });
});
