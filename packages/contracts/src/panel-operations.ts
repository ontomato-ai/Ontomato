import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema, runtimeKeySchema } from "./agent-runtime-values";
import { panelDownloadReceiptSchema } from "./panel-download";
import { panelFormTargetSchema, panelObjectIdentitySchema, panelObjectRefSchema, panelOperationCallSchema } from "./panel-manifest";
import {
  panelFormDescriptionSchema, panelFormValuesSchema, panelGroupCountsSchema, panelOptionListSchema,
  panelRecordListSchema, panelRecordQuerySchema, panelRecordSchema, panelRelationNeighborsSchema,
} from "./panel-projection";
import { actionDefinitionSchema, actionExplanationSchema } from "./action-panel";
import { chartProjectionTemplateSchema, dashboardMetricOutputSchema } from "./dashboard";
import { appsSdkComponentCatalogEntrySchema } from "./apps-sdk";
import {
  applicationEntryMenuSchema, currentPanelRecordSchema, currentProjectionRecordSchema,
  productPanelListResponseSchema, productPanelUsedBySchema, productProjectionListResponseSchema, productProjectionUsedBySchema,
} from "./product-panels";
import { applicationCatalogueEntriesSchema, applicationCatalogueQueryResultSchema, applicationCatalogueRecordSchema } from "./application-catalogue";
import { panelManifestSchema } from "./panel-manifest";
import { platformOntologySchemaResponseSchema } from "./platform-ontology";
import {
  platformOntologyCountsResponseSchema, platformOntologyNeighborsResponseSchema, platformOntologyObjectsResponseSchema,
  platformOntologyStartResponseSchema,
} from "./platform-ontology-data";
import { productCatalogueGrantsSchema } from "./product-governance";
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

const sdkComponentDefinitionSchema: z.ZodType<z.infer<typeof runtimeJsonObjectSchema>> =
  z.lazy(() => appsSdkComponentCatalogEntrySchema);

/** Result schema identifiers used by the registered read declarations. */
export const panelReadResultSchemas = {
  panelRecordList: panelRecordListSchema,
  panelRecord: panelRecordSchema,
  panelRecordQuery: panelRecordQuerySchema,
  panelGroupCounts: panelGroupCountsSchema,
  panelApplicationMenu: applicationEntryMenuSchema,
  productProjectionList: productProjectionListResponseSchema,
  productPanelList: productPanelListResponseSchema,
  productProjectionRecord: currentProjectionRecordSchema,
  productPanelRecord: currentPanelRecordSchema,
  productProjectionUsedBy: productProjectionUsedBySchema,
  productPanelUsedBy: productPanelUsedBySchema,
  productPanelMembers: panelManifestSchema.innerType().shape.members,
  productCatalogueGrants: productCatalogueGrantsSchema,
  applicationCatalogue: applicationCatalogueQueryResultSchema,
  applicationRecord: applicationCatalogueRecordSchema,
  applicationEntries: applicationCatalogueEntriesSchema,
  panelFormDescription: panelFormDescriptionSchema,
  panelOperationDescriptor: panelOwnerOperationDescriptorSchema,
  panelOptionList: panelOptionListSchema,
  // The graph schema also describes the reads registered here. Resolve its validators on access.
  get panelGraphSchema() { return platformOntologySchemaResponseSchema; },
  panelGraphCounts: platformOntologyCountsResponseSchema,
  panelGraphStart: platformOntologyStartResponseSchema,
  panelGraphNeighbors: platformOntologyNeighborsResponseSchema,
  panelOntologyObjects: platformOntologyObjectsResponseSchema,
  panelRelationNeighbors: panelRelationNeighborsSchema,
  chartTemplate: chartProjectionTemplateSchema,
  metricOutput: dashboardMetricOutputSchema,
  sdkComponentDefinition: sdkComponentDefinitionSchema,
  actionDefinition: actionDefinitionSchema,
  actionExplanation: actionExplanationSchema,
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

/** A read passes the actual target and the input object declared by the operation's owner. */
export const panelReadOperationCallSchema = z.object({
  target: panelFormTargetSchema.optional(),
  input: runtimeJsonObjectSchema,
}).strict();

/** The JSON success body of a read. File-producing reads send bytes with attachment headers. */
export const panelReadOperationJsonResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("markdown"), markdown: z.string() }).strict(),
  z.object({ kind: z.literal("json"), value: runtimeJsonValueSchema }).strict(),
]);
export const panelReadOperationResultSchema = z.union([panelReadOperationJsonResultSchema, panelDownloadReceiptSchema]);
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
