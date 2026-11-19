import { runtimeJsonObjectSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { ChartMetricColumn, ChartRow } from "@ontomato/contracts/chart-data";
import { dashboardMetricDescriptionSchema } from "@ontomato/contracts/dashboard";
import { chartProjectionSourcePath } from "@ontomato/contracts/panel-client-requests";
import { chartProjectionTemplateSchema, updateChartProjectionSourceRequestSchema } from "@ontomato/contracts/product-panels";
import type { PlatformRequests } from "./platform-objects";

/*
 * The chart source client of a MetricChart projection (M2 design 2.1, and the ruling of 2026-11-19): a chart projection
 * is the chart on its dashboard. Its only drawing is its source card's chart file and its parameters are the card's
 * saved query parameters, both handed over by the dashboard owner for this registered projection and read again on
 * every read. The data is the bound MetricView's, read with the reader's own credential, with the values this panel
 * binds laid over the card's parameters. Nothing is cached and nothing merged is kept or written back: the panel's
 * values hold here alone.
 *
 * Every request is one `contracts/panel-client-requests.ts` declares for a chart projection: the template by the
 * projection's ID, and the MetricView's describe and execute by the bound MetricView's ID.
 */

/**
 * The template read: the card's chart file and its current parameters. The parameters join the contract's template
 * response in A's next commit; until then they are read here by the agreed name, and this line goes with that commit.
 */
const templateSchema = chartProjectionTemplateSchema.extend({ parameters: runtimeJsonObjectSchema });

export type ChartTemplate = ReturnType<typeof chartProjectionTemplateSchema.parse>["chartFile"];

/** What the chart draws from: the MetricView's declared columns, its rows and a truncation note when it was cut. */
export interface ChartMetric {
  columns: ChartMetricColumn[];
  rows: ChartRow[];
  truncation?: { truncationHint: string };
}

/** One read of a chart: the card's drawing and the MetricView's output for the card's parameters and the panel's. */
export interface ChartRead {
  template: ChartTemplate;
  metric: ChartMetric;
}

export interface MetricChartClient {
  /**
   * Reads the chart now: the source card's template and parameters for this projection, then the bound MetricView with
   * the card's parameters and `bound` laid over them, as the reader. A refusal — the chart or its source card gone, the
   * MetricView unreadable or missing a parameter — is the owner's, with the owner's message.
   */
  read(projectionId: string, metricId: string, bound: Readonly<Record<string, RuntimeJsonValue>>): Promise<ChartRead>;
  /** Replaces only the drawing of the source card, as the projection's edit allows; the owner's saved file comes back. */
  saveTemplate(projectionId: string, content: ChartTemplate["content"]): Promise<ChartTemplate>;
}

const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const rowsSchema = runtimeJsonObjectSchema.array();

/** The client over a frame's request path. */
export function createMetricChartClient(requests: PlatformRequests): MetricChartClient {
  async function body(response: Promise<Response>): Promise<unknown> {
    return (await response).json();
  }
  return {
    async read(projectionId, metricId, bound) {
      const [template, description] = await Promise.all([
        body(requests.request(chartProjectionSourcePath(projectionId), {}, "")).then((answer) => templateSchema.parse(answer)),
        body(requests.request("/ontology/query/metrics/describe", { method: "POST", ...json({ id: metricId }) }, "/data-query"))
          .then((answer) => dashboardMetricDescriptionSchema.parse(answer)),
      ]);
      const answer = await body(requests.request("/metricView/execute", {
        method: "POST", ...json({ id: metricId, param: { ...template.parameters, ...bound } }),
      }, "/data-query")) as { success?: unknown; message?: unknown; data?: unknown; truncated?: unknown; truncationHint?: unknown };
      // The data engine answers a refusal in the body, with its own message: a missing parameter, an unreadable view.
      if (answer.success !== true) throw new Error(String(answer.message));
      return {
        template: template.chartFile,
        metric: {
          columns: description.outputColumns,
          rows: rowsSchema.parse(answer.data) as ChartRow[],
          ...(answer.truncated === true ? { truncation: { truncationHint: String(answer.truncationHint) } } : {}),
        },
      };
    },
    async saveTemplate(projectionId, content) {
      const update = updateChartProjectionSourceRequestSchema.parse({ chartFile: { content } });
      const saved = await body(requests.request(chartProjectionSourcePath(projectionId), { method: "PUT", ...json(update) }, ""));
      return templateSchema.parse(saved).chartFile;
    },
  };
}

let registered: MetricChartClient | undefined;

/** How the frame registers the client when a projection draws a MetricChart: with the frame's request path. */
export const metricChartClients = (requests: PlatformRequests): void => {
  registered = createMetricChartClient(requests);
};

/** The chart source client this frame registered. */
export function metricChartClient(): MetricChartClient {
  if (!registered) throw new Error("This frame has registered no chart source client");
  return registered;
}
