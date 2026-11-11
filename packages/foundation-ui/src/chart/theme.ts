import { shallowRef, watch, type Ref } from "vue";
import { useDarkMode } from "../theme";

/**
 * Category labels never overlap: ECharts hides a label that would run into its neighbour, and it decides by the space
 * each label actually has, so a roomy chart keeps every name whole. The theme does not cap a label's width: a fixed
 * width would cut names that fit, such as a wide chart's "马克思主义学院".
 */
const CATEGORY_LABELS = { hideOverlap: true } as const;

/**
 * The platform's ECharts theme, the one every chart of the platform is drawn in: the brand's colours for the light or
 * dark mode the page shows now, read from the brand stylesheet (DESIGN.md "Charts"). Series take the categorical
 * palette `--chart-N` and visual maps the sequential scale `--chart-sequential-N`; text, axes, split lines and the
 * tooltip's axis pointer take Element Plus's text and border colours. It is read when called, so read it again when
 * the page switches mode: `useChartTheme()` does that in a component.
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
    backgroundColor: "transparent",
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
