import { z } from "zod";
import {
  dashboardChartInputs, isMetricReferenceEntry,
  type DashboardCardRequest, type DashboardSaveParameters, type DashboardMetricOutput,
  type MetricReferenceEntry, type DashboardCardData,
} from "@ontomato/contracts/dashboard";
import type { AssistantOwner } from "../assistant/store";
import { getOwnedDashboard } from "./access";
import { saveDashboard } from "./store";
import { DashboardMetricClient } from "./metric-client";
import { HttpError } from "../../utils/errors";

type FieldMappings = Record<string, string | string[]>;
type Presentation = Pick<MetricReferenceEntry, "sort" | "formats">;
type OutputIssue = { path: (string | number)[]; message: string; fields: string[] };
const scalarInputs = { required: ["value"], numeric: ["value"], singleRow: true };

export function dashboardInputs(chartType: string): (typeof dashboardChartInputs)[string] {
  const inputs = chartType === "metric" ? scalarInputs : dashboardChartInputs[chartType];
  if (!inputs) throw new HttpError(400, "Unsupported chart type", "INVALID_REQUEST");
  return inputs;
}

/** Derive literal role names and their cardinality from the shared chart contract. */
export function chartFieldSchema(chartType: string): z.ZodType<FieldMappings> {
  const inputs = dashboardInputs(chartType);
  const properties: z.ZodRawShape = {};
  for (const role of [...inputs.required, ...(inputs.optional ?? [])]) {
    const column = z.string().min(1);
    const value = (inputs.arrays ?? []).includes(role) ? z.array(column).min(1) : column;
    properties[role] = inputs.required.includes(role) ? value : value.optional();
  }
  return z.object(properties).strict();
}

/** Compare mapped fields with an execution result without choosing a caller's error category. */
export function outputMappingIssues(
  chartType: string, mappings: FieldMappings, output: DashboardMetricOutput, presentation: Presentation = {},
): OutputIssue[] {
  const inputs = dashboardInputs(chartType);
  const issues: OutputIssue[] = [];
  const columns = new Set(output.columns.map(column => column.key));
  for (const [role, mapped] of Object.entries(mappings)) {
    const fields = Array.isArray(mapped) ? mapped : [mapped];
    fields.forEach((field, index) => {
      const path = Array.isArray(mapped) ? ["fields", role, index] : ["fields", role];
      if (!columns.has(field)) {
        issues.push({ path, message: `Missing output column: ${field}`, fields: [field] });
      } else if (inputs.numeric.includes(role) && output.rows.some(row => row[field] !== null && typeof row[field] !== "number")) {
        issues.push({ path, message: `Output column must be numeric: ${field}`, fields: [field] });
      }
    });
  }
  if (inputs.singleRow && output.rows.length > 1)
    issues.push({ path: ["fields", "value"], message: "This card requires a single metric result row", fields: [] });
  (presentation.sort ?? []).forEach((sort, index) => {
    if (!columns.has(sort.field))
      issues.push({ path: ["sort", index, "field"], message: `Missing output column: ${sort.field}`, fields: [sort.field] });
  });
  for (const field of Object.keys(presentation.formats ?? {})) {
    if (!columns.has(field))
      issues.push({ path: ["formats", field], message: `Missing output column: ${field}`, fields: [field] });
  }
  return issues;
}

export function requireMatchingOutput(card: MetricReferenceEntry, output: DashboardMetricOutput): void {
  const chartType = "chartType" in card ? card.chartType : "metric";
  const mappings = "fields" in card ? card.fields : { value: card.valueField };
  const parsed = chartFieldSchema(chartType).safeParse(mappings);
  const issues = parsed.success ? outputMappingIssues(chartType, parsed.data, output, card)
    : parsed.error.issues.map(issue => ({
      path: ["fields", ...issue.path], message: issue.message,
      fields: issue.code === "unrecognized_keys" ? issue.keys : issue.path.map(String),
    }));
  if (issues.length) {
    const issue = issues[0];
    throw new HttpError(422, `Metric output changed; ${issue.path.join(".")}: ${issue.message}`, "CARD_OUTPUT_MISMATCH", {
      metricId: card.query.metricId, cardId: card.id, fields: issue.fields, issues,
    });
  }
}

async function ownedCard(owner: AssistantOwner, request: DashboardCardRequest) {
  const detail = await getOwnedDashboard(owner.userId, owner.domainId, request.dashboardId);
  const card = detail.groups.flatMap(group => [...group.charts, ...group.metrics]).find(entry => entry.id === request.cardId);
  if (!card) throw new HttpError(404, "Dashboard card not found", "NOT_FOUND");
  if (!isMetricReferenceEntry(card)) throw new HttpError(400, "Use the legacy card endpoint", "LEGACY_CARD");
  return { detail, card };
}

export async function queryMetricCard(owner: AssistantOwner, request: DashboardCardRequest, client: DashboardMetricClient): Promise<DashboardCardData> {
  const { card } = await ownedCard(owner, request);
  const spec = await client.describe(card.query.metricId);
  const output = await client.execute(card.query, spec.revision);
  requireMatchingOutput(card, output);
  return { card, metric: { id: spec.id, name: spec.name, revision: spec.revision, status: spec.status }, ...output };
}

export async function metricCardParameterForm(owner: AssistantOwner, request: DashboardCardRequest, client: DashboardMetricClient) {
  const { card } = await ownedCard(owner, request);
  return client.form(card.query);
}

export async function saveMetricCardParameters(owner: AssistantOwner, request: DashboardSaveParameters, client: DashboardMetricClient) {
  const { detail, card } = await ownedCard(owner, request);
  const result = await client.parameters(card.query, request.revision, request.values);
  if (result.errors.length)
    throw new HttpError(422, "Invalid metric parameters", "METRIC_PARAMETERS_INVALID", { errors: result.errors });
  card.query.parameters = result.parameters;
  await saveDashboard(owner.userId, owner.domainId, detail);
  return { cardId: card.id, query: card.query, revision: result.revision };
}
