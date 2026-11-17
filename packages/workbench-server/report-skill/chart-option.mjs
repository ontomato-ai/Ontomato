import { fillChartFile } from "@ontomato/contracts/chart-data";
import { chartBrandColors, chartFormats, chartGraphBehaviour, chartReadingLayout } from "@ontomato/contracts/chart-presentation";

/** The reason a boundary check or filling gave, written onto the slide instead of a blank chart. */
export function chartFailureReason(failure) {
  const missing = failure.missingColumns.length ? ` (${failure.missingColumns.join(", ")})` : "";
  const issues = failure.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  return `${failure.code}${missing}${issues ? `: ${issues}` : ""}`;
}

/** The map resources an option draws, used to register the platform's bundled boundaries. */
export function chartMapNames(option) {
  const names = new Set();
  for (const geo of [option.geo ?? []].flat()) if (geo && typeof geo.map === "string") names.add(geo.map);
  for (const series of [option.series ?? []].flat()) if (series && typeof series.map === "string") names.add(series.map);
  return [...names];
}

/** The platform's chart rules for a report slide, filled from the chart file's own snapshot rows. */
export function reportChartOption(file, theme, locale) {
  const dataset = file?.dataset?.[0];
  const filled = fillChartFile(file, { columns: (dataset?.dimensions ?? []).map((key) => ({ key })), rows: dataset?.source ?? [] });
  if (!filled.ok) return { ok: false, reason: chartFailureReason(filled) };
  const option = chartReadingLayout(chartGraphBehaviour(chartBrandColors(filled.option, theme)), 560, "panel", 1440);
  return { ok: true, option: chartFormats(option, filled.presentation, undefined, locale) };
}
