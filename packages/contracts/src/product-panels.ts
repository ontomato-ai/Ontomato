import { z } from "zod";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";
import { ontologyParameterTypeSchema } from "./product-projections";

const id = z.string().min(1).max(200);
const path = z.string().regex(/^\/(?!\/)/);

/** Platform object IDs and fixed operation IDs are defined by their capability owners. */
export const ontologyElementRefSchema = z.object({
  kind: z.enum(["MetricView", "Action", "ObjectType", "Definition", "PlatformOperation"]),
  id,
}).strict();
export type OntologyElementRef = z.infer<typeof ontologyElementRefSchema>;

const editableDefinitionFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  visibility: z.enum(["private", "domain"]),
};

const currentRecordFields = {
  id,
  domainId: id,
  ownerId: id,
  /** Compare on save only; this does not identify a retained or published definition. */
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  editable: z.boolean(),
};

/** Component-specific display validation belongs to the registered SDK component. */
export const productProjectionInputSchema = z.object({
  ...editableDefinitionFields,
  componentId: id,
  binding: ontologyElementRefSchema,
  inputs: z.record(id, ontologyParameterTypeSchema),
  display: z.record(z.unknown()),
}).strict();
export type ProductProjectionInput = z.infer<typeof productProjectionInputSchema>;

export const productProjectionSchema = productProjectionInputSchema.extend(currentRecordFields).strict();
export type ProductProjection = z.infer<typeof productProjectionSchema>;

/** Locations in the existing product file storage, not application routes or inline copies. */
export const productPanelContentSchema = z.object({
  html: z.string().min(1),
  module: z.string().min(1),
  recipes: z.string().min(1).optional(),
}).strict();
export type ProductPanelContent = z.infer<typeof productPanelContentSchema>;

export const productPanelInputSchema = z.object({
  ...editableDefinitionFields,
  content: productPanelContentSchema,
  // TODO(P2): use panelManifestSchema from "./panel-manifest" after the contract handoff.
  // This contract-only placeholder defines no manifest format and accepts no registrations.
  manifest: z.never(),
}).strict();
export type ProductPanelInput = z.infer<typeof productPanelInputSchema>;

export const productPanelSchema = productPanelInputSchema.extend(currentRecordFields).strict();
export type ProductPanel = z.infer<typeof productPanelSchema>;

/** Owned by Java ApplicationCatalog; shared panels contain none of these entry facts. */
export const applicationPanelUseSchema = z.object({
  id,
  pageKey: id,
  panelId: id,
  path,
  access: z.union([
    z.object({ permissionCode: id }).strict(),
    z.object({ kind: z.literal("domain-member") }).strict(),
  ]),
  skill: runtimeSkillRefSchema,
  defaultAgentId: id.optional(),
}).strict();
export type ApplicationPanelUse = z.infer<typeof applicationPanelUseSchema>;

/** The Java declaration is the sole takeover authority, including for legacy writers. */
export const panelApplicationEntrySchema = z.object({
  path,
  renderer: z.literal("panels"),
  home: z.string().optional(),
}).strict();
export type PanelApplicationEntry = z.infer<typeof panelApplicationEntrySchema>;

/** GET/PUT /api/product-projections/:id and /api/product-panels/:id. */
export const productCurrentIdParamsSchema = z.object({ id }).strict();

/** PUT creates at revision 0 or replaces the current definition at the supplied revision. */
export const registerProductProjectionRequestSchema = productProjectionInputSchema.extend({
  revision: z.number().int().nonnegative(),
}).strict();
export type RegisterProductProjectionRequest = z.infer<typeof registerProductProjectionRequestSchema>;

/** GET and PUT return the same current record; neither accepts a historical revision selector. */
export const productProjectionResponseSchema = z.object({ projection: productProjectionSchema }).strict();
export type ProductProjectionResponse = z.infer<typeof productProjectionResponseSchema>;

export const registerProductPanelRequestSchema = productPanelInputSchema.extend({
  revision: z.number().int().nonnegative(),
}).strict();
export type RegisterProductPanelRequest = z.infer<typeof registerProductPanelRequestSchema>;

export const productPanelResponseSchema = z.object({ panel: productPanelSchema }).strict();
export type ProductPanelResponse = z.infer<typeof productPanelResponseSchema>;

/** Java GET/PUT /platform/applications/:applicationId/panel-uses. */
export const applicationPanelUsesParamsSchema = z.object({ applicationId: id }).strict();

/** Replace the application's use relations; pageSkills are derived, never supplied alongside them. */
export const registerApplicationPanelUsesRequestSchema = z.object({
  entry: panelApplicationEntrySchema,
  panelUses: z.array(applicationPanelUseSchema),
}).strict();
export type RegisterApplicationPanelUsesRequest = z.infer<typeof registerApplicationPanelUsesRequestSchema>;

/** Current Java-owned entry and use relations; Java owns their access checks. */
export const applicationPanelUsesResponseSchema = registerApplicationPanelUsesRequestSchema.extend({
  applicationId: id,
}).strict();
export type ApplicationPanelUsesResponse = z.infer<typeof applicationPanelUsesResponseSchema>;

/** Internal product subscription branch; readers reload the ID from its current owner. */
export const productDefinitionChangedEventSchema = z.object({
  kind: z.literal("definition-changed"),
  domainId: id,
  target: z.object({ kind: z.enum(["projection", "panel"]), id }).strict(),
}).strict();
export type ProductDefinitionChangedEvent = z.infer<typeof productDefinitionChangedEventSchema>;
