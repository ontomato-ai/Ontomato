import { z } from "zod";

export const viewBindingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("literal"), value: z.unknown() }),
  z.object({ source: z.literal("object"), path: z.string().max(200) }),
  z.object({ source: z.literal("variable"), path: z.string().max(200) }),
  z.object({ source: z.literal("input"), path: z.string().max(200) }),
]);
export type ViewBinding = z.infer<typeof viewBindingSchema>;

export const viewConditionSchema = z.object({
  binding: viewBindingSchema,
  operator: z.enum(["eq", "ne", "present", "empty"]),
  value: z.string().max(1000).default(""),
});
export const viewWidgetSchema = z.object({
  id: z.string().min(1).max(100),
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,99}$/).optional(),
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
});
export type ViewWidget = z.infer<typeof viewWidgetSchema>;
const inputValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const inputNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(100).refine(value => !["__proto__", "constructor", "prototype"].includes(value));
export const viewInputSchema = z.object({
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().max(1000).default(""),
  required: z.boolean().default(false),
  default: inputValueSchema.optional(),
  enum: z.array(inputValueSchema).min(1).max(100).optional(),
}).superRefine((definition, context) => {
  const matches = (value: unknown) => value === null || typeof value === definition.type;
  if (definition.enum?.some(value => !matches(value))) context.addIssue({ code: "custom", message: "Input choices must match the declared type" });
  if (definition.default !== undefined && (!matches(definition.default) || (definition.enum && !definition.enum.includes(definition.default)))) context.addIssue({ code: "custom", message: "Invalid input default" });
});
export const objectViewDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  className: z.string().min(1).max(200),
  title: z.string().max(200),
  titleField: z.string().max(200).default(""),
  inputs: z.record(inputNameSchema, viewInputSchema).default({}),
  variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(100).refine(value => !["__proto__", "constructor", "prototype"].includes(value)), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  tabs: z.array(z.object({
    id: z.string().min(1).max(100),
    title: z.string().max(200),
    sections: z.array(z.object({
      id: z.string().min(1).max(100),
      title: z.string().max(200),
      widgets: z.array(viewWidgetSchema).max(100),
    })).min(1).max(30),
  })).min(1).max(20),
}).superRefine((document, context) => {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const tab of document.tabs) {
    for (const item of [tab, ...tab.sections, ...tab.sections.flatMap(section => section.widgets)]) {
      if (ids.has(item.id)) context.addIssue({ code: "custom", message: `Duplicate layout id: ${item.id}` });
      ids.add(item.id);
    }
    for (const widget of tab.sections.flatMap(section => section.widgets)) {
      const key = widget.key || widget.id;
      if (keys.has(key)) context.addIssue({ code: "custom", message: `Duplicate capability key: ${key}` });
      keys.add(key);
      for (const binding of [widget.binding, widget.visibleWhen?.binding, ...Object.values(widget.parameters)]) {
        if (binding?.source === "input" && !Object.hasOwn(document.inputs, binding.path.split(".")[0])) context.addIssue({ code: "custom", message: `Unknown input binding: ${binding.path}` });
      }
    }
  }
});
export type ObjectViewDocument = z.infer<typeof objectViewDocumentSchema>;
export type ObjectReference = { className: string; primaryKey: string };
export const objectViewReferenceSchema = z.object({
  className: z.string().min(1).max(200),
  form: z.enum(["full", "panel"]).default("full"),
  revision: z.union([z.literal("published"), z.number().int().positive()]).default("published"),
});
export const objectViewEmbedSchema = z.object({
  kind: z.literal("objectView"),
  view: objectViewReferenceSchema,
  object: z.object({ primaryKey: z.string().min(1).max(2000) }),
  inputs: z.record(inputNameSchema, inputValueSchema).default({}),
  navigation: z.enum(["host", "local"]).default("host"),
});
export type ObjectViewReference = z.infer<typeof objectViewReferenceSchema>;
export type ObjectViewEmbed = z.infer<typeof objectViewEmbedSchema>;
export type ObjectViewActionEvent = { id: string; reference: ObjectReference };
export type ObjectViewDependencies = { metricViews: string[]; actions: string[]; skills: string[]; classes: string[] };

export function objectViewDependencies(document: ObjectViewDocument): ObjectViewDependencies {
  const dependencies = { metricViews: new Set<string>(), actions: new Set<string>(), skills: new Set<string>(), classes: new Set([document.className]) };
  for (const widget of document.tabs.flatMap(tab => tab.sections.flatMap(section => section.widgets))) {
    if (widget.resourceId && ["metric", "table", "chart"].includes(widget.kind)) dependencies.metricViews.add(widget.resourceId);
    if (widget.resourceId && widget.kind === "action") dependencies.actions.add(widget.resourceId);
    if (widget.kind === "chart") dependencies.skills.add(widget.skillId);
    if (widget.targetClass) dependencies.classes.add(widget.targetClass);
  }
  return Object.fromEntries(Object.entries(dependencies).map(([key, values]) => [key, [...values].sort()])) as ObjectViewDependencies;
}

export class ObjectViewInputError extends Error {
  constructor(public readonly reason: "unknown" | "missing" | "invalid", public readonly inputName: string) {
    super(`${reason === "unknown" ? "Unknown" : reason === "missing" ? "Missing" : "Invalid"} view input: ${inputName}`);
  }
}

export function resolveViewInputs(document: ObjectViewDocument, supplied: Record<string, unknown> = {}): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const name of Object.keys(supplied)) if (!Object.hasOwn(document.inputs, name)) throw new ObjectViewInputError("unknown", name);
  for (const [name, definition] of Object.entries(document.inputs)) {
    const value = Object.hasOwn(supplied, name) ? supplied[name] : definition.default;
    if (value == null) {
      if (definition.required) throw new ObjectViewInputError("missing", name);
    } else if (typeof value !== definition.type || (typeof value === "number" && !Number.isFinite(value)) || (definition.enum && !definition.enum.includes(value as string | number | boolean))) {
      throw new ObjectViewInputError("invalid", name);
    }
    values[name] = value ?? null;
  }
  return values;
}
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
  return viewWidgetSchema.parse({ id: crypto.randomUUID(), kind, title: kind, span: kind === "metric" ? 4 : 12 });
}
export function createObjectView(className: string, title = className): ObjectViewDocument {
  return objectViewDocumentSchema.parse({
    schemaVersion: 1, className, title,
    tabs: [{ id: crypto.randomUUID(), title, sections: [{
      id: crypto.randomUUID(), title: "", widgets: [createViewWidget("properties")],
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
export function resolveViewBinding(binding: ViewBinding | undefined, object: Record<string, unknown>, variables: Record<string, unknown>, inputs: Record<string, unknown> = {}): unknown {
  if (!binding) return undefined;
  if (binding.source === "literal") return binding.value;
  return readViewPath(binding.source === "object" ? object : binding.source === "input" ? inputs : variables, binding.path);
}
export function viewConditionMatches(condition: ViewWidget["visibleWhen"], object: Record<string, unknown>, variables: Record<string, unknown>, inputs: Record<string, unknown> = {}): boolean {
  if (!condition) return true;
  const value = resolveViewBinding(condition.binding, object, variables, inputs);
  const empty = value == null || value === "";
  if (condition.operator === "present") return !empty;
  if (condition.operator === "empty") return empty;
  return condition.operator === "eq" ? String(value ?? "") === condition.value : String(value ?? "") !== condition.value;
}
