import { z } from "zod";
import { defaultAgentSchema } from "./default-agent";
import { panelConversationEntrySchema } from "./panel-conversation-entry";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";
import { panelManifestSchema, panelMessageKeySchema, panelThemeOverridesSchema } from "./panel-manifest";
import { directProjectionPortsSchema, validateDirectProjection } from "./panel-projection";
import { applicationMetadataSchema } from "./application-metadata";
import { pageSkillContextSchema, pageSkillEntranceSchema } from "./page-skills";
import { runtimeJsonValueSchema } from "./agent-runtime-values";
import { dashboardCardRequestSchema, dashboardChartFileSchema } from "./dashboard";
export { chartProjectionTemplateSchema } from "./dashboard";
export { ontologyElementRefSchema, type OntologyElementRef } from "./ontology-element-ref";
import { objectDetailUsedByResponseSchema } from "./object-detail";
import { productCatalogCursorSchema } from "./product-catalog-query";
export { productCatalogQuerySchema, type ProductCatalogQuery } from "./product-catalog-query";
import { productCurrentIdParamsSchema } from "./product-record-id";
export { productCurrentIdParamsSchema } from "./product-record-id";

const id = productCurrentIdParamsSchema.shape.id;
const path = z.string().regex(/^\/(?!\/)/);

/** The Java-owned canonical site route, before any instance state or draft query is added. */
export const applicationPanelUsePathSchema = path.pipe(z.string().refine((value) => {
  if (/[?#\\\s\p{Cc}]|%(?:2f|5c|(?![0-9a-f]{2}))/iu.test(value)) return false;
  return new URL(value, "https://panel.invalid").pathname === value &&
    (value === "/" || value.slice(1).split("/").every(Boolean));
}, "Expected a canonical site path without query or fragment"));

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

export const METRIC_CHART_COMPONENT = "@ontomato/sdk:MetricChart";
export const chartProjectionSourceSchema = dashboardCardRequestSchema;
export type ChartProjectionSource = z.infer<typeof chartProjectionSourceSchema>;

const projectionDefinition = directProjectionPortsSchema.extend(editableDefinitionFields);
const ordinaryProjectionDefinition = projectionDefinition.extend({
  componentId: projectionDefinition.shape.componentId.refine(
    componentId => componentId !== METRIC_CHART_COMPONENT, "Register a chart through its source card",
  ),
});
const chartProjectionDefinition = projectionDefinition.extend({
  componentId: z.literal(METRIC_CHART_COMPONENT),
  metricId: id,
});

export const productProjectionInputSchema = z.union([
  ordinaryProjectionDefinition.superRefine(validateDirectProjection),
  chartProjectionDefinition.superRefine(validateDirectProjection),
]);
export type ProductProjectionInput = z.infer<typeof productProjectionInputSchema>;

export const chartProjectionSchema = chartProjectionDefinition.extend(currentRecordFields).superRefine(validateDirectProjection);
export const productProjectionSchema = z.union([
  chartProjectionSchema,
  ordinaryProjectionDefinition.extend(currentRecordFields).superRefine(validateDirectProjection),
]);
export type ProductProjection = z.infer<typeof productProjectionSchema>;
export const currentProjectionRecordSchema = productProjectionSchema;
export type CurrentProjectionRecord = ProductProjection;
export const directProjectionInputSchema = productProjectionInputSchema;
export type DirectProjectionInput = ProductProjectionInput;
export const directProjectionSchema = productProjectionSchema;
export type DirectProjection = ProductProjection;

const panelContentByteLimit = 256 * 1024;
const panelText = z.string().refine(value => new TextEncoder().encode(value).byteLength <= panelContentByteLimit,
  "Panel text must not exceed 256 KiB");
/** Panel-authored text, by locale and literal flat key, using the platform's named interpolation syntax. */
export const panelMessagesSchema = z.record(z.string().min(1), z.record(panelMessageKeySchema, z.string()))
  .refine(messages => new TextEncoder().encode(JSON.stringify(messages)).byteLength <= panelContentByteLimit,
    "Panel messages must not exceed 256 KiB");
export type PanelMessages = z.infer<typeof panelMessagesSchema>;

/** The shared sources of a registered panel or workspace candidate. */
export const productPanelContentSchema = z.object({
  html: panelText,
  module: panelText,
  style: panelText.optional(),
  recipes: panelText.optional(),
  messages: panelMessagesSchema.optional(),
}).strict();
export type ProductPanelContent = z.infer<typeof productPanelContentSchema>;

export const panelDefinitionContentSchema = z.object({
  content: productPanelContentSchema,
  manifest: panelManifestSchema,
  theme: panelThemeOverridesSchema.optional(),
  template: z.boolean().optional(),
}).strict();

export type PanelDefinitionContent = z.infer<typeof panelDefinitionContentSchema>;
export const productPanelInputSchema = panelDefinitionContentSchema.extend(editableDefinitionFields);
export type ProductPanelInput = z.infer<typeof productPanelInputSchema>;

export const productPanelSchema = productPanelInputSchema.extend(currentRecordFields);
export type ProductPanel = z.infer<typeof productPanelSchema>;
export const currentPanelRecordSchema = productPanelSchema;

/** Values wired into a content panel's public fields by its application entry. */
export const applicationPanelInputsSchema = z.record(id, z.union([
  z.object({ frameState: id }).strict(),
  z.object({ literal: runtimeJsonValueSchema }).strict(),
]));
export type ApplicationPanelInputs = z.infer<typeof applicationPanelInputsSchema>;

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
  defaultAgent: defaultAgentSchema.optional(),
  names: applicationMetadataSchema.shape.names.optional(),
  inputs: applicationPanelInputsSchema.optional(),
  groupKey: applicationMetadataSchema.shape.groups.element.shape.key.optional(),
}).strict();
export type ApplicationPanelUse = z.infer<typeof applicationPanelUseSchema>;

