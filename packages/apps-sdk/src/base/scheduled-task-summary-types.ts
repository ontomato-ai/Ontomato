import type { PlatformObjectRecord } from "../panel/platform-objects";
import type { ObjectListRef, ObjectListRowActionItem, ObjectListRowActions } from "./object-list-types";

export type ScheduledTaskPresentation = "summary" | "cards";

/** Card footer actions backed by a declared panel operation or a local page event. */
export interface ScheduledTaskCardActions {
  readonly maxVisible?: ObjectListRowActions["maxVisible"];
  readonly items: readonly Extract<ObjectListRowActionItem, { kind: "operation" | "local" }>[];
}

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
  readonly applicationId?: string | null;
  readonly applicationName?: string | null;
  readonly applicationType?: string | null;
  readonly applicationIcon?: string | null;
  readonly description?: string | null;
  readonly schedule?: string | null;
  readonly revision?: number | null;
  readonly stateLabel?: string | null;
  readonly lastRunStartedAt?: string | null;
  readonly ref?: ObjectListRef;
  readonly row?: PlatformObjectRecord;
}
