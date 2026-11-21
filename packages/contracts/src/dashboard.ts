import { z } from "zod";
import { storedChartFileSchema } from "./chart-data";
import { chartDisplaySchema } from "./chart-data/display";
import { chartInputs, type ChartInputRoles } from "./chart-data/inputs";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldSchema, formFieldErrorSchema, formValuesSchema } from "./form-fields";

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
  sessionId: text.optional(), runId: text.optional(), artifactId: text.optional(), datasetKey: text.optional(), subQuestion: z.string().optional(),
}).strict();
export const dashboardPresentationSchema = chartDisplaySchema.extend({
  name: text,
  layout: dashboardLayoutSchema.optional(),
  style: z.object({ colors: z.array(z.string()).optional() }).strict().optional(),
}).strict();
export const dashboardChartFileSchema = z.object({ name: text.endsWith(".chart.json"), content: storedChartFileSchema }).strict();
export const metricReferenceChartSchema = z.object({
  id: text, name: text, query: dashboardMetricReferenceSchema,
  chartFile: dashboardChartFileSchema, layout: dashboardLayoutSchema.optional(), source: sourceSchema.optional(),
}).strict();
export const metricReferenceMetricSchema = dashboardPresentationSchema.extend({
  id: text, query: dashboardMetricReferenceSchema, source: sourceSchema.optional(),
  unit: z.string().optional(), valueField: text,
}).strict();
export type MetricReferenceChartEntry = z.infer<typeof metricReferenceChartSchema>;
export type MetricReferenceMetricEntry = z.infer<typeof metricReferenceMetricSchema>;
export type MetricReferenceEntry = MetricReferenceChartEntry | MetricReferenceMetricEntry;
export type DashboardChartEntry = MetricReferenceChartEntry;
export type DashboardMetricEntry = MetricReferenceMetricEntry;
export const dashboardGroupSchema = z.object({ id: text, title: z.string(), charts: z.array(metricReferenceChartSchema), metrics: z.array(metricReferenceMetricSchema) }).strict();
export const dashboardGroupsSchema = z.array(dashboardGroupSchema);
export type DashboardGroup = z.infer<typeof dashboardGroupSchema>;
const chartLayoutPatchSchema = metricReferenceChartSchema.pick({ id:true, name:true, layout:true, chartFile:true }).partial({name:true,layout:true,chartFile:true});
const metricLayoutPatchSchema = metricReferenceMetricSchema.omit({query:true,source:true}).partial().required({id:true});
export const dashboardReplaceLayoutSchema = z.object({
  id: text, groups: z.array(z.object({ id:text, title:z.string(), charts:z.array(chartLayoutPatchSchema), metrics:z.array(metricLayoutPatchSchema) }).strict()),
}).strict();
export type DashboardReplaceLayout = z.infer<typeof dashboardReplaceLayoutSchema>;
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

/** The card is a child of its dashboard and keeps both parts of its owner's identity. */
export function dashboardCardPrimaryKey({ dashboardId, cardId }: DashboardCardRequest): string {
  return `${encodeURIComponent(dashboardId)}/${encodeURIComponent(cardId)}`;
}

export function parseDashboardCardPrimaryKey(primaryKey: string): DashboardCardRequest {
  const parts = z.tuple([text, text]).parse(primaryKey.split("/"));
  return dashboardCardRequestSchema.parse({ dashboardId: decodeURIComponent(parts[0]), cardId: decodeURIComponent(parts[1]) });
}

export const chartProjectionTemplateSchema = z.object({
  chartFile: dashboardChartFileSchema,
  parameters: dashboardMetricReferenceSchema.shape.parameters,
}).strict();
export type DashboardSaveParameters = z.infer<typeof dashboardSaveParametersSchema>;
export type DashboardMetricDescription = z.infer<typeof dashboardMetricDescriptionSchema>;
export type DashboardMetricOutput = z.infer<typeof dashboardMetricOutputSchema>;
export type DashboardParameterForm = z.infer<typeof dashboardParameterFormSchema>;
const cardMetricSchema = dashboardMetricDescriptionSchema.pick({id:true,name:true,revision:true,status:true});
export const dashboardCardDataSchema = z.union([
  dashboardMetricOutputSchema.extend({card:metricReferenceChartSchema.omit({chartFile:true}),file:dashboardChartFileSchema,metric:cardMetricSchema}).strict(),
  dashboardMetricOutputSchema.extend({card:metricReferenceMetricSchema,metric:cardMetricSchema}).strict(),
]);
export type DashboardCardData = z.infer<typeof dashboardCardDataSchema>;
export type DashboardRow = Record<string, z.infer<typeof runtimeJsonValueSchema>>;

const authoringName = z.string().trim().min(1);
export const dashboardRenameSchema = z.object({id:text,name:authoringName}).strict();
export const dashboardChartRenameSchema = z.object({id:text,chartId:text,resultSetName:authoringName}).strict();
export const dashboardMetricRenameSchema = z.object({id:text,metricId:text,metricName:authoringName}).strict();
export const dashboardGroupRenameSchema = z.object({id:text,groupId:text,dimensionName:z.string().trim()}).strict();
/** Forms are the existing save bodies; paths are relative to /api/dashboards. */
export const dashboardAuthoring = {
  "dashboard.layout": {schema:dashboardReplaceLayoutSchema,path:"/modifyLayout"},
  "dashboard.rename": {schema:dashboardRenameSchema,path:"/modify"},
  "dashboard.chart.rename": {schema:dashboardChartRenameSchema,path:"/modifyResultSetName"},
  "dashboard.metric.rename": {schema:dashboardMetricRenameSchema,path:"/modifyMetricName"},
  "dashboard.group.rename": {schema:dashboardGroupRenameSchema,path:"/modifyDimensionName"},
  "dashboard.card.parameters": {schema:dashboardSaveParametersSchema,path:"/save-card-parameters"},
} as const;
export type DashboardOperation = keyof typeof dashboardAuthoring;
export const dashboardOperationSchema = z.enum(Object.keys(dashboardAuthoring) as [DashboardOperation,...DashboardOperation[]]);
export type DashboardAuthoringForm<Operation extends DashboardOperation = DashboardOperation> = z.infer<(typeof dashboardAuthoring)[Operation]["schema"]>;
