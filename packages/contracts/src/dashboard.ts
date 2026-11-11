import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldSchema, formFieldErrorSchema, formValuesSchema } from "./form-fields";
import type { LegacyDashboardChartEntry, LegacyDashboardMetricEntry } from "./dashboard-legacy";
export type { DataPlan, TransformSpec, AbcProgramDashboard, AbcProgramParameter, AbcProgramOutKeyRef, LegacyInlineEntry } from "./dashboard-legacy";

/** Input roles name final metric columns. Numeric roles never request a calculation. */
export const dashboardChartInputs: Record<string, { required: string[]; numeric: string[]; arrays?: string[]; optional?: string[]; singleRow?: boolean }> = {
  bar: { required: ["xAxis", "yAxis"], numeric: ["yAxis"] },
  line: { required: ["xAxis", "yAxis"], numeric: ["yAxis"] },
  "area-line": { required: ["xAxis", "yAxis"], numeric: ["yAxis"] },
  "pictorial-bar": { required: ["xAxis", "yAxis"], numeric: ["yAxis"] },
  "bar-line": { required: ["xAxis", "barSeries", "lineSeries"], numeric: ["barSeries", "lineSeries"], arrays: ["barSeries"] },
  pie: { required: ["name", "value"], numeric: ["value", "share"], optional: ["share"] },
  "nightingale-rose": { required: ["name", "value"], numeric: ["value", "share"], optional: ["share"] },
  treemap: { required: ["name", "value"], numeric: ["value", "share"], optional: ["share"] },
  funnel: { required: ["name", "value"], numeric: ["value", "share"], optional: ["share"] },
  sankey: { required: ["source", "target", "value"], numeric: ["value"] },
  scatter: { required: ["xAxis", "yAxis"], numeric: ["xAxis", "yAxis", "size"], optional: ["name", "size"] },
  radar: { required: ["name", "value"], numeric: ["value"] },
  sunburst: { required: ["id", "parent", "name", "value"], numeric: ["value", "share"], optional: ["share"] },
  boxplot: { required: ["category", "min", "q1", "median", "q3", "max"], numeric: ["min", "q1", "median", "q3", "max"] },
  gauge: { required: ["value"], numeric: ["value"], singleRow: true },
  "liquid-fill": { required: ["value"], numeric: ["value"], singleRow: true },
};
const text = z.string().min(1);
export const dashboardLayoutSchema = z.object({ colSpan: z.number().optional(), rowSpan: z.number().optional() }).strict();
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;
export const dashboardMetricReferenceSchema = z.object({
  kind: z.literal("metric"), metricId: text, parameters: runtimeJsonObjectSchema,
}).strict();
export type DashboardMetricReference = z.infer<typeof dashboardMetricReferenceSchema>;
export const dashboardFormatSchema = z.object({
  kind: z.enum(["number", "percent", "text", "date", "currency"]),
  decimals: z.number().int().min(0).optional(),
  scale: z.union([z.literal(1), z.literal(100)]).optional(),
  currency: z.string().optional(),
}).strict().refine(v => v.kind !== "percent" || v.scale !== undefined, "Percent formatting requires an explicit scale");
const sourceSchema = z.object({
  sessionId: text.optional(), artifactId: text.optional(), datasetKey: text.optional(), subQuestion: z.string().optional(),
}).strict();
export const dashboardPresentationSchema = z.object({
  name: text,
  sort: z.array(z.object({ field: text, order: z.enum(["asc", "desc"]) }).strict()).optional(),
  displayLimit: z.number().int().positive().optional(),
  formats: z.record(dashboardFormatSchema).optional(),
  layout: dashboardLayoutSchema.optional(),
  style: z.object({ colors: z.array(z.string()).optional() }).strict().optional(),
}).strict();
export const metricReferenceChartSchema = dashboardPresentationSchema.extend({
  id: text, query: dashboardMetricReferenceSchema, source: sourceSchema.optional(),
  chartType: text.refine(v => Object.hasOwn(dashboardChartInputs, v), "Unsupported chart type"),
  fields: z.record(z.union([text, z.array(text).min(1)])),
}).strict();
export const metricReferenceMetricSchema = dashboardPresentationSchema.extend({
  id: text, query: dashboardMetricReferenceSchema, source: sourceSchema.optional(),
  unit: z.string().optional(), valueField: text,
}).strict();
export type MetricReferenceChartEntry = z.infer<typeof metricReferenceChartSchema>;
export type MetricReferenceMetricEntry = z.infer<typeof metricReferenceMetricSchema>;
export type MetricReferenceEntry = MetricReferenceChartEntry | MetricReferenceMetricEntry;
export type DashboardChartEntry = MetricReferenceChartEntry | LegacyDashboardChartEntry;
export type DashboardMetricEntry = MetricReferenceMetricEntry | LegacyDashboardMetricEntry;
export function isMetricReferenceEntry(entry: DashboardChartEntry | DashboardMetricEntry): entry is MetricReferenceEntry {
  return entry.query?.kind === "metric";
}
export type DashboardGroup = { id: string; title: string; charts: DashboardChartEntry[]; metrics: DashboardMetricEntry[] };
export type DashboardDetail = {
  id: string; ownerId: string; name: string; createdAt: number; updatedAt: number;
  source?: { sessionId?: string; artifactId?: string; threadId?: string; requestSeq?: number };
  groups: DashboardGroup[];
};
export type DashboardListItem = Pick<DashboardDetail, "id" | "name" | "createdAt" | "updatedAt">;

export const dashboardCardRequestSchema = z.object({ dashboardId: text, cardId: text }).strict();
export const dashboardSaveParametersSchema = dashboardCardRequestSchema.extend({ revision: text, values: formValuesSchema }).strict();
export const dashboardColumnSchema = z.object({ key: text, label: z.string().nullable(), type: z.string().nullable() });
export const dashboardTruncationSchema = z.object({ truncated: z.literal(true), rowLimit: z.number(), truncationHint: z.string() }).strict();
export const dashboardMetricDescriptionSchema = z.object({
  id: text, revision: text, status: text, name: z.string(),
  parameterDefs: z.array(z.record(z.unknown())), outputColumns: z.array(dashboardColumnSchema),
});
export const dashboardMetricOutputSchema = z.object({
  columns: z.array(dashboardColumnSchema), rows: z.array(runtimeJsonObjectSchema),
  truncation: dashboardTruncationSchema.nullable(),
});
export const dashboardParameterFormSchema = z.object({
  revision: text, fields: z.array(formFieldSchema), values: formValuesSchema, readOnly: z.array(text),
});
export const dashboardParameterResultSchema = z.object({
  revision: text, parameters: runtimeJsonObjectSchema, errors: z.array(formFieldErrorSchema),
});
export type DashboardCardRequest = z.infer<typeof dashboardCardRequestSchema>;
export type DashboardSaveParameters = z.infer<typeof dashboardSaveParametersSchema>;
export type DashboardMetricDescription = z.infer<typeof dashboardMetricDescriptionSchema>;
export type DashboardMetricOutput = z.infer<typeof dashboardMetricOutputSchema>;
export type DashboardParameterForm = z.infer<typeof dashboardParameterFormSchema>;
export type DashboardCardData = DashboardMetricOutput & {
  card: MetricReferenceEntry;
  metric: Pick<DashboardMetricDescription, "id" | "name" | "revision" | "status">;
};
export type DashboardRow = Record<string, z.infer<typeof runtimeJsonValueSchema>>;
