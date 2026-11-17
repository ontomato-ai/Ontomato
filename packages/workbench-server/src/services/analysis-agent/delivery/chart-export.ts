import type { ChartFailure } from "@ontomato/contracts/chart-data";
import { fillChartPresentation } from "@ontomato/contracts/chart-presentation";

type Option = Record<string, any>;

export type ExportChart =
  | { ok: true; option: Option }
  | { ok: false; reason: string };

/** A chart file's own snapshot is the metric output the conversation preview draws. */
function snapshot(file: unknown): { columns: { key: string }[]; rows: any[] } {
  const dataset = (file as { dataset?: { dimensions?: string[]; source?: any[] }[] } | null)?.dataset?.[0];
  return { columns: (dataset?.dimensions ?? []).map((key) => ({ key })), rows: dataset?.source ?? [] };
}

/** The reason a boundary check or filling gave, written into the export instead of a blank chart. */
export function chartFailureReason(failure: ChartFailure): string {
  const missing = failure.missingColumns.length ? ` (${failure.missingColumns.join(", ")})` : "";
  const issues = failure.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  return `${failure.code}${missing}${issues ? `: ${issues}` : ""}`;
}

/** The map resources an option draws, used to register the platform's bundled boundaries. */
export function chartMapNames(option: Option): string[] {
  const names = new Set<string>();
  for (const geo of [option.geo ?? []].flat()) if (geo && typeof geo.map === "string") names.add(geo.map);
  for (const series of [option.series ?? []].flat()) if (series && typeof series.map === "string") names.add(series.map);
  return [...names];
}

/**
 * The platform's chart rules for one export: fill the file from its own snapshot, then brand, graph behaviour,
 * reading layout and fixed formats. The caller hands the resulting option to ECharts.
 */
export function exportChartOption(
  file: unknown,
  options: { theme: Record<string, unknown>; height: number; width?: number; presentation?: "inline" | "panel"; locale?: string },
): ExportChart {
  const filled = fillChartPresentation(file, snapshot(file), options.theme, {
    height: options.height, presentation: options.presentation, width: options.width, locale: options.locale,
  });
  if (!filled.ok) return { ok: false, reason: chartFailureReason(filled) };
  return { ok: true, option: filled.option };
}
