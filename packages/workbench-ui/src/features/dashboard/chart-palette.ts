import { mix, rgbTriplet, type BrandMode, type BrandSource } from "@ontomato/design-tokens";
import { workbenchBrand } from "../../brand";

/**
 * Dashboard and agent-chart colours of one mode, all derived from the edition's brand source (DESIGN.md "Charts and
 * the ontology graph"): series take `dataviz` in its fixed order, magnitude is one primary ramp, labels use the ink
 * roles and the rest uses the neutral roles. This is the only place charts get colours from.
 */
export interface ChartPalette {
  /** Categorical series colours, the brand's `dataviz` for this mode. */
  series: readonly string[];
  text: string;
  textSecondary: string;
  /** Axis lines and split lines. */
  line: string;
  /** Background of the chart: separators between marks (pie slices, tree-map tiles) use it. */
  surface: string;
  /** Tracks and inset wells (gauge track). */
  sunken: string;
  /** Magnitude ramp from near the surface to past primary (visual maps). */
  sequential: readonly string[];
  /** "r, g, b" of primary, for the soft shadows of emphasised marks. */
  primaryRgb: string;
}

export function chartPalette(brand: BrandSource, mode: BrandMode): ChartPalette {
  const c = brand[mode];
  return {
    series: brand.dataviz[mode],
    text: c.ink,
    textSecondary: c.muted,
    line: c.line,
    surface: c.surface,
    sunken: c.sunken,
    sequential: brand.datavizLabeled ? [brand.dataviz[mode][7], brand.dataviz[mode][0]] : [0.9, 0.7, 0.5, 0.25, 0].map((weight) => mix(c.primary, c.surface, weight)).concat(mix(c.primary, c.ink, 0.35)),
    primaryRgb: rgbTriplet(c.primary),
  };
}

/** The mode the workbench shows now (the theme toggles `dark` on the document element). */
export function currentMode(): BrandMode {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The palette of the installed brand in the current (or the given) mode. */
export function currentChartPalette(mode: BrandMode = currentMode()): ChartPalette {
  return chartPalette(workbenchBrand(), mode);
}

/** Bar fill: the series colour, lighter toward the chart surface at the top. */
export function barGradientStops(color: string, surface: string): [string, string] {
  return [mix(color, surface, 0.3), color];
}

/** Area fill under a line: the series colour fading out. */
export function areaGradientStops(color: string): [string, string, string] {
  const rgb = rgbTriplet(color);
  return [`rgba(${rgb}, 0.4)`, `rgba(${rgb}, 0.1)`, `rgba(${rgb}, 0.02)`];
}
