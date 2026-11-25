import type { PlatformObjectRecord } from "../panel/platform-objects";
import type { ObjectListRef } from "./object-list-types";

/** One scheduled task summary row displayed by `ScheduledTaskSummaryList`. */
export interface ScheduledTaskSummaryItem {
  readonly id: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly activeRunId?: string | null;
  readonly pauseMessage?: string | null;
  readonly lastRunStatus?: "running" | "completed" | "failed" | "skipped" | string | null;
  readonly lastRunFinishedAt?: string | null;
  readonly lastRunErrorMessage?: string | null;
  readonly lastRunSummary?: string | null;
  readonly nextRunAt?: string | null;
  readonly ref?: ObjectListRef;
  readonly row?: PlatformObjectRecord;
}

/** One scheduled task recent-run detail payload rendered by `ScheduledTaskRunDetail`. */
export interface ScheduledTaskRunView {
  readonly status: "running" | "completed" | "failed" | "skipped" | string;
  readonly trigger?: "manual" | "schedule" | string | null;
  readonly startedAt?: string | null;
  readonly finishedAt?: string | null;
  readonly timeZone?: string | null;
  readonly pauseMessage?: string | null;
  readonly errorMessage?: string | null;
  readonly result?: string | null;
  readonly resultSummary?: string | null;
}
