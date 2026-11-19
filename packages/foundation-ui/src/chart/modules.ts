import { use } from "echarts/core";
import { BarChart, LineChart, PieChart, ScatterChart } from "echarts/charts";
import {
  AxisPointerComponent, DatasetComponent, GridComponent, LegendComponent, TitleComponent, TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

/*
 * The parts of ECharts a chart needs before it is drawn. The charts the platform's chart files mostly draw — bars,
 * lines and areas, pies, donuts and roses, scatters sized by a value, timelines — need only the parts registered here:
 * those series on a grid with the platform's tooltip, legend, title and visual map, drawn on a canvas. An option that
 * needs anything else — a map, a treemap, a heatmap, a radar or a graph, a mark line, a zoom bar, a setting none of
 * these read — has the whole library loaded once before it is drawn, so every chart draws exactly as it did; only
 * what is downloaded and evaluated first differs.
 */

const SERIES = new Set(["bar", "line", "pie", "scatter"]);

/** A series setting another part of ECharts draws, which these series would otherwise silently ignore. */
const SERIES_PARTS = ["markLine", "markPoint", "markArea", "labelLayout", "universalTransition"];

/** The option's own top-level settings the registered parts draw, and the settings that need no part at all. */
const SETTINGS = new Set([
  "series", "dataset", "xAxis", "yAxis", "grid", "tooltip", "axisPointer", "legend", "title", "visualMap",
  "color", "backgroundColor", "textStyle", "darkMode", "useUTC", "stateAnimation", "blendMode", "hoverLayerThreshold",
  "animation", "animationThreshold", "animationDuration", "animationEasing", "animationDelay",
  "animationDurationUpdate", "animationEasingUpdate", "animationDelayUpdate",
]);

let registered = false;
let whole: Promise<void> | undefined;

/** Whether the registered parts draw this option: every series one of theirs, every setting one they read. */
function drawnByParts(option: Readonly<Record<string, unknown>>): boolean {
  return Object.keys(option).every((key) => SETTINGS.has(key))
    && [option.series ?? []].flat().every((series) => {
      const drawn = series as Record<string, unknown>;
      return SERIES.has(String(drawn.type)) && SERIES_PARTS.every((key) => !Object.hasOwn(drawn, key));
    });
}

/**
 * Makes the parts an option needs available before it is drawn: the common parts at once, and the whole library — once
 * per page — when the option needs more. Null when nothing is left to load.
 */
export function prepareChart(option: Readonly<Record<string, unknown>>): Promise<void> | null {
  if (!registered) {
    use([
      BarChart, LineChart, PieChart, ScatterChart,
      GridComponent, TooltipComponent, AxisPointerComponent, LegendComponent, TitleComponent, DatasetComponent,
      VisualMapComponent, CanvasRenderer,
    ]);
    registered = true;
  }
  if (drawnByParts(option)) return null;
  // The whole library registers every part with the same ECharts the chart is drawn by.
  whole ??= import("echarts").then(() => undefined);
  return whole;
}
