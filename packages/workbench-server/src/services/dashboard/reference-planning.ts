import { randomUUID } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  dashboardChartInputs, dashboardFormatSchema, metricReferenceChartSchema, metricReferenceMetricSchema,
  type DashboardGroup, type DashboardMetricReference, type DashboardMetricOutput, type MetricReferenceChartEntry,
} from "@ontomato/contracts/dashboard";
import { runAuxiliary } from "../../platform/agent-runtime/runtime";
import { renderPrompt } from "../../core/prompts/loader";
import { buildModelDataView } from "../../utils/model-data-view";
import { HttpError } from "../../utils/errors";
import { createLogger } from "../../logging/logger";
import { cleanJsonBlock } from "./planning/core/chart-recommender";
import { DashboardMetricClient } from "./metric-client";
import { requireMatchingOutput } from "./metric-data";
import type { DashboardDatasetInput } from "./types";

const planned = z.object({ datasetKey: z.string(), name: z.string().min(1), calculation: z.string().min(1).optional() });
const chartPlan = planned.extend({ chartType: z.string().refine(type => Object.hasOwn(dashboardChartInputs, type)) }).strict();
const metricPlan = planned.extend({ unit: z.string().optional() }).strict();
const planSchema = z.object({ name: z.string().min(1), groups: z.array(z.object({
  title: z.string().min(1), charts: z.array(chartPlan), metrics: z.array(metricPlan),
}).strict().refine(group => group.charts.length + group.metrics.length > 0, "A group must contain cards")).min(1) }).strict();
const fieldPlanSchema = z.object({
  fields: z.record(z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])),
  formats: z.record(dashboardFormatSchema).optional(),
}).strict();
const scalarInputs = { required: ["value"], numeric: ["value"], singleRow: true };
const refusalSchema = z.object({ error: z.string().min(1) }).strict();
const logger = createLogger("dashboard-planning");

async function model<T>(key: string, input: unknown, schema: z.ZodType<T>, locale?: string): Promise<T> {
  const outputSchema = zodToJsonSchema(z.union([schema, refusalSchema]), { $refStrategy: "none" });
  const systemPrompt = [
    renderPrompt(key, {}, locale),
    "Return one JSON object matching the output schema. Every required property must be present. "
      + "Use [] for a required array property with no entries; never omit it. "
      + "Do not add properties outside the schema.",
    `Output JSON Schema:\n${JSON.stringify(outputSchema)}`,
  ].join("\n\n");
  const response = await runAuxiliary({ systemPrompt, message: JSON.stringify(input) });
  try {
    const value = JSON.parse(cleanJsonBlock(response));
    if (value && typeof value === "object" && "error" in value) {
      const refused = refusalSchema.parse(value);
      throw new HttpError(422, refused.error, "METRIC_REQUERY_REQUIRED");
    }
    return schema.parse(value);
  }
  catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      const issues = error instanceof z.ZodError ? error.issues : undefined;
      const reason = issues
        ? issues.map(issue => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ")
        : `JSON: ${error.message}`;
      // The shared logger retains message/error fields, not arbitrary metadata.
      logger.warn(`Dashboard planning rejected model output: ${JSON.stringify({ stage: key, issues, rawOutput: response })}`, { error });
      throw new HttpError(502, `Dashboard planning returned an invalid definition: ${reason}`,
        "DASHBOARD_PLAN_INVALID", { stage: key, issues });
    }
    throw error;
  }
}

export async function mapMetricFields(chartType: string, name: string, output: DashboardMetricOutput, locale?: string) {
  const inputs = chartType === "metric" ? scalarInputs : dashboardChartInputs[chartType];
  if (!inputs) throw new HttpError(400, "Unsupported chart type", "INVALID_REQUEST");
  return model("dashboard.reference-fields.system", {
    chartType, name, inputs, columns: output.columns,
    dataView: buildModelDataView(output.rows, { truncation: output.truncation ?? undefined }),
  }, fieldPlanSchema, locale);
}

