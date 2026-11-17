import { z } from "zod";
import { chartDisplaySchema } from "./chart-data/display";
import { chartInputs, type ChartInputRoles } from "./chart-data/inputs";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldSchema, formFieldErrorSchema, formValuesSchema } from "./form-fields";
import type { LegacyDashboardChartEntry, LegacyDashboardMetricEntry } from "./dashboard-legacy";
export type { DataPlan, TransformSpec, AbcProgramDashboard, AbcProgramParameter, AbcProgramOutKeyRef, LegacyInlineEntry } from "./dashboard-legacy";

const dashboardChartTypes = [
  "bar", "line", "area-line", "pictorial-bar", "bar-line", "pie", "nightingale-rose", "treemap", "funnel",
  "sankey", "scatter", "radar", "sunburst", "boxplot", "gauge", "liquid-fill",
];
export const dashboardChartInputs: Record<string, ChartInputRoles> = Object.fromEntries(
  dashboardChartTypes.map(type => [type, chartInputs[type]]),
);
const text = z.string().min(1);
export const dashboardLayoutSchema = z.object({ colSpan: z.number().optional(), rowSpan: z.number().optional() }).strict();
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;
export const dashboardMetricReferenceSchema = z.object({
  kind: z.literal("metric"), metricId: text, parameters: runtimeJsonObjectSchema,
}).strict();
export type DashboardMetricReference = z.infer<typeof dashboardMetricReferenceSchema>;
const sourceSchema = z.object({
  sessionId: text.optional(), artifactId: text.optional(), datasetKey: text.optional(), subQuestion: z.string().optional(),
}).strict();
export const dashboardPresentationSchema = chartDisplaySchema.extend({
  name: text,
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
  sourceObjectTypes:z.array(z.string()).optional(),
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