export const applicationEntryResolutionQuerySchema = z.object({ path: applicationPanelUsePathSchema }).strict();
export const applicationEntryMenuSchema = z.object({
  groups: applicationMetadataSchema.shape.groups,
  panelUses: z.array(applicationPanelUseSchema),
}).strict();
export const applicationEntryResolutionSchema = z.object({
  applicationId: id,
  use: applicationPanelUseSchema,
  framePanelId: id.optional(),
  theme: panelThemeOverridesSchema.optional(),
  menu: applicationEntryMenuSchema,
}).strict();
export type ApplicationEntryResolution = z.infer<typeof applicationEntryResolutionSchema>;

export const applicationDeliverySchema = z.object({
  panels: z.array(id),
  projections: z.array(id),
  packages: z.array(id),
  agents: z.array(id),
  skills: z.array(runtimeSkillRefSchema),
}).strict();
export type ApplicationDelivery = z.infer<typeof applicationDeliverySchema>;

const applicationEntrySettings = {
  framePanelId: id.optional(),
  theme: panelThemeOverridesSchema.optional(),
  delivery: applicationDeliverySchema.optional(),
};

export const APPLICATION_PANEL_REFERENCES_PATH = "/internal/product-panels/validate-references";
/** The platform service authenticates this request. Node validates the public inputs and the fixed closure. */
export const applicationPanelReferencesRequestSchema = z.object({
  domainId: id,
  framePanelId: id.optional(),
  uses: z.array(applicationPanelUseSchema.pick({ id: true, panelId: true, inputs: true })),
  delivery: applicationDeliverySchema.pick({ panels: true, projections: true }),
}).strict();
export type ApplicationPanelReferencesRequest = z.infer<typeof applicationPanelReferencesRequestSchema>;

export const panelUseRefSchema = z.object({ applicationId: id, useId: id }).strict();
export type PanelUseRef = z.infer<typeof panelUseRefSchema>;

