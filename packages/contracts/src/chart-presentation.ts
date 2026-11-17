import type { ChartFormat } from "./chart-data/display";
import type { ChartBinding } from "./chart-data/schema";

type Option = Record<string, any>;

/**
 * A copy that keeps every value's type. The rules below never change a caller's option: copying a function-bearing
 * option as data would drop the callbacks the previous rule attached.
 */
function copy<Value>(value: Value): Value {
  if (Array.isArray(value)) return value.map(copy) as Value;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) as Value;
  return value;
}

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

/**
 * A grid that contains its labels also contains its axis names, a titled chart starts its grid below the title,
 * and long category labels are cut short so that containing them cannot squeeze the plot away.
 */
export function chartAxisBounds(source: Option, height: number): Option {
  if (!source.xAxis && !source.yAxis) return source;
  // A rotated x label of this width takes at most about a fifth of the chart's height.
  const capped = (axes: Option | Option[], width: number) => {
    const list = [axes].flat().map((axis: Option) => axis && (axis.type === "category" || (axis.type == null && Array.isArray(axis.data))) && axis.axisLabel?.width == null
      ? { ...axis, axisLabel: { ...axis.axisLabel, width, overflow: axis.axisLabel?.overflow ?? "truncate" } }
      : axis);
    return Array.isArray(axes) ? list : list[0];
  };
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
  return {
    ...source,
    grid: Array.isArray(source.grid) ? grids : grids[0],
    ...(source.xAxis ? { xAxis: capped(source.xAxis, Math.max(72, Math.round(height * 0.3))) } : {}),
    ...(source.yAxis ? { yAxis: capped(source.yAxis, 200) } : {}),
  };
}

/**
 * Titles and legends get separate bands; scrolling keeps long legends in their own band. A narrow column cuts a long
 * title short and hides category labels that would overlap. Axis bounds follow the shared rule.
 */
