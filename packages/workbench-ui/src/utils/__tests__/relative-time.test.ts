import { afterEach, describe, expect, it, vi } from "vitest";
import { workbenchI18n } from "../../i18n";
import { formatRelativeTime, relativeTime } from "../relative-time";

/*
 * Relative times are shared by the platform home, the app builder's history and the diagnosis pages. The count chooses
 * the message's form, so English says "1 hour ago", while a language whose message has one form reads as it always did.
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
  it("use the singular for one and the plural otherwise", () => {
    vi.useFakeTimers({ now });
    expect([MINUTE, 2 * MINUTE, HOUR, 3 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 35 * DAY, 70 * DAY].map((ms) => relativeTime(before(ms)))).toEqual([
      "1 minute ago", "2 minutes ago", "1 hour ago", "3 hours ago", "1 day ago", "2 days ago",
      "1 week ago", "2 weeks ago", "1 month ago", "2 months ago",
    ]);
    expect([formatRelativeTime(before(MINUTE)), formatRelativeTime(before(HOUR)), formatRelativeTime(before(5 * HOUR))]).toEqual([
      "1 minute ago", "1 hour ago", "5 hours ago",
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
