import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema, type RuntimeJsonValue } from "../agent-runtime-values";
import { chartDisplaySchema } from "./display";

const column = z.string().min(1);
const itemFields = { name: column, value: column, share: column.optional() };
const bindingBase = { seriesId: column };
export const chartBindingSchema = z.union([
  z.object({ ...bindingBase, shape: z.literal("items"), fields: z.object(itemFields).strict() }).strict(),
  z.object({ ...bindingBase, shape: z.literal("tree"), fields: z.object({ ...itemFields, id: column, parent: column }).strict() }).strict(),
  z.object({ ...bindingBase, shape: z.literal("links"), fields: z.object({ source: column, target: column, value: column }).strict() }).strict(),
  z.object({ ...bindingBase, shape: z.literal("radar"), fields: z.object({ name: column, value: column }).strict() }).strict(),
  z.object({ ...bindingBase, shape: z.literal("boxplot"), fields: z.object({ category: column, min: column, q1: column, median: column, q3: column, max: column }).strict() }).strict(),
  z.object({ ...bindingBase, shape: z.literal("single"), fields: z.object({ value: column }).strict() }).strict(),
  z.object({ ...bindingBase, shape: z.literal("timeline"), fields: z.object({ date: column, name: column, description: column }).strict() }).strict(),
  z.object({ ...bindingBase, shape: z.literal("graph"), input: z.literal("object"), fields: z.object({ nodes: column, links: column }).strict() }).strict(),
  z.object({ ...bindingBase, shape: z.literal("graph"), input: z.literal("edges"), fields: z.object({
    source: column, target: column, value: column.optional(), relation: column.optional(),
    sourceName: column.optional(), targetName: column.optional(), sourceCategory: column.optional(), targetCategory: column.optional(),
  }).strict() }).strict(),
]);
export type ChartBinding = z.infer<typeof chartBindingSchema>;
export const chartMetricColumnSchema = z.object({ key: column, label: z.string().nullable().optional(), type: z.string().nullable().optional() });
export type ChartMetricColumn = z.infer<typeof chartMetricColumnSchema>;
export type ChartRow = Record<string, RuntimeJsonValue>;
// ECharts options remain open JSON; only the data boundary and reserved metadata are platform-owned.
export type ChartOption = Record<string, any>;
export type ChartIssue = { path: (string | number)[]; reason: string; message: string };
export type ChartFailure = {
  ok: false;
  code: "INVALID_CHART_FILE" | "CARD_OUTPUT_MISMATCH" | "INVALID_METRIC_OUTPUT" | "INVALID_SHAPE_DATA";
  issues: ChartIssue[];
  missingColumns: string[];
};

const forbiddenKeys = new Set(["renderItem", "renderer", "script", "scripts", "template", "expression", "transform", "formatter", "valueFormatter", "onClick", "onclick", "callback"]);
/** Execution-bearing option keys are forbidden even when their payload happens to be JSON. */
export function chartExecutionIssues(value: RuntimeJsonValue, path: (string | number)[] = []): ChartIssue[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((child, index) => chartExecutionIssues(child, [...path, index]));
  return Object.entries(value).flatMap(([key, child]) => [
    ...(forbiddenKeys.has(key) ? [{ path: [...path, key], reason: "EXECUTABLE_OPTION", message: `Unsupported executable option: ${key}` }] : []),
    ...chartExecutionIssues(child, [...path, key]),
  ]);
}

export const chartMetricReferenceSchema = z.object({ metricId: column, parameters: runtimeJsonObjectSchema }).strict();
export type ChartMetricReference = z.infer<typeof chartMetricReferenceSchema>;
export const chartDatasetReferenceSchema = z.object({ path: z.string().min(1) }).strict();
export type ChartDatasetReference = z.infer<typeof chartDatasetReferenceSchema>;

