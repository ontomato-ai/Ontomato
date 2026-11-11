import type {
  DashboardCardData,
  DashboardRow,
  MetricReferenceChartEntry,
  MetricReferenceEntry,
  MetricReferenceMetricEntry,
} from "@ontomato/contracts/dashboard";
import type { TableData } from "@ontomato/foundation-ui/preview";
import { ApiRequestError } from "../../../../utils/api";
import {
  axisCategoryBase,
  axisValueBase,
  baseOption,
  chartColors,
  createAreaGradient,
  createBarGradient,
  deepSanitize,
  getThemeColor,
  mergeDeep,
  truncateLabel,
} from "./echartsGenerator";

/*
 * A metric-reference card only presents the metric's final rows: it sorts and cuts them for display, formats values
 * and maps output keys to the chart's roles. Every business number, share and statistic comes from the metric.
 */

type Format = NonNullable<MetricReferenceEntry["formats"]>[string];
type Formats = MetricReferenceEntry["formats"];
type Value = DashboardRow[string];

/** Why a card could not show its metric: the server's code and its message, verbatim. */
export type CardError = { code: string | null; message: string };

/** The render state a metric-reference card carries beside its saved configuration. */
export type MetricCardState = {
  metric?: DashboardCardData["metric"];
  columns?: DashboardCardData["columns"];
  rows?: DashboardRow[];
  truncation?: DashboardCardData["truncation"];
  error?: CardError;
};

export function cardError(error: unknown): CardError {
  if (error instanceof ApiRequestError) return { code: error.code ?? null, message: error.message };
  return { code: null, message: error instanceof Error ? error.message : String(error) };
}

const HEADLINED = new Set([
  "CARD_OUTPUT_MISMATCH",
  "METRIC_UNAVAILABLE",
  "METRIC_SPEC_CHANGED",
  "METRIC_REQUERY_REQUIRED",
  "UNSUPPORTED_DATASET_RECIPE",
  "DASHBOARD_PLAN_INVALID",
  "INVALID_METRIC_RESPONSE",
  "INVALID_CARD_DATA",
]);

/** What a known code means for the reader (e.g. ask the question again), shown above the server's own message. */
export function cardErrorHeadline(error: CardError, t: (key: string) => string): string | null {
  return error.code !== null && HEADLINED.has(error.code) ? t(`dashboard.cardErrors.${error.code}`) : null;
}


function compare(a: Value, b: Value): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** The rows the card draws: the card's sort over the final rows, then its display limit. Values are untouched. */
export function presentRows(rows: DashboardRow[], card: Pick<MetricReferenceEntry, "sort" | "displayLimit">) {
  const sorted = card.sort?.length
    ? rows.slice().sort((x, y) => {
        for (const { field, order } of card.sort!) {
          const a = x[field];
          const b = y[field];
          if (a === b) continue;
          // Missing values stay last in either order.
          if (a === null || a === undefined) return 1;
          if (b === null || b === undefined) return -1;
          const diff = compare(a, b);
          if (diff !== 0) return order === "asc" ? diff : -diff;
        }
        return 0;
      })
    : rows;
  return card.displayLimit === undefined ? sorted : sorted.slice(0, card.displayLimit);
}

function fractionDigits(format: Format) {
  return format.decimals === undefined
    ? {}
    : { minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals };
}

/** A value as the card's format writes it; without a format the value is shown as it came. A missing value is "—". */
export function formatValue(value: Value | undefined, format?: Format): string {
  if (value === null || value === undefined) return "—";
  if (!format || format.kind === "text") return typeof value === "object" ? JSON.stringify(value) : String(value);
  if (format.kind === "date") {
    const date = new Date(value as string | number);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
  }
  const n = Number(value);
  if (typeof value === "boolean" || typeof value === "object" || !Number.isFinite(n)) return String(value);
  if (format.kind === "percent") return `${(format.scale === 100 ? n * 100 : n).toLocaleString(undefined, fractionDigits(format))}%`;
  if (format.kind === "currency" && format.currency)
    return n.toLocaleString(undefined, { style: "currency", currency: format.currency, ...fractionDigits(format) });
  return n.toLocaleString(undefined, fractionDigits(format));
}

