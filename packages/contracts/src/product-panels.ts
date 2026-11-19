import { z } from "zod";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";
import { ontologyParameterTypeSchema, panelManifestSchema } from "./panel-manifest";
import { applicationMetadataSchema } from "./application-metadata";
import { appsSdkBuildSchema } from "./apps-sdk";

const id = z.string().min(1).max(200);
const path = z.string().regex(/^\/(?!\/)/);

/** The Java-owned canonical site route, before any instance state or draft query is added. */
export const applicationPanelUsePathSchema = path.pipe(z.string().refine((value) => {
  if (/[?#\\\s\p{Cc}]|%(?:2f|5c|(?![0-9a-f]{2}))/iu.test(value)) return false;
  return new URL(value, "https://panel.invalid").pathname === value &&
    (value === "/" || value.slice(1).split("/").every(Boolean));
}, "Expected a canonical site path without query or fragment"));

/**
 * PlatformObjectType refers to a read-only platform type, never a customer-editable ObjectType.
 * A PlatformOperation ID is the SDK client's registered operation name (for example, schedules.runNow),
 * identical to the derived operation's handlerRef; there is no second operation namespace.
 */
export const ontologyElementRefSchema = z.object({
  kind: z.enum(["MetricView", "Action", "ObjectType", "Definition", "PlatformObjectType", "PlatformOperation"]),
  id,
}).strict();
export type OntologyElementRef = z.infer<typeof ontologyElementRefSchema>;

const editableDefinitionFields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000),
  /** Initial sharing on creation; subsequent Grant changes use the existing governance API. */
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

const panelText = z.string().refine(value => new TextEncoder().encode(value).byteLength <= 256 * 1024,
  "Panel text must not exceed 256 KiB");

/** The text of a current panel definition or a workspace candidate. */
export const productPanelContentSchema = z.object({
  html: panelText,
  module: panelText,
  recipes: panelText.optional(),
}).strict();
export type ProductPanelContent = z.infer<typeof productPanelContentSchema>;

/** Everything needed to render a panel from either source, independent of its registration. */
export const panelDefinitionContentSchema = z.object({
  content: productPanelContentSchema,
  /** Supplied by the registrant's module export; Node validates references without executing module text. */
  manifest: panelManifestSchema,
  sdkVersion: appsSdkBuildSchema.shape.version.regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)*$/),
}).strict();
export type PanelDefinitionContent = z.infer<typeof panelDefinitionContentSchema>;

export const productPanelInputSchema = panelDefinitionContentSchema.extend(editableDefinitionFields);
export type ProductPanelInput = z.infer<typeof productPanelInputSchema>;

export const productPanelSchema = productPanelInputSchema.extend(currentRecordFields).strict();
export type ProductPanel = z.infer<typeof productPanelSchema>;

/** Owned by Java ApplicationCatalog; shared panels contain none of these entry facts. */
export const applicationPanelUseSchema = z.object({
  id,
  pageKey: id,
  panelId: id,
  path: applicationPanelUsePathSchema,
  access: z.union([
    z.object({ permissionCode: id }).strict(),
    z.object({ kind: z.literal("domain-member") }).strict(),
  ]),
  defaultAgentId: id.optional(),
  names: applicationMetadataSchema.shape.names.optional(),
}).strict();
export type ApplicationPanelUse = z.infer<typeof applicationPanelUseSchema>;

export const panelSkillSourceSchema = z.object({
  skill: runtimeSkillRefSchema,
  uses: z.array(applicationPanelUseSchema.pick({ pageKey: true, panelId: true, path: true }).extend({
    applicationId: id,
    useId: id,
  })).nonempty(),
}).strict();
export type PanelSkillSource = z.infer<typeof panelSkillSourceSchema>;

/** The Java declaration is the sole takeover authority, including for legacy writers. */
export const panelApplicationEntrySchema = z.object({
  path,
  renderer: z.literal("panels"),
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

/**
 * Create a panels application or replace an existing panels application's use relations.
 * Java rejects an existing application whose entry renderer is not panels: this API cannot perform a takeover.
 * Existing application maintainer checks apply; pageSkills are derived, never supplied alongside the relations.
 */
export const registerApplicationPanelUsesRequestSchema = z.object({
  entry: panelApplicationEntrySchema,
  panelUses: z.array(applicationPanelUseSchema),
  /** Required when creating an application; omitted updates retain existing metadata and entry access. */
  declaration: applicationMetadataSchema.optional(),
  entryAccess: z.array(id).min(1).optional(),
}).strict();
export type RegisterApplicationPanelUsesRequest = z.infer<typeof registerApplicationPanelUsesRequestSchema>;

/** Current Java-owned entry and use relations; Java owns their access checks. */
export const applicationPanelUsesResponseSchema = z.object({
  applicationId: id,
  entry: z.object({ path, renderer: id, home: path.optional() }).strict(),
  panelUses: z.array(applicationPanelUseSchema),
}).strict();
export type ApplicationPanelUsesResponse = z.infer<typeof applicationPanelUsesResponseSchema>;

/** Internal product subscription branch; readers reload the ID from its current owner. */
export const productDefinitionChangedEventSchema = z.object({
  kind: z.literal("definition-changed"),
  domainId: id,
  target: z.object({ kind: z.enum(["projection", "panel"]), id }).strict(),
}).strict();
export type ProductDefinitionChangedEvent = z.infer<typeof productDefinitionChangedEventSchema>;
