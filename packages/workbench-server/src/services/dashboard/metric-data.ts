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

export function requireMatchingOutput(card: MetricReferenceEntry, output: DashboardMetricOutput): void {
  const fail = (message: string, fields: string[] = []): never => {
    throw new HttpError(422, message, "CARD_OUTPUT_MISMATCH", { metricId: card.query.metricId, cardId: card.id, fields });
  };
  const shape: (typeof dashboardChartInputs)[string] = "chartType" in card ? dashboardChartInputs[card.chartType]
    : { required: ["value"], numeric: ["value"], singleRow: true };
  const mappings: Record<string, string | string[]> = "fields" in card ? card.fields : { value: card.valueField };
  if (!shape) fail("Unsupported chart type");
  for (const role of shape.required) if (!Object.hasOwn(mappings, role)) fail(`Missing field mapping: ${role}`, [role]);
  const allowed = [...shape.required, ...(shape.optional ?? [])];
  for (const [role, field] of Object.entries(mappings)) {
    if (!allowed.includes(role)) fail(`Unexpected field mapping: ${role}`, [role]);
    if ((shape.arrays ?? []).includes(role) !== Array.isArray(field)) fail(`Invalid field mapping: ${role}`, [role]);
  }
  const columns = new Set(output.columns.map(column => column.key));
  const required = [
    ...Object.values(mappings).flat(),
    ...(card.sort ?? []).map(sort => sort.field), ...Object.keys(card.formats ?? {}),
  ];
  const missing = required.filter(field => !columns.has(field));
  if (missing.length) fail(`Metric output changed; missing columns: ${missing.join(", ")}`, missing);
  if (shape.singleRow && output.rows.length > 1) fail("This card requires a single metric result row");
  for (const role of shape.numeric) {
    const mapped = mappings[role];
    if (mapped === undefined) continue;
    const fields = Array.isArray(mapped) ? mapped : [mapped];
    for (const field of fields) {
      if (output.rows.some(row => row[field] !== null && typeof row[field] !== "number"))
        fail(`Metric output changed; column ${field} must be numeric`, [field]);
    }
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