/** The card's data as a table: every row of this result, headed by the columns' labels, values in the card's formats. */
export function metricCardTable(columns: DashboardCardData["columns"], rows: DashboardRow[], formats: Formats): TableData {
  return {
    columns: columns.map((column) => column.label ?? column.key),
    rows: rows.map((row) => columns.map((column) => formatValue(row[column.key], formats?.[column.key]))),
  };
}

/** A number card's value: none for zero rows, otherwise the single row's value field (the server rejects more rows). */
export function metricCardValue(card: MetricReferenceMetricEntry, rows: DashboardRow[]) {
  return rows.length === 0 ? { empty: true as const } : { empty: false as const, text: formatValue(rows[0]![card.valueField], card.formats?.[card.valueField]) };
}

/* ======================== Chart options ======================== */

type Drawing = {
  card: MetricReferenceChartEntry;
  rows: DashboardRow[];
  labels: Map<string, string>;
};

function role(card: MetricReferenceChartEntry, name: string): string {
  return card.fields[name] as string;
}

function fmt(d: Drawing, key: string) {
  return (value: Value | undefined) => formatValue(value, d.card.formats?.[key]);
}

function label(d: Drawing, key: string) {
  return d.labels.get(key) ?? key;
}

function color(d: Drawing, index: number): string {
  const colors = d.card.style?.colors;
  return colors?.length ? colors[index % colors.length]! : getThemeColor(index);
}

function category(d: Drawing, key: string) {
  return d.rows.map((row) => fmt(d, key)(row[key]));
}

/** The tooltip line of an item: its name, its value and, when the metric gives one, its share. */
function itemTooltip(d: Drawing, valueKey: string, shareKey: string | undefined) {
  return (p: { name: string; data: { value: Value; share?: Value } }) => {
    const lines = [p.name, `${label(d, valueKey)}: ${fmt(d, valueKey)(p.data.value)}`];
    if (shareKey) lines.push(`${label(d, shareKey)}: ${fmt(d, shareKey)(p.data.share)}`);
    return lines.join("<br/>");
  };
}

/**
 * Ticks are axis positions, not metric values: they keep the format's kind and scale but not its fixed decimals,
 * so a 0.5 tick under a whole-number format reads 0.5 instead of a second "1".
 */
function valueAxis(d: Drawing, key: string) {
  const format = d.card.formats?.[key];
  const tickFormat = format && (({ decimals: _, ...rest }) => rest)(format);
  return mergeDeep(axisValueBase(), { axisLabel: { formatter: (v: number) => formatValue(v, tickFormat) } });
}

function axisChart(d: Drawing, kind: "bar" | "line" | "area-line") {
  const x = role(d.card, "xAxis");
  const y = role(d.card, "yAxis");
  const xData = category(d, x);
  const c = color(d, 0);
  const series =
    kind === "bar"
      ? {
          type: "bar",
          barMaxWidth: 48,
          label: { show: xData.length <= 12, position: "top", formatter: (p: { value: Value }) => fmt(d, y)(p.value) },
          itemStyle: { color: createBarGradient(c), borderRadius: [8, 8, 0, 0] },
        }
      : {
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 8,
          showSymbol: xData.length <= 24,
          lineStyle: { width: 2.5, color: c },
          itemStyle: { color: c, borderColor: chartColors().surface, borderWidth: 2 },
          ...(kind === "area-line" ? { areaStyle: { color: createAreaGradient(c) } } : {}),
        };
  return {
    tooltip: { trigger: "axis", valueFormatter: fmt(d, y) },
    xAxis: mergeDeep(axisCategoryBase(), { data: xData, ...(kind === "bar" ? {} : { boundaryGap: false }) }),
    yAxis: valueAxis(d, y),
    series: [{ ...series, name: label(d, y), emphasis: { focus: "series" }, data: d.rows.map((row) => row[y]) }],
  };
}