export function chartReadingLayout(source: Option, height = 320, presentation: "inline" | "panel" = "panel", width?: number): Option {
  const option = copy(source);
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

/** A value without a format is shown as it came; a missing value is a dash. */
export const chartMissingValue = "—";

/**
 * One value as its display format writes it. A number keeps its value and takes the format's kind and decimals; a
 * percentage states its scale, so `100` reads 0.25 as 25% and `1` reads 25 as 25%.
 */
export function chartValueText(value: unknown, format?: ChartFormat, locale?: string): string {
  if (value === null || value === undefined) return chartMissingValue;
  if (!format || format.kind === "text") return typeof value === "object" ? JSON.stringify(value) : String(value);
  if (format.kind === "date") {
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(locale);
  }
  const number = Number(value);
  if (typeof value === "boolean" || typeof value === "object" || !Number.isFinite(number)) return String(value);
  const digits = format.decimals === undefined ? {} : { minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals };
  if (format.kind === "percent") return `${(format.scale === 100 ? number * 100 : number).toLocaleString(locale, digits)}%`;
  if (format.kind === "currency" && format.currency) return number.toLocaleString(locale, { style: "currency", currency: format.currency, ...digits });
  return number.toLocaleString(locale, digits);
}

/**
 * Ticks are axis positions, not metric values: they keep the format's kind and scale but not its fixed decimals,
 * so a 0.5 tick under a whole-number format reads 0.5 rather than a second "1".
 */
export function chartTickFormat(format: ChartFormat): ChartFormat {
  const { decimals: _, ...rest } = format;
  return rest;
}

const undatedText = "Undated";

/**
 * A timeline event's label: its date, its name over at most two lines and its description. An event the metric gives
 * no readable date for says so in the reader's language instead of a blank line.
 */
export function chartTimelineLabel(event: { date?: unknown; name?: unknown; description?: unknown }, undated = undatedText): string[] {
  const time = event.date === null || event.date === undefined || event.date === "" ? NaN : Date.parse(String(event.date));
  const date = Number.isFinite(time) ? String(event.date).slice(0, 10) : undated;
  const name = String(event.name ?? "");
  const lines = [name.slice(0, 24), name.slice(24, 48)].filter(Boolean);
  const description = String(event.description ?? "");
  return [date, ...lines, description].filter((line) => line !== "");
}

/**
 * The standard behaviour of a graph: dragging nodes and highlighting a node's neighbours belong to the platform, so a
 * file written by any author gets them without stating them.
 */
export function chartGraphBehaviour(source: Option): Option {
  const option = copy(source);
  if (!option.series) return option;
  const adjust = (series: Option) => series.type === "graph"
    ? { ...series, draggable: true, emphasis: { ...series.emphasis, focus: "adjacency" } }
    : series;
  option.series = Array.isArray(option.series) ? option.series.map(adjust) : adjust(option.series);
  return option;
}

/** A single (gauge) centre reads the value the metric gave, formatted; the ring itself only shows a ratio. */
export function chartSingleText(raw: unknown, format?: ChartFormat, locale?: string): string {
  return chartValueText(raw, format, locale);
}

type Formats = Record<string, ChartFormat> | undefined;

/** The first column a series encodes to one role. */
function encodedColumn(series: Option, role: string): string | undefined {
  const value = series.encode?.[role];
  return [value].flat().find((column): column is string => typeof column === "string");
}

/** The column a series encodes to a role after the one its value takes, such as an item's share. */
function secondColumn(series: Option, role: string): string | undefined {
  const columns = [series.encode?.[role]].flat().filter((column): column is string => typeof column === "string");
  return columns[1];
}

/** A column's format, when the metric's display settings state one. */
const formatOf = (formats: Formats, column: string | undefined) => column ? formats?.[column] : undefined;

/**
 * An item is a name and its value, and a metric may also give its share; both read their own formats. A tooltip breaks
 * its lines as HTML, a series label as text.
 */
function itemText(name: string, value: unknown, share: unknown, formats: Formats, valueColumn?: string, shareColumn?: string, locale?: string) {
  const text = [chartValueText(value, formatOf(formats, valueColumn), locale)];
  if (share !== undefined && shareColumn) text.push(chartValueText(share, formatOf(formats, shareColumn), locale));
  return { name, text: text.join(" · ") };
}

const itemSeries = new Set(["pie", "funnel", "treemap", "sunburst", "graph"]);
const measureSeries = new Set(["line", "bar", "scatter", "effectScatter", "pictorialBar", "radar", "themeRiver", "boxplot", "sankey"]);

/**
 * The fixed formats of `display.formats` on every place a value shows: axis labels, tooltips and series labels. Values
 * stay as they came; only their written form changes. A gauge's centre reads the metric's own value rather than the
 * ring's ratio, and a timeline's labels carry its date, name and description.
 */
export function chartFormats(source: Option, presentation: { bindings: ChartBinding[]; display: { formats?: Formats } }, undated?: string, locale?: string): Option {
  const option = copy(source);
  const formats = presentation.display.formats;
  if (!formats) return option;
  const bindings = new Map(presentation.bindings.map((binding) => [binding.seriesId, binding]));
  const series: Option[] = [option.series ?? []].flat();
  const fields = (binding: ChartBinding) => binding.fields as Record<string, string>;
  for (const target of series) {
    const binding = bindings.get(String(target.id));
    if (binding?.shape === "single") {
      const format = formatOf(formats, fields(binding).value);
      if (format) {
        // A gauge's detail formatter receives its value, not the data item; the metric's raw value travels on the item.
        const item = [target.data ?? []].flat()[0] as { rawValue?: unknown } | undefined;
        target.detail = { ...target.detail, formatter: () => chartSingleText(item?.rawValue, format, locale) };
      }
      continue;
    }
    if (binding?.shape === "timeline") {
      target.label = { ...target.label, formatter: (params: { data: { date?: unknown; name?: unknown; description?: unknown } }) => chartTimelineLabel(params.data, undated).join("\n") };
      continue;
    }
    if (binding?.shape === "boxplot") {
      const stats = fields(binding);
      const roles = ["min", "q1", "median", "q3", "max"];
      option.tooltip = { ...option.tooltip, trigger: "item", formatter: (params: { name: string; value: unknown[] }) =>
        [params.name, ...params.value.map((value, index) => chartValueText(value, formatOf(formats, stats[roles[index]!]), locale))] .join("<br/>") };
      continue;
    }
    if (binding?.shape === "items" || binding?.shape === "tree" || binding?.shape === "radar") {
      const shown = fields(binding);
      const work = (params: { name: string; value: unknown; data?: { share?: unknown } }) => itemText(params.name, params.value, params.data?.share, formats, shown.value, shown.share, locale);
      target.label = { ...target.label, formatter: (params: Parameters<typeof work>[0]) => { const item = work(params); return [item.name, item.text].join("\n"); } };
      target.tooltip = { ...target.tooltip, formatter: (params: Parameters<typeof work>[0]) => { const item = work(params); return [item.name, item.text].join("<br/>"); } };
      continue;
    }
    // An item series names its own value column; its tooltip and label write that value in its format.
    const valueColumn = encodedColumn(target, "value");
    const format = formatOf(formats, valueColumn);
    if (!format) continue;
    const work = (params: { name: string; value: unknown; data?: { share?: unknown } }) => itemText(params.name, params.value, params.data?.share, formats, valueColumn, secondColumn(target, "tooltip"), locale);
    if (itemSeries.has(target.type) || target.label?.show) target.label = { ...target.label, formatter: (params: Parameters<typeof work>[0]) => { const item = work(params); return [item.name, item.text].join("\n"); } };
    target.tooltip = { ...target.tooltip, formatter: (params: Parameters<typeof work>[0]) => { const item = work(params); return [item.name, item.text].join("<br/>"); } };
  }
  // A measure series shows one column; its labels write that column's value in the format the metric states.
  for (const target of series) {
    if (bindings.has(String(target.id)) || !measureSeries.has(target.type)) continue;
    const column = encodedColumn(target, "y");
    const format = formatOf(formats, column);
    if (!format) continue;
    target.tooltip = { ...target.tooltip, valueFormatter: (value: unknown) => chartValueText(value, format, locale) };
    if (target.label?.show) target.label = { ...target.label, formatter: (params: { value: unknown }) => chartValueText(params.value, format, locale) };
  }
  // Each axis writes the column its series encode to it; tick positions keep the kind but not the fixed decimals.
  for (const [key, role] of [["xAxis", "x"], ["yAxis", "y"]] as const) {
    if (!option[key]) continue;
    const axes: Option[] = [option[key]].flat();
    const formatted = axes.map((axis, index) => {
      const shown = series.find((item) => !bindings.has(String(item.id)) && (item[`${role}AxisIndex`] ?? 0) === index && encodedColumn(item, role));
      const format = formatOf(formats, shown && encodedColumn(shown, role));
      if (!format) return axis;
      const written = axis.type === "category" ? format : chartTickFormat(format);
      return { ...axis, axisLabel: { ...axis.axisLabel, formatter: (tick: unknown) => chartValueText(tick, written, locale) } };
    });
    option[key] = Array.isArray(option[key]) ? formatted : formatted[0];
  }
  return option;
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
