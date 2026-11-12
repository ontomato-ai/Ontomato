import { chartAxisBounds } from "@ontomato/contracts/chart-presentation";

type Option = Record<string, any>;

/** Titles and legends get separate bands; scrolling keeps long legends in their own band. Axis bounds follow the shared rule. */
export function chartReadingLayout(source: Option, height = 320, presentation: "inline" | "panel" = "panel"): Option {
  const option = structuredClone(source);
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
