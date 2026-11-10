import { mix, rgbTriplet, type BrandMode, type BrandSource } from "@ontomato/design-tokens";
import { workbenchBrand } from "../../brand";

/**
 * The colours the dashboard generator writes into its options in one mode, all derived from the edition's brand
 * source (DESIGN.md "Charts and the ontology graph"): series take `dataviz` in its fixed order, labels use the ink
 * roles and the rest uses the neutral roles. The charts are drawn in the platform's chart theme
 * (`@ontomato/foundation-ui/chart`), which reads the same brand from its stylesheet.
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
    primaryRgb: rgbTriplet(c.primary),
  };
}

/** The mode the workbench shows now (the theme toggles `dark` on the document element). */
export function currentMode(): BrandMode {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The palette of the installed brand in the mode the workbench shows now. */
export function currentChartPalette(): ChartPalette {
  return chartPalette(workbenchBrand(), currentMode());
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
