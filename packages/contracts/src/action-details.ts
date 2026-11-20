import { z } from "zod";
import { runtimeJsonValueSchema, type RuntimeJsonValue } from "./agent-runtime-values";

const text = z.string();
const kindLabel = text.min(1);
const lineRange = z.object({ start: z.number().int().positive(), end: z.number().int().positive() })
  .strict().refine(({ start, end }) => start <= end, { path: ["end"], message: "The last line must follow the first line" });

const assignment = z.object({ field: text.min(1), valueFrom: text.min(1) }).strict();

export const actionCodeSegmentKindSchema = z.enum([
  "QUERY", "CREATE_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT", "CREATE_EDGE", "DELETE_EDGE",
  "APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR", "COMPUTE", "EXTERNAL_CALL",
  "BRANCH", "LOOP", "TRY_CATCH", "ERROR_HANDLING", "CUSTOM",
]);

export type ActionExplanationCondition =
  | { properties: ActionExplanationCondition }
  | { operator: "logic"; and?: ActionExplanationCondition[] | null; or?: ActionExplanationCondition[] | null }
  | { field: string; operator: string; value?: RuntimeJsonValue };

const condition: z.ZodType<ActionExplanationCondition> = z.lazy(() => z.union([
  z.object({ properties: condition }),
  z.object({ operator: z.literal("logic"), and: z.array(condition).nullish(), or: z.array(condition).nullish() }),
  z.object({ field: text.min(1), operator: text.min(1), value: runtimeJsonValueSchema.optional() }),
]));

const queryFilters = z.object({
  objects: z.array(z.object({ alias: text.min(1), class: text.min(1), conditions: condition.nullish() })),
  relationship: z.array(z.object({ from: text.min(1), to: text.min(1), type: text.min(1) })).nullish(),
});

const outputField = z.object({ source: text.min(1), field: text.min(1) });
const limitBound = z.union([z.number().int(), text.min(1)]);
const queryOutput = z.object({
  fields: z.array(outputField).nullish(),
  group_by: z.array(outputField).nullish(),
  sort: z.array(outputField.extend({ order: text.min(1) })).nullish(),
  limit: z.object({ offset: limitBound.nullish(), count: limitBound.nullish() }).nullish(),
});

const segment = z.object({
  id: text.min(1),
  kind: actionCodeSegmentKindSchema,
  kindLabel,
  title: text.min(1),
  codeRange: lineRange,
  narrative: text.nullish(),
  class: text.nullish(),
  relation: text.nullish(),
  sourceClass: text.nullish(),
  sourceObjectIdFrom: text.nullish(),
  targetClass: text.nullish(),
  targetObjectIdFrom: text.nullish(),
  attrName: text.nullish(),
  objectIdFrom: text.nullish(),
  fileIdFrom: text.nullish(),
  textFrom: text.nullish(),
  estRows: z.union([text, z.number()]).nullish(),
  assignments: z.array(assignment).nullish(),
  conditions: condition.nullish(),
  filters: queryFilters.nullish(),
  output: queryOutput.nullish(),
});

export type ActionCodeSegment = z.infer<typeof segment> & {
  segs?: ActionCodeSegment[] | null;
  trySegs?: ActionCodeSegment[] | null;
  catchs?: { error: string; segs: ActionCodeSegment[] }[] | null;
  branchArms?: { condition: string; segs: ActionCodeSegment[] }[] | null;
};

/** The stored segment tree with read-time labels supplied by the Java action owner. */
export const actionCodeSegmentSchema: z.ZodType<ActionCodeSegment> = z.lazy(() => segment.extend({
  segs: z.array(actionCodeSegmentSchema).nullish(),
  trySegs: z.array(actionCodeSegmentSchema).nullish(),
  catchs: z.array(z.object({ error: text.min(1), segs: z.array(actionCodeSegmentSchema) })).nullish(),
  branchArms: z.array(z.object({ condition: text.min(1), segs: z.array(actionCodeSegmentSchema) })).nullish(),
}));

const businessMeaning = z.object({ operations: z.array(text), negativeEffect: text }).strict();

export const actionExplanationSchema = z.object({
  code: text.nullable(),
  codeHash: text.nullish(),
  explanationVersion: z.number().int().positive().nullish(),
  codeSegments: z.array(actionCodeSegmentSchema).nullable(),
  businessMeaning: businessMeaning.nullish(),
}).strict();
export type ActionExplanation = z.infer<typeof actionExplanationSchema>;

const effectKind = actionCodeSegmentKindSchema.extract([
  "CREATE_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT", "CREATE_EDGE", "DELETE_EDGE",
  "APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR", "EXTERNAL_CALL",
]);

const effect = z.object({
  kind: effectKind,
  kindLabel,
  title: text.optional(),
  className: text.nullish(),
  relation: text.nullish(),
  sourceClass: text.nullish(),
  targetClass: text.nullish(),
  attrName: text.nullish(),
  assignments: z.array(assignment).optional(),
  objectIdFrom: text.optional(),
  sourceObjectIdFrom: text.optional(),
  targetObjectIdFrom: text.optional(),
  fileIdFrom: text.optional(),
  textFrom: text.optional(),
  guards: condition.optional(),
  narrative: text.optional(),
}).strict();

const submissionCondition = z.object({
  objectParameter: text,
  className: text,
  field: text,
  operator: text,
  value: runtimeJsonValueSchema.optional(),
  description: text.nullish(),
  message: text.nullish(),
  failureMessage: text.nullish(),
}).catchall(runtimeJsonValueSchema);

const submissionCriteria = z.object({
  source: text.optional(),
  verified: z.boolean().optional(),
  operator: text.nullish(),
  conditions: z.array(submissionCondition).nullish(),
  unrepresentable: z.array(z.object({ description: text, reason: text })).nullish(),
}).catchall(runtimeJsonValueSchema);

const outputKeyRef = z.object({
  key: text.nullish(),
  className: text.nullish(),
  attrName: text.nullish(),
  asGroupBy: z.boolean().nullish(),
  statCal: z.boolean().nullish(),
}).strict();

/** The Java owner's descriptive projection of a saved action. */
export const actionDefinitionSchema = z.object({
  version: z.literal(1),
  source: z.literal("DERIVED"),
  verified: z.literal(false),
  name: text,
  description: text.nullish(),
  codeHash: text.nullish(),
  explanationVersion: z.number().int().positive().nullish(),
  declaredTarget: z.object({ className: text, keyParameter: text }).strict().optional(),
  execution: z.object({ kind: z.literal("FUNCTION"), operation: text.nullish() }).strict().optional(),
  parameters: z.array(z.object({
    name: text,
    type: text,
    description: text.nullish(),
    sample: runtimeJsonValueSchema.optional(),
    objectTypes: z.array(text).nullish(),
    required: z.boolean().nullish(),
    constraints: runtimeJsonValueSchema.optional(),
  }).strict()).optional(),
  returnDef: z.object({
    isVoid: z.boolean().nullish(), classNames: z.array(text).nullish(), outKeyRefs: z.array(outputKeyRef).nullish(),
  }).strict().nullish(),
  submissionCriteria: submissionCriteria.optional(),
  effects: z.array(effect).optional(),
  affects: z.array(text).optional(),
  reads: z.array(z.object({ className: text.nullish(), conditions: condition.optional(), filters: queryFilters.optional() }).strict()).optional(),
  objects: z.array(text).optional(),
  target: z.object({
    objectType: text, operation: effectKind.extract(["CREATE_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT"]),
  }).strict().nullish(),
  businessMeaning: businessMeaning.optional(),
}).strict();
export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;