/** Java exposes registered entry facts to the authenticated provider service. */
export const panelSkillSourceSchema = panelUseRefSchema.extend({
  panelId: id,
  path: applicationPanelUsePathSchema,
  entrance: pageSkillEntranceSchema,
});
export type PanelSkillSource = z.infer<typeof panelSkillSourceSchema>;
export const panelSkillSourcesResponseSchema = z.array(panelSkillSourceSchema);
export const panelSkillSourcesQuerySchema = z.object({ domainId: id }).strict();

/** The Java declaration is the sole takeover authority, including for legacy writers. */
export const panelApplicationEntrySchema = z.object({
  path,
  renderer: z.literal("panels"),
}).strict();
export type PanelApplicationEntry = z.infer<typeof panelApplicationEntrySchema>;

const [menuEntrance, domainMemberEntrance] = pageSkillEntranceSchema.options;
/** GET /api/product-panels/:id and /:id/snapshot take either no query or one complete application-use entrance. */
export const productPanelReadQuerySchema = z.union([
  z.object({}).strict(),
  panelUseRefSchema.merge(menuEntrance),
  panelUseRefSchema.merge(domainMemberEntrance),
]);
export type ProductPanelReadQuery = z.infer<typeof productPanelReadQuerySchema>;

/** The source card owner creates chart projections; ordinary updates may only edit chart metadata. */
export const registerProductProjectionRequestSchema = z.union([
  ordinaryProjectionDefinition.extend({ revision: z.number().int().nonnegative() }).superRefine(validateDirectProjection),
  z.object({ ...editableDefinitionFields, componentId: z.literal(METRIC_CHART_COMPONENT), revision: currentRecordFields.revision }).strict(),
]);
export type RegisterProductProjectionRequest = z.infer<typeof registerProductProjectionRequestSchema>;
export const registerDirectProjectionRequestSchema = registerProductProjectionRequestSchema;

/** GET and PUT return the same current record; neither accepts a historical revision selector. */
export const productProjectionResponseSchema = z.object({ projection: currentProjectionRecordSchema }).strict();
export type ProductProjectionResponse = z.infer<typeof productProjectionResponseSchema>;

/**
 * Source registration accepts only the card identity. The owner authorizes the source and derives the binding,
 * inputs, and stable projection identity in the caller's domain. The initial projection is private, with the card's
 * name and an empty description. Subsequent sharing uses existing grants. Re-registering returns the same identity.
 */
export const registerChartProjectionRequestSchema = chartProjectionSourceSchema;
export const registerChartProjectionResponseSchema = z.object({ projection: chartProjectionSchema }).strict();

/**
 * Lookup first checks source readability with the dashboard owner. An accessible card without a registration returns
 * null. For a registered projection, the product grant check either authorizes returning its identity or refuses the request.
 */
export const chartProjectionLookupResponseSchema = z.object({ projectionId: id.nullable() }).strict();

/** The projection's edit grant permits updating the source template's drawing. */
export const updateChartProjectionSourceRequestSchema = z.object({
  chartFile: dashboardChartFileSchema.pick({ content: true }),
}).strict();

/** Dashboard edits and deletes refuse removal of a referenced source card. Account cleanup removes its registered projections with the card. */
export const CHART_SOURCE_IN_USE = "CHART_SOURCE_IN_USE";
export const chartSourceInUseErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.literal(CHART_SOURCE_IN_USE),
  details: z.object({ projectionIds: z.array(id).nonempty() }).strict(),
}).strict();

export const registerProductPanelRequestSchema = productPanelInputSchema.extend({
  revision: z.number().int().nonnegative(),
});
export type RegisterProductPanelRequest = z.infer<typeof registerProductPanelRequestSchema>;

export const productPanelResponseSchema = z.object({
  panel: currentPanelRecordSchema,
  pageSkillContext: pageSkillContextSchema.optional(),
}).strict();
export type ProductPanelResponse = z.infer<typeof productPanelResponseSchema>;

