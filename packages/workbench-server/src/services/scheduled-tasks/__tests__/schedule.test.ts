import { describe, expect, it } from "vitest";
import type { ScheduledTaskFrequency } from "@ontomato/contracts/scheduled-tasks";
import { nextRunAt } from "../schedule";

/** Times of day are wall-clock times of the schedule zone, whatever zone the process itself runs in. */
const next = (frequency: ScheduledTaskFrequency, afterIso: string, zone: string) =>
  new Date(nextRunAt(frequency, Date.parse(afterIso), zone)).toISOString();

describe("scheduled task frequencies", () => {
  it("counts intervals from the previous trigger", () => {
    expect(next({ kind: "interval", every: 15, unit: "minute" }, "2026-03-08T05:00:00Z", "UTC")).toBe("2026-03-08T05:15:00.000Z");
    expect(next({ kind: "interval", every: 2, unit: "day" }, "2026-03-08T05:00:00Z", "UTC")).toBe("2026-03-10T05:00:00.000Z");
  });

  it("runs daily times in the schedule zone, today when still ahead", () => {
    const daily = { kind: "daily", time: "03:30" } as const;
    expect(next(daily, "2026-03-08T05:00:00Z", "UTC")).toBe("2026-03-09T03:30:00.000Z");
    expect(next(daily, "2026-03-08T05:00:00Z", "Asia/Shanghai")).toBe("2026-03-08T19:30:00.000Z");
  });

  it("resolves local times across New York daylight-saving changes", () => {
    const daily = { kind: "daily", time: "03:30" } as const;
    // Spring forward: 03:30 on the transition day is EDT (UTC-4); the base is 00:00 EST.
    expect(next(daily, "2026-03-08T05:00:00Z", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
    // Fall back: 03:30 on the transition day is EST (UTC-5); the base is 00:00 EDT.
    expect(next(daily, "2026-11-01T04:00:00Z", "America/New_York")).toBe("2026-11-01T08:30:00.000Z");
    // From exactly local midnight EST, the next local midnight is already EDT.
    expect(next({ kind: "daily", time: "00:00" }, "2026-03-08T05:00:00Z", "America/New_York")).toBe("2026-03-09T04:00:00.000Z");
  });

  it("keeps weekly and monthly plans on the local wall clock", () => {
    expect(next({ kind: "weekly", weekday: 1, time: "03:30" }, "2026-03-06T05:00:00Z", "America/New_York")).toBe("2026-03-09T07:30:00.000Z");
    expect(next({ kind: "weekly", weekday: 1, time: "03:30" }, "2026-03-06T05:00:00Z", "Asia/Shanghai")).toBe("2026-03-08T19:30:00.000Z");
    expect(next({ kind: "monthly", day: 15, time: "03:30" }, "2026-11-10T05:00:00Z", "America/New_York")).toBe("2026-11-15T08:30:00.000Z");
  });

  it("moves a weekly time already passed today to next week", () => {
    // 2026-03-09 is a Monday.
    expect(next({ kind: "weekly", weekday: 1, time: "03:30" }, "2026-03-09T04:00:00Z", "UTC")).toBe("2026-03-16T03:30:00.000Z");
  });

  it("runs a day past the month's end on its last day", () => {
    const lastDay = { kind: "monthly", day: 31, time: "03:30" } as const;
    expect(next(lastDay, "2026-02-10T00:00:00Z", "UTC")).toBe("2026-02-28T03:30:00.000Z");
    expect(next(lastDay, "2026-02-28T04:00:00Z", "UTC")).toBe("2026-03-31T03:30:00.000Z");
    expect(next(lastDay, "2026-04-30T04:00:00Z", "UTC")).toBe("2026-05-31T03:30:00.000Z");
    expect(next(lastDay, "2028-02-01T00:00:00Z", "UTC")).toBe("2028-02-29T03:30:00.000Z");
    expect(next(lastDay, "2026-12-31T04:00:00Z", "UTC")).toBe("2027-01-31T03:30:00.000Z");
    // The month's end is the schedule zone's: 01:00 on Feb 1 in Shanghai is still Jan 31 in UTC.
    expect(next({ kind: "monthly", day: 31, time: "09:00" }, "2026-01-31T17:00:00Z", "Asia/Shanghai")).toBe("2026-02-28T01:00:00.000Z");
  });
});
