import type { ScheduledTaskFrequency } from "@ontomato/contracts/scheduled-tasks";

/**
 * The next trigger instant of a frequency, strictly after `after` (epoch ms). Times of day are wall-clock times of
 * `timeZone`, resolved across daylight-saving changes; a monthly day past the end of a month runs on its last day.
 */
export function nextRunAt(frequency: ScheduledTaskFrequency, after: number, timeZone: string): number {
  const zone = new ZoneClock(timeZone);
  switch (frequency.kind) {
    case "interval":
      return after + frequency.every * UNIT_MS[frequency.unit];
    case "daily": {
      const [hours, minutes] = clock(frequency.time);
      const today = zone.wallParts(after);
      const candidate = zone.instant(today.year, today.month, today.day, hours, minutes);
      return candidate > after ? candidate : zone.instant(today.year, today.month, today.day + 1, hours, minutes);
    }
    case "weekly": {
      const [hours, minutes] = clock(frequency.time);
      const today = zone.wallParts(after);
      // Weekday of the wall-clock date, independent of the zone: 1 = Monday … 7 = Sunday.
      const weekday = ((new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() + 6) % 7) + 1;
      let days = (frequency.weekday - weekday + 7) % 7;
      if (days === 0 && zone.instant(today.year, today.month, today.day, hours, minutes) <= after) days = 7;
      return zone.instant(today.year, today.month, today.day + days, hours, minutes);
    }
    case "monthly": {
      const [hours, minutes] = clock(frequency.time);
      const today = zone.wallParts(after);
      const inMonth = (year: number, month: number) =>
        zone.instant(year, month, Math.min(frequency.day, daysInMonth(year, month)), hours, minutes);
      const candidate = inMonth(today.year, today.month);
      if (candidate > after) return candidate;
      return today.month === 12 ? inMonth(today.year + 1, 1) : inMonth(today.year, today.month + 1);
    }
  }
}

/**
 * The slot after a due slot fires at `now`. An interval keeps its cadence anchored at the previous slot: the next
 * slot is the first `previous + k * interval` strictly after now, so a late tick does not push the schedule back and
 * an outage fires once instead of once per missed slot. Times of day do not depend on the previous slot.
 */
export function nextRunAfterSlot(
  frequency: ScheduledTaskFrequency,
  previousSlot: number,
  now: number,
  timeZone: string,
): number {
  if (frequency.kind !== "interval") return nextRunAt(frequency, now, timeZone);
  const step = frequency.every * UNIT_MS[frequency.unit];
  return previousSlot + Math.max(1, Math.floor((now - previousSlot) / step) + 1) * step;
}

const UNIT_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;

function clock(time: string): [number, number] {
  const [hours, minutes] = time.split(":").map(Number);
  return [hours!, minutes!];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

class ZoneClock {
  private readonly format: Intl.DateTimeFormat;
  constructor(timeZone: string) {
    this.format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  }

  wallParts(instant: number) {
    const parts = this.format.formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return { year: get("year"), month: get("month"), day: get("day"), hours: get("hour"), minutes: get("minute"), seconds: get("second") };
  }

  private offset(instant: number): number {
    const p = this.wallParts(instant);
    return Date.UTC(p.year, p.month - 1, p.day, p.hours, p.minutes, p.seconds) - Math.floor(instant / 1000) * 1000;
  }

  /** The instant of a wall-clock time; day overflow rolls into the next month as Date.UTC does. */
  instant(year: number, month: number, day: number, hours: number, minutes: number): number {
    const naive = Date.UTC(year, month - 1, day, hours, minutes, 0);
    // The offset exists only together with an instant, and the offset at the naive instant can still belong to the
    // other side of a DST change, so resolve the wall clock against the offset the first pass lands on. Only a wall
    // clock skipped by a DST change has no fixed point; keep the first pass, the instant the earlier offset implies.
    const firstPass = naive - this.offset(naive);
    const firstOffset = this.offset(firstPass);
    const secondPass = naive - firstOffset;
    return this.offset(secondPass) === firstOffset ? secondPass : firstPass;
  }
}
