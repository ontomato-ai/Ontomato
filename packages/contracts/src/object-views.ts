import { z } from "zod";
import { randomId } from "./random-id";

export const viewBindingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("literal"), value: z.unknown() }).strict(),
  z.object({ source: z.literal("object"), path: z.string().max(200) }).strict(),
  z.object({ source: z.literal("variable"), path: z.string().max(200) }).strict(),
  z.object({ source: z.literal("context"), path: z.enum(["primaryKey", "className"]) }).strict(),
]);
export type ViewBinding = z.infer<typeof viewBindingSchema>;

export const viewConditionSchema = z.object({
  binding: viewBindingSchema,
  operator: z.enum(["eq", "ne", "present", "empty"]),
  value: z.string().max(1000).default(""),
}).strict();
export const viewWidgetSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(["text", "properties", "metric", "table", "chart", "links", "input", "action", "button"]),
  title: z.string().max(200),
  span: z.number().int().min(1).max(12),
  height: z.number().int().min(80).max(1200).default(240),
  fields: z.array(z.string().max(200)).max(100).default([]),
  fieldOptions: z.record(z.string().max(200), z.array(z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) })).min(1).max(100)).default({}),
  fieldLabels: z.record(z.string().max(200), z.string().max(200)).default({}),
  readOnlyParameters: z.array(z.string().max(200)).max(100).default([]),
  contextFields: z.array(z.string().max(200)).max(100).default([]),
  text: z.string().max(10000).default(""),
  binding: viewBindingSchema.optional(),
  visibleWhen: viewConditionSchema.optional(),
  resourceId: z.string().max(200).default(""),
  skillId: z.string().max(200).default("echarts"),
  parameters: z.record(z.string().max(200), viewBindingSchema).default({}),
  resultPath: z.string().max(200).default(""),
  resultIndex: z.number().int().nonnegative().max(10000).default(0),
  valueField: z.string().max(200).default(""),
  labelField: z.string().max(200).default(""),
  chartType: z.enum(["bar", "line", "donut", "timeline", "graph", "leaflet-map"]).default("bar"),
  latitudeField: z.string().max(200).default("latitude"),
  longitudeField: z.string().max(200).default("longitude"),
  dateField: z.string().max(200).default(""),
  descriptionField: z.string().max(200).default(""),
  relation: z.string().max(200).default(""),
  direction: z.enum(["outgoing", "incoming"]).default("outgoing"),
  variable: z.string().max(100).refine(value => !value || (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value))).default(""),
  onClick: z.enum(["refresh", "setVariable", "openObject"]).default("refresh"),
  targetClass: z.string().max(200).default(""),
}).strict();
export type ViewWidget = z.infer<typeof viewWidgetSchema>;
export const objectViewDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  className: z.string().min(1).max(200),
  title: z.string().max(200),
  titleField: z.string().max(200).default(""),
  variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(100).refine(value => !["__proto__", "constructor", "prototype"].includes(value)), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  tabs: z.array(z.object({
    id: z.string().min(1).max(100),
    title: z.string().max(200),
    sections: z.array(z.object({
      id: z.string().min(1).max(100),
      title: z.string().max(200),
      widgets: z.array(viewWidgetSchema).max(100),
    }).strict()).min(1).max(30),
  }).strict()).min(1).max(20),
}).strict().superRefine((document, context) => {
  const ids = new Set<string>();
  for (const tab of document.tabs) {
    for (const item of [tab, ...tab.sections, ...tab.sections.flatMap(section => section.widgets)]) {
      if (ids.has(item.id)) context.addIssue({ code: "custom", message: `Duplicate layout id: ${item.id}` });
      ids.add(item.id);
    }
  }
});
export type ObjectViewDocument = z.infer<typeof objectViewDocumentSchema>;
export type ObjectReference = { className: string; primaryKey: string };
export type ObjectViewVersion = {
  revision: number;
  createdAt: number;
  author: string;
  description: string;
  document: ObjectViewDocument;
};
export type ObjectViewState = {
  revision: number;
  publishedRevision: number | null;
  versions: ObjectViewVersion[];
};

