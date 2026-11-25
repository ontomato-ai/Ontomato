import type { DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import type { ObjectListRef } from "./object-list-types";

/** One scalar metric or thumbnail chart entry rendered by `DashboardMetricPreview`. */
export interface DashboardMetricPreviewCard {
  readonly id: string;
  readonly name: string;
  readonly kind: "metric" | "chart";
  readonly value?: string | number | null;
  readonly unit?: string;
  readonly file?: unknown;
  readonly output?: DashboardMetricOutput | null;
  readonly error?: string;
  readonly partial?: boolean;
  readonly ref?: ObjectListRef;
  readonly row?: PlatformObjectRecord;
}
