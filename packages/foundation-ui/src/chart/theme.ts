import { shallowRef, watch, type Ref } from "vue";
import { useDarkMode } from "../theme";

/**
 * Category labels never overlap: ECharts hides the ones that would, and a label too wide for its slot is cut short with
 * an ellipsis rather than running into its neighbours. Long Chinese category names are the common case, so this is the
 * theme's default instead of something each chart's option restates.
 */
const CATEGORY_LABELS = { hideOverlap: true, width: 80, overflow: "truncate" } as const;

/**
 * The platform's ECharts theme, the one every chart of the platform is drawn in: the brand's colours for the light or
 * dark mode the page shows now, read from the brand stylesheet (DESIGN.md "Charts"). Series take the categorical
 * palette `--chart-N` and visual maps the sequential scale `--chart-sequential-N`; the chart's own surface, text, axes,
 * split lines and the tooltip's axis pointer take Element Plus's background, text and border colours. It is read when
 * called, so read it again when the page switches mode: `useChartTheme()` does that in a component.
 *
 * The theme paints the chart's background instead of leaving it transparent: the canvas keeps its own pixels, so a
 * transparent one shows the page's surface from before a theme switch and the dark text lands on it. Drawing
 * `--el-bg-color` keeps the chart on the surface its text colours were chosen against, in both modes and after a
 * switch of the platform's theme.
 */
export function chartTheme(): Record<string, unknown> {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  /** The values of `<prefix>1`, `<prefix>2`, … up to the first the brand does not set. */
  const numbered = (prefix: string) => {
    const values: string[] = [];
    let value = read(`${prefix}1`);
    while (value) {
      values.push(value);
      value = read(`${prefix}${values.length + 1}`);
    }
    return values;
  };
  const surface = read("--el-bg-color");
  const text = read("--el-text-color-primary");
  const muted = read("--el-text-color-secondary");
  const line = read("--el-border-color");
  const axis = (showLine: boolean, showSplit: boolean, category: boolean) => ({
    axisLine: { show: showLine, lineStyle: { color: line } },
    axisTick: { show: false },
    axisLabel: category ? { color: muted, ...CATEGORY_LABELS } : { color: muted },
    nameTextStyle: { color: muted },
    splitLine: { show: showSplit, lineStyle: { color: line } },
  });
  return {
    color: numbered("--chart-"),
    backgroundColor: surface,
    textStyle: { color: text },
    title: { textStyle: { color: text }, subtextStyle: { color: muted } },
    legend: { textStyle: { color: muted } },
    tooltip: { axisPointer: { lineStyle: { color: line }, crossStyle: { color: line } } },
    visualMap: { inRange: { color: numbered("--chart-sequential-") }, textStyle: { color: muted } },
    categoryAxis: axis(true, false, true),
    valueAxis: axis(false, true, false),
    timeAxis: axis(true, false, false),
    logAxis: axis(false, true, false),
  };
}

/** The platform's chart theme in a component: read again whenever the page switches between light and dark. */
export function useChartTheme(): Readonly<Ref<Record<string, unknown>>> {
  const theme = shallowRef(chartTheme());
  watch(useDarkMode(), () => {
    theme.value = chartTheme();
  });
  return theme;
}
