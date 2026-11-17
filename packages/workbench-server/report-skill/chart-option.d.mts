import type { ChartFailure } from "@ontomato/contracts/chart-data";

export type ReportedChart =
  | { ok: true; option: Record<string, any> }
  | { ok: false; reason: string };

export function chartFailureReason(failure: ChartFailure): string;
export function chartMapNames(option: Record<string, any>): string[];
export function reportChartOption(file: unknown, theme: Record<string, unknown>, locale?: string): ReportedChart;
