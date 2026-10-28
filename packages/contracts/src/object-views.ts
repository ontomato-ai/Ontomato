import { z } from "zod";

export const viewBindingSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("literal"), value: z.unknown() }),
  z.object({ source: z.literal("object"), path: z.string().max(200) }),
  z.object({ source: z.literal("variable"), path: z.string().max(200) }),
]);
export type ViewBinding = z.infer<typeof viewBindingSchema>;

export const viewConditionSchema = z.object({
  binding: viewBindingSchema,
  operator: z.enum(["eq", "ne", "present", "empty"]),
  value: z.string().max(1000).default(""),
});
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
    })).min(1).max(30),
  })).min(1).max(20),
}).superRefine((document, context) => {
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
export function resolveViewBinding(binding: ViewBinding | undefined, object: Record<string, unknown>, variables: Record<string, unknown>): unknown {
  if (!binding) return undefined;
  if (binding.source === "literal") return binding.value;
  return readViewPath(binding.source === "object" ? object : variables, binding.path);
}
export function viewConditionMatches(condition: ViewWidget["visibleWhen"], object: Record<string, unknown>, variables: Record<string, unknown>): boolean {
  if (!condition) return true;
  const value = resolveViewBinding(condition.binding, object, variables);
  const empty = value == null || value === "";
  if (condition.operator === "present") return !empty;
  if (condition.operator === "empty") return empty;
  return condition.operator === "eq" ? String(value ?? "") === condition.value : String(value ?? "") !== condition.value;
}
