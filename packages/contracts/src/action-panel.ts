import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema, type RuntimeJsonValue } from "./agent-runtime-values";

/*
 * What an Action panel reads about one saved Action besides its record and form: the definition the data engine derives
 * from the Action's explained code, and that explanation itself. The data engine owns both and names every kind in the
 * reader's language; a panel draws them and does not validate them again. The explanation comes from a model and the
 * engine checks only the fields it uses, so a segment may carry more fields than are listed here.
 */

/** The kinds a code segment can have, as the data engine's explanation validator accepts them. */
export const actionSegmentKindSchema = z.enum([
  "QUERY", "CREATE_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT", "CREATE_EDGE", "DELETE_EDGE", "APPEND_VECTOR",
  "UPDATE_VECTOR", "DELETE_VECTOR", "COMPUTE", "EXTERNAL_CALL", "BRANCH", "LOOP", "TRY_CATCH", "ERROR_HANDLING", "CUSTOM",
]);
export type ActionSegmentKind = z.infer<typeof actionSegmentKindSchema>;

const text = z.string();
const kindLabel = z.string().min(1);

/** Further JSON fields a model wrote into an explained part, kept as they are. */
type Details = { [detail: string]: RuntimeJsonValue };

export type ActionCodeSegment = {
  id: string;
  kind: ActionSegmentKind;
  /** The owner's name for the kind in the reader's language. */
  kindLabel: string;
  title: string;
  codeRange: { start: number; end: number };
  segs?: ActionCodeSegment[];
  trySegs?: ActionCodeSegment[];
  catchs?: ({ error: string; segs: ActionCodeSegment[] } & Details)[];
  branchArms?: ({ condition: string; segs: ActionCodeSegment[] } & Details)[];
} & Details;

/** One explained part of the saved code, by its line range; nested parts sit at any depth. */
export const actionCodeSegmentSchema: z.ZodType<ActionCodeSegment> = z.lazy(() => z.object({
  id: z.string().min(1),
  kind: actionSegmentKindSchema,
  kindLabel,
  title: z.string().min(1),
  codeRange: z.object({ start: z.number().int().min(1), end: z.number().int().min(1) }).strict(),
  estRows: z.union([z.string(), z.number()]).optional(),
  assignments: z.array(z.object({ field: z.string().min(1), valueFrom: z.string().min(1) }).catchall(runtimeJsonValueSchema)).optional(),
  narrative: text.optional(),
  class: text.optional(),
  relation: text.optional(),
  sourceClass: text.optional(),
  sourceObjectIdFrom: text.optional(),
  targetClass: text.optional(),
  targetObjectIdFrom: text.optional(),
  attrName: text.optional(),
  objectIdFrom: text.optional(),
  fileIdFrom: text.optional(),
  textFrom: text.optional(),
  conditions: runtimeJsonValueSchema.optional(),
  filters: runtimeJsonObjectSchema.optional(),
  output: runtimeJsonObjectSchema.optional(),
  segs: z.array(actionCodeSegmentSchema).optional(),
  trySegs: z.array(actionCodeSegmentSchema).optional(),
  catchs: z.array(z.object({ error: z.string().min(1), segs: z.array(actionCodeSegmentSchema) }).catchall(runtimeJsonValueSchema)).optional(),
  branchArms: z.array(z.object({ condition: z.string().min(1), segs: z.array(actionCodeSegmentSchema) }).catchall(runtimeJsonValueSchema)).optional(),
}).catchall(runtimeJsonValueSchema));

/** What the Action means to the business: the operations it performs and what goes wrong for whom. */
export const actionBusinessMeaningSchema = z.object({
  operations: z.array(z.string()),
  negativeEffect: z.string(),
}).strict();

/**
 * The saved explanation of an Action's code. A saved Action may predate its explanation, so the code, its hash and the
 * explanation version can be absent and the segments empty.
 */
export const actionExplanationSchema = z.object({
  code: z.string().optional(),
  codeHash: z.string().min(1).optional(),
  explanationVersion: z.number().int().optional(),
  codeSegments: z.array(actionCodeSegmentSchema),
  businessMeaning: actionBusinessMeaningSchema.optional(),
}).strict();
export type ActionExplanation = z.infer<typeof actionExplanationSchema>;

/** One write the Action's explained code performs, as the data engine derives it from a segment of a writing kind. */
export const actionDerivedEffectSchema = z.object({
  kind: actionSegmentKindSchema.extract([
    "CREATE_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT", "CREATE_EDGE", "DELETE_EDGE", "APPEND_VECTOR", "UPDATE_VECTOR",
    "DELETE_VECTOR", "EXTERNAL_CALL",
  ]),
  kindLabel,
  title: text.optional(),
  className: text.nullish(),
  assignments: runtimeJsonValueSchema.optional(),
  objectIdFrom: text.optional(),
  guards: runtimeJsonValueSchema.optional(),
  relation: text.nullish(),
  sourceClass: text.nullish(),
  targetClass: text.nullish(),
  sourceObjectIdFrom: text.optional(),
  targetObjectIdFrom: text.optional(),
  attrName: text.nullish(),
  fileIdFrom: text.optional(),
  textFrom: text.optional(),
  narrative: text.optional(),
}).catchall(runtimeJsonValueSchema);

/** One submission condition: a field of the target compared with a literal value; it has no kind. */
export const actionSubmissionConditionSchema = z.object({
  objectParameter: text.nullish(),
  className: text.nullish(),
  field: text.nullish(),
  operator: text.nullish(),
  value: runtimeJsonValueSchema.optional(),
  description: text.nullish(),
  message: text.nullish(),
  failureMessage: text.nullish(),
}).catchall(runtimeJsonValueSchema);

/**
 * The definition the data engine derives from a saved Action's explained code. It describes the code and does not
 * constrain it: `source` is always `DERIVED` and `verified` false. An Action without its function has only the header.
 */
export const actionDefinitionSchema = z.object({
  version: z.literal(1),
  source: z.literal("DERIVED"),
  verified: z.literal(false),
  name: z.string(),
  description: text.nullish(),
  codeHash: text.nullish(),
  explanationVersion: z.number().int().nullish(),
  declaredTarget: z.object({ className: z.string().min(1), keyParameter: z.string().min(1) }).catchall(runtimeJsonValueSchema).nullish(),
  execution: z.object({ kind: z.literal("FUNCTION"), operation: text.nullish() }).strict().optional(),
  parameters: z.array(z.object({
    name: z.string().min(1),
    type: z.string().min(1),
    description: text.nullish(),
    sample: runtimeJsonValueSchema.optional(),
    objectTypes: z.array(z.string()).nullish(),
    required: z.null().optional(),
    constraints: z.null().optional(),
  }).strict()).optional(),
  returnDef: z.object({
    isVoid: z.boolean().nullish(),
    classNames: z.array(z.string()).nullish(),
    outKeyRefs: runtimeJsonValueSchema.optional(),
  }).strict().nullish(),
  submissionCriteria: z.object({
    conditions: z.array(actionSubmissionConditionSchema).nullish(),
    source: z.string(),
    verified: z.boolean(),
  }).catchall(runtimeJsonValueSchema).optional(),
  effects: z.array(actionDerivedEffectSchema).optional(),
  affects: z.array(z.string()).optional(),
  reads: z.array(runtimeJsonObjectSchema).optional(),
  objects: z.array(z.string()).optional(),
  target: z.object({ objectType: z.string().min(1), operation: z.string().min(1) }).strict().nullish(),
  businessMeaning: actionBusinessMeaningSchema.optional(),
}).strict();
export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;