function barLine(d: Drawing) {
  const x = role(d.card, "xAxis");
  const bars = d.card.fields.barSeries as string[];
  const line = role(d.card, "lineSeries");
  const lineColor = color(d, bars.length);
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    legend: { show: true, top: 0, type: "scroll" },
    grid: { left: 20, right: 20, top: 36, bottom: 20, containLabel: true },
    xAxis: mergeDeep(axisCategoryBase(), { data: category(d, x) }),
    yAxis: [valueAxis(d, bars[0]!), valueAxis(d, line)],
    series: [
      ...bars.map((key, i) => ({
        type: "bar",
        name: label(d, key),
        yAxisIndex: 0,
        barMaxWidth: 32,
        tooltip: { valueFormatter: fmt(d, key) },
        itemStyle: { color: createBarGradient(color(d, i)), borderRadius: [6, 6, 0, 0] },
        data: d.rows.map((row) => row[key]),
      })),
      {
        type: "line",
        name: label(d, line),
        yAxisIndex: 1,
        smooth: true,
        tooltip: { valueFormatter: fmt(d, line) },
        lineStyle: { width: 2.5, color: lineColor },
        itemStyle: { color: lineColor, borderColor: chartColors().surface, borderWidth: 2 },
        data: d.rows.map((row) => row[line]),
      },
    ],
  };
}

/** Pie-like charts draw the rows' own values; a share shows only when the metric outputs one. */
function itemChart(d: Drawing, kind: "pie" | "nightingale-rose" | "funnel" | "treemap") {
  const name = role(d.card, "name");
  const value = role(d.card, "value");
  const share = d.card.fields.share as string | undefined;
  const data = d.rows.map((row, i) => ({
    name: fmt(d, name)(row[name]),
    value: row[value],
    ...(share ? { share: row[share] } : {}),
    itemStyle: { color: color(d, i) },
  }));
  const itemLabel = (p: { name: string; data: { value: Value } }) =>
    `${truncateLabel(p.name, 10)}  ${fmt(d, value)(p.data.value)}`;
  const series =
    kind === "funnel"
      ? { type: "funnel", sort: "none", left: "8%", top: 24, width: "84%", gap: 6, label: { show: true, position: "outside", formatter: itemLabel } }
      : kind === "treemap"
        ? { type: "treemap", breadcrumb: { show: false }, roam: false, nodeClick: false, label: { show: true, formatter: (p: { name: string }) => truncateLabel(p.name, 10) } }
        : {
            type: "pie",
            radius: kind === "pie" ? "60%" : ["35%", "60%"],
            ...(kind === "nightingale-rose" ? { roseType: "radius" } : {}),
            avoidLabelOverlap: true,
            itemStyle: { borderRadius: 10, borderColor: chartColors().surface, borderWidth: 3 },
            label: { show: true, color: chartColors().textSecondary, formatter: itemLabel },
          };
  return { tooltip: { trigger: "item", formatter: itemTooltip(d, value, share) }, series: [{ ...series, data }] };
}

function sankey(d: Drawing) {
  const source = role(d.card, "source");
  const target = role(d.card, "target");
  const value = role(d.card, "value");
  const names = [...new Set(d.rows.flatMap((row) => [String(row[source]), String(row[target])]))];
  return {
    tooltip: { trigger: "item", valueFormatter: fmt(d, value) },
    series: [
      {
        type: "sankey",
        nodeAlign: "justify",
        emphasis: { focus: "adjacency" },
        label: { formatter: (p: { name: string }) => truncateLabel(p.name, 12), color: chartColors().textSecondary },
        lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.6 },
        data: names.map((n, i) => ({ name: n, itemStyle: { color: color(d, i) } })),
        links: d.rows.map((row) => ({ source: String(row[source]), target: String(row[target]), value: row[value] })),
      },
    ],
  };
}

