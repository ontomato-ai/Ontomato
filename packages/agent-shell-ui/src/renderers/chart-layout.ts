type Option = Record<string, any>;

/** Titles and legends get separate bands; scrolling keeps long legends in their own band. */
export function chartReadingLayout(source: Option, height = 320): Option {
  const option = structuredClone(source);
  const titles = [option.title].flat().filter(Boolean);
  if (!option.legend) return option;
  const hasTitle = titles.some((title) => title.show !== false && (title.text || title.subtext));
  const pixels = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.endsWith("%") ? parseFloat(value) * height / 100 : Number(value) || 0;
  const legends = [option.legend].flat();
  let reservedBottom = 0;
  option.legend = legends.map((legend) => {
    if (legend.show === false || legend.orient === "vertical") return legend;
    if (legend.bottom == null && legend.top !== "bottom" && !hasTitle) return legend;
    const bottom = pixels(legend.bottom);
    const fontSize = pixels(legend.textStyle?.fontSize) || 12;
    const band = Math.max(40, fontSize * 2 + 20);
    reservedBottom = Math.max(reservedBottom, bottom + band + 12);
    return { ...legend, type: "scroll", orient: "horizontal", top: undefined, bottom, left: "center", right: undefined, width: "90%", height: band };
  });
  if (reservedBottom) {
    if (option.grid || option.xAxis || option.yAxis) option.grid = [option.grid ?? {}].flat().map((grid) => ({
      ...grid, containLabel: true,
      bottom: Math.max(pixels(grid.bottom), reservedBottom),
    }));
    if (option.series) option.series = [option.series].flat().map((series) => {
      if (!["pie", "funnel", "gauge"].includes(series.type)) return series;
      return { ...series, top: Math.max(pixels(series.top), hasTitle ? 48 : 12), bottom: Math.max(pixels(series.bottom), reservedBottom),
        center: series.type === "pie" || series.type === "gauge" ? [series.center?.[0] ?? "50%", "50%"] : series.center };
    });
  }
  return option;
}
