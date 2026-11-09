/** A native ECharts theme object; hosts may supply their own brand theme. */
export type ChartTheme = (isDark: boolean) => Record<string, unknown>;

/** The host's value of a CSS variable on the document; undefined when it is not set, so ECharts keeps its default. */
function cssVar(name: string): string | undefined {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || undefined;
}

/** The categorical palette the host's brand generates (`--chart-1` … `--chart-8`, DESIGN.md `dataviz`). */
export function chartPaletteFromCss(): string[] {
  return Array.from({ length: 8 }, (_, index) => cssVar(`--chart-${index + 1}`)).filter(
    (color): color is string => color !== undefined,
  );
}

/** Default chart theme from the host's CSS tokens, so charts follow the brand and the light and dark modes. */
export const defaultChartTheme: ChartTheme = () => {
  const text = cssVar("--el-text-color-primary");
  const muted = cssVar("--el-text-color-secondary");
  const line = cssVar("--el-border-color");
  const axis = (showLine: boolean, showSplit: boolean) => ({
    axisLine: { show: showLine, lineStyle: { color: line } },
    axisTick: { show: false },
    axisLabel: { color: muted },
    nameTextStyle: { color: muted },
    splitLine: { show: showSplit, lineStyle: { color: line } },
  });
  const palette = chartPaletteFromCss();
  return {
    ...(palette.length ? { color: palette } : {}),
    ...(palette.length ? { visualMap: { inRange: { color: [palette[7] ?? palette[0], palette[0]] } } } : {}),
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