function scatter(d: Drawing) {
  const x = role(d.card, "xAxis");
  const y = role(d.card, "yAxis");
  const name = d.card.fields.name as string | undefined;
  const size = d.card.fields.size as string | undefined;
  // Point size is geometry: the size column's range spread over 6–40 px.
  const sizes = size ? d.rows.map((row) => Number(row[size])).filter(Number.isFinite) : [];
  const lo = Math.min(...sizes);
  const span = Math.max(...sizes) - lo;
  const px = (v: Value) => (span > 0 ? 6 + ((Number(v) - lo) / span) * 34 : 14);
  return {
    tooltip: {
      trigger: "item",
      formatter: (p: { data: { name?: string; value: Value[] } }) =>
        [p.data.name, `${label(d, x)}: ${fmt(d, x)(p.data.value[0])}`, `${label(d, y)}: ${fmt(d, y)(p.data.value[1])}`]
          .filter(Boolean)
          .join("<br/>"),
    },
    xAxis: valueAxis(d, x),
    yAxis: valueAxis(d, y),
    series: [
      {
        type: "scatter",
        itemStyle: { color: color(d, 0), borderColor: chartColors().surface, borderWidth: 2 },
        data: d.rows.map((row) => ({
          value: [row[x], row[y]],
          ...(name ? { name: fmt(d, name)(row[name]) } : {}),
          symbolSize: size ? px(row[size]) : 10,
        })),
      },
    ],
  };
}

function radar(d: Drawing) {
  const name = role(d.card, "name");
  const value = role(d.card, "value");
  const values = d.rows.map((row) => row[value]);
  // The radius is geometry: a little headroom above the largest value.
  const max = Math.max(...values.map(Number).filter(Number.isFinite)) * 1.15;
  const c = color(d, 0);
  return {
    tooltip: { trigger: "item", valueFormatter: fmt(d, value) },
    radar: {
      radius: "68%",
      indicator: d.rows.map((row) => ({ name: truncateLabel(fmt(d, name)(row[name]), 10), max })),
      axisName: { color: chartColors().textSecondary },
    },
    series: [
      {
        type: "radar",
        areaStyle: { color: createAreaGradient(c) },
        lineStyle: { width: 2.5, color: c },
        itemStyle: { color: c },
        data: [{ name: label(d, value), value: values }],
      },
    ],
  };
}

/** The metric's node rows arranged as a tree; each node shows its own value, nothing is summed here. */
function sunburst(d: Drawing) {
  const id = role(d.card, "id");
  const parent = role(d.card, "parent");
  const name = role(d.card, "name");
  const value = role(d.card, "value");
  const share = d.card.fields.share as string | undefined;
  type Node = { name: string; value: Value; share?: Value; children: Node[] };
  const nodes = new Map<string, Node>();
  for (const row of d.rows)
    nodes.set(String(row[id]), {
      name: fmt(d, name)(row[name]),
      value: row[value],
      ...(share ? { share: row[share] } : {}),
      children: [],
    });
  const roots: Node[] = [];
  for (const row of d.rows) {
    const node = nodes.get(String(row[id]))!;
    const up = row[parent] === null ? undefined : nodes.get(String(row[parent]));
    (up ? up.children : roots).push(node);
  }
  return {
    tooltip: { trigger: "item", formatter: itemTooltip(d, value, share) },
    series: [
      {
        type: "sunburst",
        nodeClick: false,
        sort: null,
        radius: ["10%", "88%"],
        emphasis: { focus: "ancestor" },
        itemStyle: { borderColor: chartColors().surface, borderWidth: 2 },
        label: { show: true, rotate: "tangential", overflow: "truncate", width: 72 },
        labelLayout: { hideOverlap: true },
        data: roots,
      },
    ],
  };
}

function boxplot(d: Drawing) {
  const cat = role(d.card, "category");
  const stats = ["min", "q1", "median", "q3", "max"].map((r) => role(d.card, r));
  return {
    tooltip: { trigger: "item" },
    xAxis: mergeDeep(axisCategoryBase(), { data: category(d, cat) }),
    yAxis: valueAxis(d, stats[2]!),
    series: [{ type: "boxplot", itemStyle: { color: chartColors().surface, borderColor: color(d, 0) }, data: d.rows.map((row) => stats.map((k) => row[k])) }],
  };
}

/**
 * A gauge (liquid fill draws the same ring: its ECharts extension is not installed) fills only for a percentage, whose
 * scale the card's format states; any other value is shown without a fill.
 */
