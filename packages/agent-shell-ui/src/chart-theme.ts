/** A native ECharts theme object; hosts may supply their own brand theme. */
export type ChartTheme = (isDark: boolean) => Record<string, unknown>;

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Default chart theme from the host's CSS tokens, so charts follow light and dark themes. */
export const defaultChartTheme: ChartTheme = () => {
  const text = cssVar("--el-text-color-regular", "#415035");
  const muted = cssVar("--el-text-color-secondary", "#6f7d63");
  const line = cssVar("--el-border-color", "#e1ead9");
  const axis = (showLine: boolean, showSplit: boolean) => ({
    axisLine: { show: showLine, lineStyle: { color: line } },
    axisTick: { show: false },
    axisLabel: { color: muted },
    nameTextStyle: { color: muted },
    splitLine: { show: showSplit, lineStyle: { color: line } },
  });
  return {
    color: [
      cssVar("--el-color-primary", "#639c2d"),
      "#2fa98e",
      "#d9a441",
      "#5b8cd6",
      "#bc4b39",
      "#9b8cc4",
      "#c9864e",
      "#4fa3d1",
    ],
    backgroundColor: "transparent",
    textStyle: { color: text },
    title: { textStyle: { color: text }, subtextStyle: { color: muted } },
    legend: { textStyle: { color: muted } },
    categoryAxis: axis(true, false),
    valueAxis: axis(false, true),
    timeAxis: axis(true, false),
    logAxis: axis(false, true),
  };
};