export const productPanelSummarySchema = productPanelSchema.pick({
  id: true,
  name: true,
  description: true,
  ownerId: true,
  visibility: true,
  updatedAt: true,
  revision: true,
  editable: true,
});
export const productProjectionSummarySchema = productPanelSummarySchema.extend(
  projectionDefinition.pick({ componentId: true }).shape,
);
export type ProductPanelSummary = z.infer<typeof productPanelSummarySchema>;
export type ProductProjectionSummary = z.infer<typeof productProjectionSummarySchema>;

export const productPanelListResponseSchema = z.object({
  items: z.array(productPanelSummarySchema),
  nextCursor: productCatalogCursorSchema.nullable(),
}).strict();
export const productProjectionListResponseSchema = productPanelListResponseSchema.extend({
  items: z.array(productProjectionSummarySchema),
});
export type ProductPanelListResponse = z.infer<typeof productPanelListResponseSchema>;
export type ProductProjectionListResponse = z.infer<typeof productProjectionListResponseSchema>;

export const deleteProductCurrentQuerySchema = z.object({
  revision: z.coerce.number().pipe(currentRecordFields.revision),
}).strict();
export const deleteProductCurrentResponseSchema = z.object({ success: z.literal(true) }).strict();

/** Copy returns the same response shape as reading the new current record. */
export const copyProductCurrentRequestSchema = productCurrentIdParamsSchema.extend({
  name: editableDefinitionFields.name,
});

/** Visible references include names. Hidden panels contribute only to the count. */
export const productProjectionUsedBySchema = z.object({
  panels: z.array(productPanelSummarySchema.pick({ id: true, name: true })),
  hiddenCount: z.number().int().nonnegative(),
}).strict();
export const productPanelUsedBySchema = productProjectionUsedBySchema.extend({
  applicationEntries: z.array(z.object({
    applicationId: id,
    applicationName: z.string(),
    entryId: applicationPanelUseSchema.shape.id,
    path: applicationPanelUsePathSchema,
  }).strict()),
  classNames: objectDetailUsedByResponseSchema.shape.classNames,
}).strict();
export type ProductProjectionUsedBy = z.infer<typeof productProjectionUsedBySchema>;
export type ProductPanelUsedBy = z.infer<typeof productPanelUsedBySchema>;

export const PRODUCT_IN_USE = "PRODUCT_IN_USE";
const productInUseErrorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.literal(PRODUCT_IN_USE),
}).strict();
export const productProjectionInUseErrorSchema = productInUseErrorSchema.extend({
  details: productProjectionUsedBySchema,
});
export const productPanelInUseErrorSchema = productInUseErrorSchema.extend({
  details: productPanelUsedBySchema,
});

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
  ...applicationEntrySettings,
}).strict();
export type RegisterApplicationPanelUsesRequest = z.infer<typeof registerApplicationPanelUsesRequestSchema>;

/** Current Java-owned entry and use relations; Java owns their access checks. */
export const applicationPanelUsesResponseSchema = z.object({
  applicationId: id,
  entry: z.object({ path, renderer: id, home: path.optional() }).strict(),
  panelUses: z.array(applicationPanelUseSchema),
}).strict();
export type ApplicationPanelUsesResponse = z.infer<typeof applicationPanelUsesResponseSchema>;

/** A maintenance read is the full declaration and uses, independent of the viewer's visible menu. */
export const applicationPanelUsesManagementSchema = applicationPanelUsesResponseSchema.extend({
  declaration: applicationMetadataSchema,
  entryAccess: z.array(id).min(1),
  ...applicationEntrySettings,
});
export type ApplicationPanelUsesManagement = z.infer<typeof applicationPanelUsesManagementSchema>;

/** Internal product subscription branch; readers reload the ID from its current owner. */
export const productDefinitionChangedEventSchema = z.object({
  kind: z.literal("definition-changed"),
  domainId: id,
  target: z.object({ kind: z.enum(["projection", "panel"]), id }).strict(),
}).strict();
export type ProductDefinitionChangedEvent = z.infer<typeof productDefinitionChangedEventSchema>;
