import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema, runtimeKeySchema } from "./agent-runtime-values";
import { panelObjectIdentitySchema, panelObjectRefSchema, panelOperationCallSchema } from "./panel-manifest";
import {
  panelFormDescriptionSchema, panelFormValuesSchema, panelGroupCountsSchema, panelOptionListSchema,
  panelRecordListSchema, panelRecordQuerySchema, panelRecordSchema, panelRelationNeighborsSchema,
} from "./panel-projection";
import { chartProjectionTemplateSchema, dashboardMetricOutputSchema } from "./dashboard";
import { applicationEntryMenuSchema } from "./product-panels";
import {
  platformOntologyCountsResponseSchema, platformOntologyNeighborsResponseSchema, platformOntologyObjectsResponseSchema,
  platformOntologySchemaResponseSchema, platformOntologyStartResponseSchema,
} from "./platform-ontology";
import type { PanelReadResultId } from "./platform-object-types";

const inputTarget = z.object({ source: z.literal("input"), input: runtimeKeySchema }).strict();
const draftTarget = z.object({ source: z.literal("draft") }).strict();
const noTarget = z.object({ source: z.literal("none") }).strict();

/** A draft has no concrete member until a panel places its form. */
export const panelOperationDeclarationTargetSchema = z.discriminatedUnion("source", [inputTarget, draftTarget, noTarget]);

export const panelOwnerOperationTargetSchema = z.discriminatedUnion("source", [
  inputTarget,
  draftTarget.extend({ slot: runtimeKeySchema }),
  z.object({ source: z.literal("literal"), literal: panelObjectRefSchema }).strict(),
  noTarget,
]);

/** Static authoring metadata derived from the operation's owner registration. */
export const panelOperationDeclarationSchema = z.object({
  id: z.string().min(1).max(300),
  kind: z.enum(["form.save", "action"]),
  effect: z.enum(["read", "write"]),
  target: panelOperationDeclarationTargetSchema,
  inputSchema: runtimeJsonObjectSchema,
  batch: z.boolean(),
}).strict();
export type PanelOperationDeclaration = z.infer<typeof panelOperationDeclarationSchema>;

/** The trusted owner supplies the effect and schemas. Requests carry only the operation identity and input. */
export const panelOwnerOperationDescriptorSchema = panelOperationDeclarationSchema.omit({ id: true }).extend({
  handlerRef: panelOperationDeclarationSchema.shape.id,
  /** Display text supplied by the owner in the reader's locale. */
  label: z.string().min(1).max(200),
  target: panelOwnerOperationTargetSchema,
  resultSchema: runtimeJsonObjectSchema,
  /** The owner handler shared by human and agent confirmation. */
  inspectImpact: z.object({ handlerRef: z.string().min(1).max(300) }).strict().optional(),
});
export type PanelOwnerOperationDescriptor = z.infer<typeof panelOwnerOperationDescriptorSchema>;

/** Combine the same declaration shown to authors with facts of the admitted runtime operation. */
export function describePanelOperationFromDeclaration(
  { id, target, ...staticFields }: PanelOperationDeclaration,
  { handlerRef = id, slot, target: placedTarget, ...runtime }: Pick<PanelOwnerOperationDescriptor, "label" | "resultSchema" | "inspectImpact"> & {
    handlerRef?: string;
    slot?: string;
    target?: PanelOwnerOperationDescriptor["target"];
  },
): PanelOwnerOperationDescriptor {
  return panelOwnerOperationDescriptorSchema.parse({
    ...staticFields, ...runtime, handlerRef,
    target: placedTarget ?? (target.source === "draft" ? { ...target, slot } : target),
  });
}

export const panelReadOperationDescriptorSchema = panelOwnerOperationDescriptorSchema.extend({
  effect: z.literal("read"),
  batch: z.literal(false),
});

/** Result schema identifiers used by the registered read declarations. */
export const panelReadResultSchemas = {
  panelRecordList: panelRecordListSchema,
  panelRecord: panelRecordSchema,
  panelRecordQuery: panelRecordQuerySchema,
  panelGroupCounts: panelGroupCountsSchema,
  panelApplicationMenu: applicationEntryMenuSchema,
  panelFormDescription: panelFormDescriptionSchema,
  panelOperationDescriptor: panelOwnerOperationDescriptorSchema,
  panelOptionList: panelOptionListSchema,
  panelGraphSchema: platformOntologySchemaResponseSchema,
  panelGraphCounts: platformOntologyCountsResponseSchema,
  panelGraphStart: platformOntologyStartResponseSchema,
  panelGraphNeighbors: platformOntologyNeighborsResponseSchema,
  panelOntologyObjects: platformOntologyObjectsResponseSchema,
  panelRelationNeighbors: panelRelationNeighborsSchema,
  chartTemplate: chartProjectionTemplateSchema,
  metricOutput: dashboardMetricOutputSchema,
};

export const panelReadResultIdSchema = z.custom<PanelReadResultId>(
  value => typeof value === "string" && Object.hasOwn(panelReadResultSchemas, value),
  "Expected a registered panel read result ID",
);

/** A read-only trial takes the current form values plus the execution parameter values. */
export const panelReadOperationInputSchema = z.object({
  draft: panelFormValuesSchema,
  parameters: runtimeJsonObjectSchema,
  bindingId: runtimeKeySchema.optional(),
}).strict();

export const panelReadOperationCallSchema = panelOperationCallSchema.omit({ draft: true }).extend({
  input: panelReadOperationInputSchema,
});

/** A read returns content for this panel instance. */
export const panelReadOperationResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("markdown"), markdown: z.string() }).strict(),
  z.object({ kind: z.literal("json"), value: runtimeJsonValueSchema }).strict(),
]);
export type PanelReadOperationResult = z.infer<typeof panelReadOperationResultSchema>;


/** One call or a nonempty set of concrete calls belonging to the same operation and execution identity. */
const panelBatchOperationCallSchema = panelOperationCallSchema.omit({ draft: true }).extend({
  target: panelObjectIdentitySchema.extend({ kind: z.literal("object") }),
});
export const panelSingleInvocationSchema = z.object({ call: panelOperationCallSchema }).strict();
export const panelBatchInvocationSchema = z.object({ calls: z.array(panelBatchOperationCallSchema).nonempty() }).strict();

export const panelOperationImpactSchema = z.object({
  summary: z.string(),
  /** Total affected records, including any whose names are omitted from the preview. */
  total: z.number().int().safe().nonnegative(),
  objects: z.array(z.object({
    target: panelObjectIdentitySchema,
    label: z.string(),
  }).strict()),
}).strict();
export type PanelOperationImpact = z.infer<typeof panelOperationImpactSchema>;

export const panelOperationAffectedSchema = z.object({
  objects: z.array(panelObjectIdentitySchema),
  objectTypes: z.array(runtimeKeySchema),
}).strict();
export type PanelOperationAffected = z.infer<typeof panelOperationAffectedSchema>;