export function createViewWidget(kind: ViewWidget["kind"]): ViewWidget {
  const sizes = {
    text: { span: 12, height: 120 }, properties: { span: 12, height: 240 },
    metric: { span: 4, height: 80 }, table: { span: 12, height: 360 },
    chart: { span: 6, height: 320 }, links: { span: 12, height: 360 },
    input: { span: 6, height: 80 }, action: { span: 4, height: 80 }, button: { span: 4, height: 80 },
  };
  return viewWidgetSchema.parse({ id: randomId(), kind, title: kind, ...sizes[kind] });
}
export function createObjectView(className: string, title = className): ObjectViewDocument {
  return objectViewDocumentSchema.parse({
    schemaVersion: 1, className, title,
    tabs: [{ id: randomId(), title, sections: [{
      id: randomId(), title: "", widgets: [createViewWidget("properties")],
    }] }],
  });
}

/** Bindings traverse own properties only; configuration never executes JavaScript. */
export function readViewPath(value: unknown, path: string): unknown {
  if (!path) return value;
  for (const key of path.split(".")) {
    if (["__proto__", "prototype", "constructor"].includes(key) || value === null || typeof value !== "object") return undefined;
    // Track missing keys on reactive records so later row selections update conditions.
    const next = (value as Record<string, unknown>)[key];
    if (!Object.hasOwn(value, key)) return undefined;
    value = next;
  }
  return value;
}
export function resolveViewBinding(binding: ViewBinding | undefined, object: Record<string, unknown>, variables: Record<string, unknown>, reference?: ObjectReference): unknown {
  if (!binding) return undefined;
  if (binding.source === "literal") return binding.value;
  if (binding.source === "context") return reference?.[binding.path];
  return readViewPath(binding.source === "object" ? object : variables, binding.path);
}
/** A component's MetricView or Action parameter values, each binding resolved against the object and the variables. */
export function resolveViewParameters(parameters: ViewWidget["parameters"], object: Record<string, unknown>, variables: Record<string, unknown>, reference?: ObjectReference): Record<string, unknown> {
  return Object.fromEntries(Object.entries(parameters).map(([name, binding]) => [name, resolveViewBinding(binding, object, variables, reference)]));
}

/** Legacy documents remain readable; authoring and product admission enforce this boundary. */
export function objectViewProductIssues(document: ObjectViewDocument): string[] {
  return document.tabs.flatMap(tab => tab.sections.flatMap(section => section.widgets.flatMap(widget => {
    const issues: string[] = [];
    if (widget.visibleWhen && !(widget.visibleWhen.binding.source === "variable" && !widget.visibleWhen.binding.path.includes(".") && ["present", "empty"].includes(widget.visibleWhen.operator))) issues.push("Visibility only checks presence of a local interaction variable; move business comparisons to a capability");
    if (widget.binding?.source === "object" || Object.values(widget.parameters).some(binding => binding.source === "object")) issues.push("Bind the selected object with context.primaryKey, not object properties");
    if (["properties", "links", "metric", "table", "chart", "action"].includes(widget.kind) && !widget.resourceId) issues.push("Bind a published capability before saving this view");
    if (widget.resultPath || (widget.binding && ["properties", "links", "metric", "table", "chart", "action"].includes(widget.kind))) issues.push("Capability results cannot be replaced or transformed by view bindings");
    if (widget.contextFields.length) issues.push("Use a MetricView to display Action context");
    return issues.map(issue => `${widget.id}: ${issue}`);
  })));
}
export function viewConditionMatches(condition: ViewWidget["visibleWhen"], object: Record<string, unknown>, variables: Record<string, unknown>): boolean {
  if (!condition) return true;
  const value = resolveViewBinding(condition.binding, object, variables);
  const empty = value == null || value === "";
  if (condition.operator === "present") return !empty;
  if (condition.operator === "empty") return empty;
  return condition.operator === "eq" ? String(value ?? "") === condition.value : String(value ?? "") !== condition.value;
}