/** Planning chooses an intended result; only the metric service implements its calculation. */
export async function planReferenceDashboard(
  datasets: DashboardDatasetInput[], client: DashboardMetricClient, existingChartTypes: string[] = [],
) {
  const plan = await model("dashboard.reference-planner.system", {
    chartInputs: dashboardChartInputs, existingChartTypes,
    datasets: datasets.map(dataset => ({
      datasetKey: dataset.datasetKey, question: dataset.subQuestion, sourceKind: dataset.recipe.kind,
      columns: dataset.columns, rowCount: dataset.data.length,
      dataView: buildModelDataView(dataset.data, { truncation: dataset.truncated ? {
        truncated: true, rowLimit: dataset.rowLimit!, truncationHint: dataset.truncationHint!,
      } : undefined }),
    })),
  }, planSchema, client.credentials.locale);
  const byKey = new Map(datasets.map(dataset => [dataset.datasetKey, dataset]));
  // Cards presenting the same requested calculation share one settlement in this operation.
  const settled = new Map<string, Promise<{ query: DashboardMetricReference; output: DashboardMetricOutput }>>();
  async function source(card: z.infer<typeof planned>, chartType: string) {
    const dataset = byKey.get(card.datasetKey);
    if (!dataset) throw new HttpError(502, "The plan references an unknown dataset", "DASHBOARD_PLAN_INVALID");
    if (dataset.recipe.kind === "metric" && card.calculation)
      throw new HttpError(422, "This metric has no requested statistic; ask again for the required result", "METRIC_REQUERY_REQUIRED");
    const inputs = chartType === "metric" ? scalarInputs : dashboardChartInputs[chartType];
    const key = dataset.recipe.kind === "metric" ? dataset.datasetKey
      : JSON.stringify([dataset.datasetKey, card.calculation, inputs]);
    let task = settled.get(key);
    if (!task) {
      task = (async () => {
        const result = await client.settle({
          question: dataset.subQuestion, recipe: dataset.recipe,
          ...(card.calculation ? { calculation: card.calculation } : {}), outputShape: inputs,
        });
        const query: DashboardMetricReference = { kind: "metric", metricId: result.metricId, parameters: result.parameters };
        return { query, output: await client.execute(query, result.revision) };
      })();
      settled.set(key, task);
    }
    return { dataset, ...await task };
  }
  const groups: DashboardGroup[] = [];
  for (const group of plan.groups) {
    const result: DashboardGroup = { id: randomUUID(), title: group.title, charts: [], metrics: [] };
    for (const chart of group.charts) {
      const { dataset, query, output } = await source(chart, chart.chartType);
      const mapped = await mapMetricFields(chart.chartType, chart.name, output, client.credentials.locale);
      const entry = metricReferenceChartSchema.parse({
        id: randomUUID(), name: chart.name, chartType: chart.chartType, query, ...mapped,
        source: { ...dataset.source, datasetKey: dataset.datasetKey, subQuestion: dataset.subQuestion },
        layout: { colSpan: 12, rowSpan: 1 },
      });
      requireMatchingOutput(entry, output);
      result.charts.push(entry);
    }
    for (const metric of group.metrics) {
      const { dataset, query, output } = await source(metric, "metric");
      const mapped = await mapMetricFields("metric", metric.name, output, client.credentials.locale);
      const entry = metricReferenceMetricSchema.parse({
        id: randomUUID(), name: metric.name, unit: metric.unit, query,
        valueField: mapped.fields.value, formats: mapped.formats,
        source: { ...dataset.source, datasetKey: dataset.datasetKey, subQuestion: dataset.subQuestion },
        layout: { colSpan: 6, rowSpan: 1 },
      });
      requireMatchingOutput(entry, output);
      result.metrics.push(entry);
    }
    groups.push(result);
  }
  return { name: plan.name, groups };
}

export async function changeMetricChartType(card: MetricReferenceChartEntry, chartType: string, client: DashboardMetricClient) {
  if (!Object.hasOwn(dashboardChartInputs, chartType)) throw new HttpError(400, "Unsupported chart type", "INVALID_REQUEST");
  const spec = await client.describe(card.query.metricId);
  const output = await client.execute(card.query, spec.revision);
  const mapped = await mapMetricFields(chartType, card.name, output, client.credentials.locale);
  const changed = { ...card, chartType, fields: mapped.fields };
  requireMatchingOutput(changed, output);
  return changed;
}
