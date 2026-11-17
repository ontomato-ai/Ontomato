import type {
  DashboardCardData,
  DashboardRow,
  MetricReferenceChartEntry,
  MetricReferenceEntry,
  MetricReferenceMetricEntry,
} from "@ontomato/contracts/dashboard";
import { fillChartFile, type ChartDisplay, type FilledChart } from "@ontomato/contracts/chart-data";
import { chartValueText } from "@ontomato/contracts/chart-presentation";
import type { TableData } from "@ontomato/foundation-ui/preview";
import { ApiRequestError } from "../../../../utils/api";

/*
 * A metric-reference card only presents the metric's final rows: its chart file is filled from this refresh's output
 * and drawn by the platform's chart, and its values are written in the formats the file states. Every business number,
 * share and statistic comes from the metric; nothing here calculates one.
 */

type Format = NonNullable<ChartDisplay["formats"]>[string];

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
  "METRIC_REFERENCE_REQUIRED",
  "INVALID_CHART_FILE",
]);

/** What a known code means for the reader (e.g. ask the question again), shown above the server's own message. */
export function cardErrorHeadline(error: CardError, t: (key: string) => string): string | null {
  return error.code !== null && HEADLINED.has(error.code) ? t(`dashboard.cardErrors.${error.code}`) : null;
}

/** A value as the card's format writes it; without a format the value is shown as it came. */
export function formatValue(value: DashboardRow[string] | undefined, format?: Format): string {
  return chartValueText(value, format);
}

/* ======================== Chart cards ======================== */

/** The card's chart file filled from this refresh's output, or the reason the boundary refused it. */
export function cardChart(file: unknown, data: Pick<DashboardCardData, "columns" | "rows" | "truncation">) {
  return fillChartFile<NonNullable<DashboardCardData["truncation"]>>(file, {
    columns: data.columns,
    rows: data.rows,
    truncation: data.truncation ?? undefined,
  });
}

/** The rows a filled chart draws: the ones it put in its dataset, in the order and up to the limit the file states. */
function drawnRows(filled: ReturnType<typeof cardChart>, rows: DashboardRow[]): DashboardRow[] {
  if (!filled.ok) return rows;
  const dataset = filled.option.dataset as { source?: DashboardRow[] }[] | undefined;
  return dataset?.[0]?.source ?? rows.slice(0, filled.displayedRowCount);
}

/**
 * The card's data as a table: the rows the chart draws, headed by the columns' labels, written in the formats the
 * card's file states. The file's sort and limit decide which rows show, and the table does not add a row of its own.
 */
export function chartCardTable(
  file: unknown,
  data: Pick<DashboardCardData, "columns" | "rows" | "truncation">,
): TableData {
  const filled = cardChart(file, data);
  const formats = filled.ok ? filled.presentation.display.formats : undefined;
  return {
    columns: data.columns.map((column) => column.label ?? column.key),
    rows: drawnRows(filled, data.rows).map((row) => data.columns.map((column) => formatValue(row[column.key], formats?.[column.key]))),
  };
}

/* ======================== Number cards ======================== */

/** The card's data as a table: every row of this result, headed by the columns' labels, values in the card's formats. */
export function metricCardTable(
  columns: DashboardCardData["columns"],
  rows: DashboardRow[],
  formats: MetricReferenceMetricEntry["formats"],
): TableData {
  return {
    columns: columns.map((column) => column.label ?? column.key),
    rows: rows.map((row) => columns.map((column) => formatValue(row[column.key], formats?.[column.key]))),
  };
}

/** A number card's value: none for zero rows, otherwise the single row's value field (the server rejects more rows). */
export function metricCardValue(card: MetricReferenceMetricEntry, rows: DashboardRow[]) {
  return rows.length === 0
    ? { empty: true as const }
    : { empty: false as const, text: formatValue(rows[0]![card.valueField], card.formats?.[card.valueField]) };
}

/* ======================== Card render state ======================== */

/**
 * A metric-reference card as the dashboard draws it: its saved entry, its display name and this refresh's state. A
 * chart card keeps its file and this output; the platform's chart fills and draws it.
 */
export type MetricCardView = MetricReferenceEntry &
  MetricCardState & { title?: string; state?: "loading" | "ready" | "empty" | "error" };

/** This refresh is under way; the last result stays on screen until it lands. */
export function cardLoading(card: MetricCardView): MetricCardView {
  return { ...card, state: "loading", error: undefined };
}

/** This result replaces the last one; the configuration the server read this time updates the card. */
export function cardLoaded(card: MetricCardView, data: DashboardCardData): MetricCardView {
  return {
    ...card,
    ...data.card,
    // The entry the board saved keeps its layout; the server reads the card itself.
    layout: card.layout,
    title: data.card.name,
    metric: data.metric,
    columns: data.columns,
    rows: data.rows,
    truncation: data.truncation ?? undefined,
    error: undefined,
    state: data.rows.length ? "ready" : "empty",
  };
}

/** A failure clears what the last success showed, so no stale value stands beside the reason. */
export function cardFailed(card: MetricCardView, error: unknown): MetricCardView {
  return { ...card, metric: undefined, columns: [], rows: [], truncation: undefined, error: cardError(error), state: "error" };
}

type Groups = { charts: unknown[]; metrics: unknown[] }[];

/** Replaces one card, chart or number, by id. */
export function patchCard<G extends Groups>(groups: G, cardId: string, update: (card: MetricCardView) => MetricCardView): G {
  const each = (cards: unknown[]) =>
    cards.map((card) => ((card as { id: string }).id === cardId ? update(card as MetricCardView) : card));
  return groups.map((group) => ({ ...group, charts: each(group.charts), metrics: each(group.metrics) })) as G;
}

/** A chart card is a chart; a number card shows one value. */
export function isChartCard(card: MetricReferenceEntry): card is MetricReferenceChartEntry {
  return "chartFile" in card;
}

export type { FilledChart };