const seriesSchema = z.object({
  id: column, type: column.refine(type => type !== "custom", "Custom renderers are not supported"),
  datasetId: z.literal("metric").optional(),
  encode: z.record(z.union([column, z.array(column).min(1)])).optional(),
}).catchall(runtimeJsonValueSchema);
const fileBaseSchema = z.object({
  dataset: z.array(z.object({
    id: z.literal("metric"), dimensions: z.array(column), source: z.array(runtimeJsonObjectSchema),
  }).strict()).length(1),
  series: z.array(seriesSchema).min(1),
  ontomato: z.object({ bindings: z.array(chartBindingSchema).optional(), display: chartDisplaySchema.optional(), metric: chartMetricReferenceSchema.optional(), dataset: chartDatasetReferenceSchema.optional() }).strict(),
}).catchall(runtimeJsonValueSchema);

export const chartFileSchema = fileBaseSchema.superRefine((file, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  if (file.ontomato.metric && file.ontomato.dataset) issue(["ontomato"], "Specify either a MetricView or an accepted dataset reference, not both");
  const ids = file.series.map(series => series.id);
  if (new Set(ids).size !== ids.length) issue(["series"], "Series IDs must be unique");
  const dimensions = file.dataset[0].dimensions;
  if (new Set(dimensions).size !== dimensions.length) issue(["dataset", 0, "dimensions"], "Dimensions must be unique");
  const bindings = file.ontomato.bindings ?? [];
  if (new Set(bindings.map(binding => binding.seriesId)).size !== bindings.length) issue(["ontomato", "bindings"], "A series can have only one binding");
  const types: Record<ChartBinding["shape"], string[]> = {
    items: ["treemap"], tree: ["sunburst", "tree"], links: ["sankey"], radar: ["radar"],
    boxplot: ["boxplot"], single: ["gauge"], timeline: ["line", "scatter"], graph: ["graph"],
  };
  for (const [index, binding] of bindings.entries()) {
    const series = file.series.find(series => series.id === binding.seriesId);
    if (!series || !types[binding.shape].includes(series.type)) issue(["ontomato", "bindings", index], "Binding must reference a series of the matching type");
  }
  for (const [index, series] of file.series.entries()) {
    for (const key of ["data", "nodes", "links", "edges"]) if (key in series) issue(["series", index, key], "Business data belongs only in the metric dataset");
    if ("datasetIndex" in series || "seriesLayoutBy" in series) issue(["series", index], "Use metric datasetId and column-oriented encode");
    if (!bindings.some(binding => binding.seriesId === series.id) && (!series.encode || series.datasetId !== "metric")) issue(["series", index], "Unbound series must use metric datasetId and encode");
    if (["treemap", "sunburst", "tree", "sankey", "radar", "boxplot", "gauge", "graph"].includes(series.type) && !bindings.some(binding => binding.seriesId === series.id)) issue(["series", index], "This series requires a shape binding");
  }
  for (const key of ["xAxis", "yAxis", "radar"]) {
    const entryValue = (file as ChartOption)[key];
    const entries = entryValue === undefined ? [] : [entryValue].flat();
    for (const [index, entry] of entries.entries()) if (entry && typeof entry === "object" && ("data" in entry || "indicator" in entry)) issue([key, index], "Axis data is materialized from metric rows");
  }
  for (const [index, row] of file.dataset[0].source.entries()) {
    for (const field of dimensions) if (!Object.hasOwn(row, field)) issue(["dataset", 0, "source", index, field], "Snapshot row is missing a declared column");
    for (const field of Object.keys(row)) if (!dimensions.includes(field)) issue(["dataset", 0, "source", index, field], "Snapshot row contains an undeclared column");
  }
  const { dataset: _, ontomato: __, ...option } = file;
  for (const found of chartExecutionIssues(option as RuntimeJsonValue)) issue(found.path, found.message);
  for (const reference of chartColumnReferences(file)) if (!dimensions.includes(reference.column)) issue(reference.path, `Column is absent from metric dimensions: ${reference.column}`);
  for (const binding of bindings) if (binding.shape === "single" && !file.ontomato.display?.formats?.[binding.fields.value]) issue(["ontomato", "display", "formats", binding.fields.value], "Single values require an explicit format");
});
export type ChartSeries = z.infer<typeof seriesSchema> & ChartOption;
export type ChartFile = Omit<z.infer<typeof chartFileSchema>, "series"> & { series: ChartSeries[] } & ChartOption;