function single(d: Drawing) {
  const key = role(d.card, "value");
  const raw = d.rows[0]![key];
  const format = d.card.formats?.[key];
  const ratio = format?.kind === "percent" && raw !== null ? Number(raw) / (format.scale === 100 ? 1 : 100) : null;
  const text = fmt(d, key)(raw);
  const c = color(d, 0);
  return {
    tooltip: { show: false },
    series: [
      {
        type: "gauge",
        startAngle: 90,
        endAngle: -270,
        radius: "75%",
        min: 0,
        max: 1,
        progress: { show: ratio !== null, roundCap: true, width: 18, itemStyle: { color: c } },
        axisLine: { roundCap: true, lineStyle: { width: 18, color: [[1, chartColors().sunken]] } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        pointer: { show: false },
        detail: { fontSize: 34, fontWeight: 700, color: chartColors().text, offsetCenter: [0, 0], formatter: () => text },
        data: [{ value: ratio ?? 0, name: d.card.name }],
      },
    ],
  };
}

const builders: Record<string, (d: Drawing) => object> = {
  bar: (d) => axisChart(d, "bar"),
  "pictorial-bar": (d) => axisChart(d, "bar"),
  line: (d) => axisChart(d, "line"),
  "area-line": (d) => axisChart(d, "area-line"),
  "bar-line": barLine,
  pie: (d) => itemChart(d, "pie"),
  "nightingale-rose": (d) => itemChart(d, "nightingale-rose"),
  funnel: (d) => itemChart(d, "funnel"),
  treemap: (d) => itemChart(d, "treemap"),
  sankey,
  scatter,
  radar,
  sunburst,
  boxplot,
  gauge: single,
  "liquid-fill": single,
};

/** The ECharts option of a chart card over its presented rows, naming series by the metric's column labels. */
export function metricChartOption(card: MetricReferenceChartEntry, data: Pick<DashboardCardData, "columns" | "rows">) {
  const drawing: Drawing = {
    card,
    rows: presentRows(data.rows, card),
    labels: new Map(data.columns.map((column) => [column.key, column.label ?? column.key])),
  };
  return deepSanitize(mergeDeep(baseOption(), builders[card.chartType]!(drawing)));
}

/* ======================== Card render state ======================== */

/** A metric-reference card as the dashboard draws it: its saved entry, its display name and this refresh's state. */
export type MetricCardView = MetricReferenceEntry &
  MetricCardState & { title?: string; option?: object; state?: "loading" | "ready" | "empty" | "error" };

function isChart(card: MetricReferenceEntry): card is MetricReferenceChartEntry {
  return "chartType" in card;
}

export function cardLoading(card: MetricCardView): MetricCardView {
  return isChart(card)
    ? { ...card, option: { __ragchatState: "loading" }, error: undefined }
    : { ...card, state: "loading", error: undefined };
}

/** This result replaces the last one; the configuration the server read this time updates the card. */
export function cardLoaded(card: MetricCardView, data: DashboardCardData): MetricCardView {
  const next: MetricCardView = {
    ...card,
    ...data.card,
    title: data.card.name,
    metric: data.metric,
    columns: data.columns,
    rows: data.rows,
    truncation: data.truncation,
    error: undefined,
  };
  if (!isChart(data.card)) return { ...next, state: data.rows.length ? "ready" : "empty" };
  return { ...next, option: data.rows.length ? metricChartOption(data.card, data) : { __ragchatState: "empty" } };
}

/** A failure clears what the last success showed, so no stale value stands beside the reason. */
export function cardFailed(card: MetricCardView, error: unknown): MetricCardView {
  const next: MetricCardView = { ...card, metric: undefined, columns: [], rows: [], truncation: undefined, error: cardError(error) };
  return isChart(card) ? { ...next, option: { __ragchatState: "error" } } : { ...next, state: "error" };
}

type Groups = { charts: unknown[]; metrics: unknown[] }[];

/** Replaces one card, chart or number, by id. */
export function patchCard<G extends Groups>(groups: G, cardId: string, update: (card: MetricCardView) => MetricCardView): G {
  const each = (cards: unknown[]) =>
    cards.map((card) => ((card as { id: string }).id === cardId ? update(card as MetricCardView) : card));
  return groups.map((group) => ({ ...group, charts: each(group.charts), metrics: each(group.metrics) })) as G;
}
