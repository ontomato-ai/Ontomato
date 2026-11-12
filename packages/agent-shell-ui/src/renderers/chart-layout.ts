import { chartAxisBounds } from "@ontomato/contracts/chart-presentation";

type Option = Record<string, any>;

/**
 * Titles and legends get separate bands; scrolling keeps long legends in their own band. A narrow column cuts a long
 * title short and hides category labels that would overlap. Axis bounds follow the shared rule.
 */
export function chartReadingLayout(source: Option, height = 320, presentation: "inline" | "panel" = "panel", width?: number): Option {
  const option = structuredClone(source);
  // The card header names the chart and the tooltip names each category, so neither is lost on screen.
  const each = (value: Option | Option[], change: (item: Option) => Option) => Array.isArray(value) ? value.map(change) : change(value);
  // Forcing every label (interval 0) stops ECharts from spacing them out; where they fit, they all still show.
  const hideOverlapping = (label: Option | undefined) => label?.hideOverlap === false ? label
    : { ...label, hideOverlap: true, ...(label?.interval === 0 ? { interval: "auto" } : {}) };
  if (width && option.title) {
    const fit = (style: Option | undefined) => ({ ...style, width: width - 24, overflow: style?.overflow ?? "truncate" });
    option.title = each(option.title, (title) => ({ ...title, textStyle: fit(title.textStyle), subtextStyle: fit(title.subtextStyle) }));
  }
  for (const key of ["xAxis", "yAxis"]) if (option[key]) option[key] = each(option[key], (axis) =>
    axis.type === "category" || (axis.type == null && Array.isArray(axis.data))
      ? { ...axis, axisLabel: hideOverlapping(axis.axisLabel) }
      : axis);
  const series = [option.series ?? []].flat();
  const pies = series.filter((item) => item.type === "pie");
  const singleInlinePie = presentation === "inline" && pies.length === 1;
  // A single inline pie uses the whole reading column; multiple pies retain their comparison layout.
  if (singleInlinePie) {
    option.series = series.map((item) => item.type === "pie" ? {
      ...item, left: 0, right: 0, width: undefined,
      center: ["50%", Array.isArray(item.center) ? item.center[1] ?? "50%" : "50%"],
    } : item);
  }
  const titles = [option.title].flat().filter(Boolean);
  if (!option.legend) return chartAxisBounds(option, height);
  const hasTitle = titles.some((title) => title.show !== false && (title.text || title.subtext));
  const pixels = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.endsWith("%") ? parseFloat(value) * height / 100 : Number(value) || 0;
  const legends = [option.legend].flat();
  let reservedBottom = 0;
  option.legend = legends.map((legend) => {
    if (legend.show === false || (legend.orient === "vertical" && !singleInlinePie)) return legend;
    if (legend.bottom == null && legend.top !== "bottom" && !hasTitle && !singleInlinePie) return legend;
    const bottom = pixels(legend.bottom);
    const fontSize = pixels(legend.textStyle?.fontSize) || 12;
    const band = Math.max(40, fontSize * 2 + 20);
    reservedBottom = Math.max(reservedBottom, bottom + band + 12);
    // Let ECharts size the content before centering; a 90% box left-aligns short legend contents.
    return { ...legend, type: "scroll", orient: "horizontal", top: null, bottom, left: "center", right: null, width: "auto", height: band, align: "auto" };
  });
  if (reservedBottom) {
    if (option.grid || option.xAxis || option.yAxis) option.grid = [option.grid ?? {}].flat().map((grid) => ({
      ...grid, outerBoundsMode: "same", outerBoundsContain: "all",
      bottom: Math.max(pixels(grid.bottom), reservedBottom),
    }));
    if (option.series) option.series = [option.series].flat().map((series) => {
      if (!["pie", "funnel", "gauge"].includes(series.type)) return series;
      return { ...series, top: Math.max(pixels(series.top), hasTitle ? 48 : 12), bottom: Math.max(pixels(series.bottom), reservedBottom),
        center: series.type === "pie" || series.type === "gauge" ? [series.center?.[0] ?? "50%", "50%"] : series.center };
    });
  }
  return chartAxisBounds(option, height);
}
