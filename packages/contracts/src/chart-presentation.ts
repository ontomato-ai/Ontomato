type Option = Record<string, any>;

/** Brand owns categorical and measure colours; explicit data marks and continuous scales remain data-owned. */
export function chartBrandColors(source: Option, theme: Record<string, unknown>): Option {
  const colors = theme.color;
  if (!Array.isArray(colors) || !colors.length) return source;
  const clone = (value: any): any => Array.isArray(value) ? value.map(clone) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
  const option = clone(source);
  if (Array.isArray(option.visualMap) && !option.visualMap.length) delete option.visualMap;
  const oldPalette = Array.isArray(option.color) ? option.color : [];
  const remap = (color: unknown, palette: unknown[], fallback = 0) => {
    const index = palette.indexOf(color);
    if (colors.includes(color)) return color;
    return colors[(index < 0 ? fallback : index) % colors.length];
  };
  option.color = [...colors];
  if (option.visualMap && theme.visualMap) {
    const ramp = (theme.visualMap as Option).inRange?.color;
    if (ramp) option.visualMap = [option.visualMap].flat().map((map: Option) => ({ ...map, inRange: { ...map.inRange, color: ramp } }));
  }
  if (option.series) {
    const recolor = (series: Option, index = 0) => {
      if (series.type === "candlestick") {
        series.itemStyle = { ...series.itemStyle, color: colors[2] ?? colors[0], color0: colors[4] ?? colors[0], borderColor: colors[2] ?? colors[0], borderColor0: colors[4] ?? colors[0] };
        return series;
      }
      if (series.type === "heatmap" || series.type === "map") return series;
      // Heatmaps, maps and custom graphics may encode magnitude or business states in their colours.
      if (series.type === "gauge") {
        series.progress = { ...series.progress, itemStyle: { ...series.progress?.itemStyle, color: colors[index % colors.length] } };
        series.pointer = { ...series.pointer, itemStyle: { ...series.pointer?.itemStyle, color: colors[index % colors.length] } };
        if (Array.isArray(series.axisLine?.lineStyle?.color)) series.axisLine.lineStyle.color = series.axisLine.lineStyle.color.map(([stop]: [number, unknown], band: number) => [stop, [colors[2], colors[3], colors[4]][Math.min(band, 2)] ?? colors[0]]);
        return series;
      }
      if (!["bar", "pictorialBar", "line", "pie", "scatter", "effectScatter", "radar", "funnel", "boxplot", "sankey", "tree", "treemap", "sunburst", "graph", "parallel", "themeRiver"].includes(series.type)) return series;
      const palette = Array.isArray(series.color) ? series.color : oldPalette;
      if (Array.isArray(series.color)) series.color = [...colors];
      const categorical = ["pie", "funnel", "treemap", "sunburst", "sankey", "tree", "graph"].includes(series.type);
      series.label = { ...series.label, color: (theme.textStyle as Option | undefined)?.color ?? series.label?.color };
      series.itemStyle = { ...series.itemStyle, borderWidth: 0 };
      // A series represents one measure, not one colour per row. Explicit data marks retain their meaning.
      if (!categorical && !option.visualMap) {
        series.colorBy = "series";
        series.itemStyle = { ...series.itemStyle, color: colors[index % colors.length] };
        if (series.type === "line" || series.type === "radar" || series.type === "parallel") {
          series.lineStyle = { ...series.lineStyle, color: colors[index % colors.length] };
        }
        if (series.areaStyle) series.areaStyle = { ...series.areaStyle, color: colors[index % colors.length], opacity: 0.12 };
      }
      if (categorical && series.itemStyle?.color) delete series.itemStyle.color;
      for (const state of [series, series.emphasis, series.select, series.blur]) {
        if (!state) continue;
        for (const style of [state.itemStyle, state.lineStyle, state.areaStyle]) {
          if (style && style.color && !option.visualMap) style.color = remap(style.color, palette, index);
        }
      }
      const recolorItems = (items: unknown) => {
        if (!Array.isArray(items)) return;
        for (const [itemIndex, item] of items.entries()) {
          if (!item || typeof item !== "object") continue;
          for (const state of [item, item.emphasis, item.select, item.blur]) {
            if (state?.itemStyle?.color && !option.visualMap) state.itemStyle.color = remap(state.itemStyle.color, palette, categorical ? itemIndex : index);
            for (const style of [state?.lineStyle, state?.areaStyle]) {
              if (style?.color && !option.visualMap) style.color = remap(style.color, palette, itemIndex);
            }
          }
          recolorItems(item.children);
        }
      };
      recolorItems(series.data);
      recolorItems(series.nodes);
      recolorItems(series.categories);
      return series;
    };
    option.series = Array.isArray(option.series) ? option.series.map(recolor) : recolor(option.series);
  }
  return option;
}

/** A grid that contains its labels also contains its axis names, and a titled chart starts its grid below the title. */
export function chartAxisBounds(source: Option, height: number): Option {
  if (!source.xAxis && !source.yAxis) return source;
  const titles = [source.title].flat().filter((title) => title && title.show !== false && (title.text || title.subtext));
  const titleBand = titles.some((title) => title.subtext) ? 64 : titles.length ? 48 : 0;
  const pixels = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && value.endsWith("%") ? parseFloat(value) * height / 100 : Number(value) || 0;
  const grids = [source.grid ?? {}].flat().map(({ containLabel, ...grid }) => ({
    ...grid,
    // ECharts 6 treats containLabel as "labels only", so a long axis name still leaves the canvas.
    ...(containLabel ? { outerBoundsMode: "same", outerBoundsContain: "all" } : {}),
    // An unset top keeps the ECharts default, which already clears a title.
    ...(titleBand && grid.top != null && pixels(grid.top) < titleBand ? { top: titleBand } : {}),
  }));
  return { ...source, grid: Array.isArray(source.grid) ? grids : grids[0] };
}

/** Runs inside an HTML artifact's sandbox; no access to the parent document or credentials. */
function installChartTheme(theme: Record<string, any>, apply: typeof chartBrandColors) {
  const browser = globalThis as any;
  const timer = setInterval(() => {
    const runtime = browser.echarts;
    if (!runtime?.getInstanceByDom) return;
    for (const element of Array.from(browser.document.querySelectorAll("[_echarts_instance_]"))) {
      const chart = runtime.getInstanceByDom(element);
      if (!chart || chart.__brandThemeApplied) continue;
      chart.__brandThemeApplied = true;
      const setOption = chart.setOption.bind(chart);
      const normalize = (option: Record<string, any>) => apply(option, theme);
      chart.setOption = (option: Record<string, any>, ...args: any[]) => setOption(normalize(option), ...args);
      const option = chart.getOption();
      chart.setOption({ ...option, backgroundColor: "transparent", textStyle: theme.textStyle }, { notMerge: true });
    }
  }, 100);
  browser.addEventListener("pagehide", () => clearInterval(timer), { once: true });
}

export function themedChartHtml(html: string, theme: Record<string, unknown>, properties: Record<string, string> = {}) {
  const json = (value: unknown) => JSON.stringify(value).replaceAll("<", "\\u003c");
  const script = `<script>Object.entries(${json(properties)}).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));(${installChartTheme.toString()})(${json(theme)},${chartBrandColors.toString()});</script>`;
  return /<head[\s>]/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => head + script) : script + html;
}
