import type { BrandMode } from "@ontomato/design-tokens";
import { currentChartPalette, currentMode } from "../../chart-palette";

/**
 * The native ECharts theme of dashboards and agent chart files, from the installed brand's chart palette, so charts
 * follow the brand and the light and dark modes. Options written by the generator add their own per-mark colours from
 * the same palette.
 */
export function nativeEchartsTheme(isDark: boolean) {
  const mode: BrandMode = isDark ? "dark" : "light";
  const palette = currentChartPalette(mode);
  const axis = (showLine: boolean, showSplit: boolean) => ({
    axisLine: { show: showLine, lineStyle: { color: palette.line } },
    axisTick: { show: false },
    axisLabel: { color: palette.textSecondary },
    nameTextStyle: { color: palette.textSecondary },
    splitLine: { show: showSplit, lineStyle: { color: palette.line } },
  });
  return {
    color: [...palette.series],
    backgroundColor: "transparent",
    textStyle: { color: palette.text },
    title: { textStyle: { color: palette.text }, subtextStyle: { color: palette.textSecondary } },
    legend: { textStyle: { color: palette.textSecondary } },
    tooltip: { axisPointer: { lineStyle: { color: palette.line }, crossStyle: { color: palette.line } } },
    visualMap: { inRange: { color: [...palette.sequential] }, textStyle: { color: palette.textSecondary } },
    categoryAxis: axis(true, false),
    valueAxis: axis(false, true),
    timeAxis: axis(true, false),
    logAxis: axis(false, true),
  };
}

/** The dashboard theme registered with ECharts for the mode shown now. */
export function getEchartsTheme() {
  return nativeEchartsTheme(currentMode() === "dark");
}