export function chartColumnReferences(file: z.infer<typeof fileBaseSchema>): { column: string; path: (string | number)[] }[] {
  const refs: { column: string; path: (string | number)[] }[] = [];
  for (const [index, series] of file.series.entries()) for (const [role, fields] of Object.entries(series.encode ?? {})) {
    for (const field of [fields].flat()) refs.push({ column: field, path: ["series", index, "encode", role] });
  }
  for (const [index, visual] of [(file as ChartOption).visualMap ?? []].flat().entries()) {
    if (typeof visual.dimension === "string") refs.push({ column: visual.dimension, path: ["visualMap", index, "dimension"] });
  }
  for (const [index, binding] of (file.ontomato.bindings ?? []).entries()) for (const [role, fields] of Object.entries(binding.fields)) {
    for (const field of [fields].flat()) refs.push({ column: field, path: ["ontomato", "bindings", index, "fields", role] });
  }
  for (const [index, sort] of (file.ontomato.display?.sort ?? []).entries()) refs.push({ column: sort.field, path: ["ontomato", "display", "sort", index, "field"] });
  for (const field of Object.keys(file.ontomato.display?.formats ?? {})) refs.push({ column: field, path: ["ontomato", "display", "formats", field] });
  return refs;
}
export function zodIssues(error: z.ZodError): ChartIssue[] {
  return error.issues.map(issue => ({ path: issue.path, reason: issue.code, message: issue.message }));
}
export function validateChartFile(input: unknown, columns?: readonly ChartMetricColumn[]): { ok: true; file: ChartFile } | ChartFailure {
  const parsed = chartFileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_CHART_FILE", issues: zodIssues(parsed.error), missingColumns: [] };
  if (columns) {
    const keys = new Set(columns.map(column => column.key));
    const missing = chartColumnReferences(parsed.data).filter(ref => !keys.has(ref.column));
    if (missing.length) return {
      ok: false, code: "CARD_OUTPUT_MISMATCH", missingColumns: [...new Set(missing.map(ref => ref.column))],
      issues: missing.map(ref => ({ path: ref.path, reason: "MISSING_COLUMN", message: `MetricView output is missing column: ${ref.column}` })),
    };
  }
  return { ok: true, file: parsed.data };
}

function storedChartIssues(file: ChartFile): ChartIssue[] {
  return [
    ...(file.dataset[0].source.length ? [{ path: ["dataset", 0, "source"], reason: "NONEMPTY_SNAPSHOT", message: "Stored chart files must have an empty source" }] : []),
    ...(Object.hasOwn(file.ontomato, "metric") ? [{ path: ["ontomato", "metric"], reason: "EMBEDDED_METRIC_REFERENCE", message: "The consumer owns the stored MetricView reference" }] : []),
    ...(Object.hasOwn(file.ontomato, "dataset") ? [{ path: ["ontomato", "dataset"], reason: "EMBEDDED_DATASET_REFERENCE", message: "Stored chart files cannot embed workspace dataset references" }] : []),
  ];
}

export const storedChartFileSchema = chartFileSchema.superRefine((file, context) => {
  for (const issue of storedChartIssues(file)) context.addIssue({ code: "custom", path: issue.path, message: issue.message });
});

/** Storage keeps presentation only; capability existence and execution belong to the caller. */
export function validateStoredChartFile(input: unknown, columns?: readonly ChartMetricColumn[]): { ok: true; file: ChartFile } | ChartFailure {
  const result = validateChartFile(input, columns);
  if (!result.ok) return result;
  const issues = storedChartIssues(result.file);
  return issues.length ? { ok: false, code: "INVALID_CHART_FILE", issues, missingColumns: [] } : result;
}

/** Split a conversation artifact without changing its snapshot or embedded reference in place. */
export function splitChartFileForStorage(input: unknown): { ok: true; file: ChartFile; metric: ChartMetricReference | undefined; dataset: ChartDatasetReference | undefined } | ChartFailure {
  const result = validateChartFile(input);
  if (!result.ok) return result;
  const metric = result.file.ontomato.metric;
  const dataset = result.file.ontomato.dataset;
  delete result.file.ontomato.metric;
  delete result.file.ontomato.dataset;
  result.file.dataset[0].source = [];
  return { ok: true, file: result.file, metric, dataset };
}
