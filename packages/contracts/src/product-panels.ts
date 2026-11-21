import { z } from "zod";
import { defaultAgentSchema } from "./default-agent";
import { panelConversationEntrySchema } from "./panel-conversation-entry";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";
import {
  panelChildObjectIdentitySchema, panelFormTargetSchema, panelManifestForRegistrationSchema, panelManifestSchema, panelMessageKeySchema,
  panelObjectRefSchema, panelThemeOverridesSchema,
} from "./panel-manifest";
import {
  directProjectionPortsSchema, directReadDeclaration, panelReadParameterId, validateDirectProjection,
  type DirectProjectionPorts,
} from "./panel-projection";
import { platformObjectTypes } from "./platform-object-types";
import { applicationMetadataSchema } from "./application-metadata";
import { pageSkillContextSchema, pageSkillEntranceSchema } from "./page-skills";
import { runtimeJsonValueSchema, type RuntimeJsonValue } from "./agent-runtime-values";
import { dashboardCardRequestSchema, dashboardChartFileSchema } from "./dashboard";
export { chartProjectionTemplateSchema } from "./dashboard";
export { ontologyElementRefSchema, type OntologyElementRef } from "./ontology-element-ref";
import { objectDetailUsedByResponseSchema } from "./object-detail";
import { productCatalogCursorSchema } from "./product-catalog-query";
export { productCatalogQuerySchema, type ProductCatalogQuery } from "./product-catalog-query";
import { builtinProductIdSchema, domainProductIdParamsSchema, domainProductIdSchema, productCurrentIdParamsSchema } from "./product-record-id";
export {
  BUILTIN_PRODUCT_ID_PREFIX, builtinProductIdSchema, domainProductIdParamsSchema, domainProductIdSchema,
  isBuiltinProductId, productCurrentIdParamsSchema,
} from "./product-record-id";

const id = productCurrentIdParamsSchema.shape.id;
const path = z.string().regex(/^\/(?!\/)/);

/** The Java-owned canonical site route, before any instance state or draft query is added. */
export const applicationPanelUsePathSchema = path.pipe(z.string().refine((value) => {
  if (/[?#\\\s\p{Cc}]|%(?:2f|5c|(?![0-9a-f]{2}))/iu.test(value)) return false;
  return new URL(value, "https://panel.invalid").pathname === value &&
    (value === "/" || value.slice(1).split("/").every(Boolean));
}, "Expected a canonical site path without query or fragment"));

const productNameSchema = z.string().trim().min(1).max(200);
export const productVisibilitySchema = z.enum(["private", "domain", "platform"]);
export type ProductVisibility = z.infer<typeof productVisibilitySchema>;

const editableDefinitionFields = {
  name: productNameSchema,
  description: z.string().max(2000),
  /** Initial sharing on creation; subsequent Grant changes use the existing governance API. */
  visibility: productVisibilitySchema.exclude(["platform"]),
};

const currentRecordFields = {
  /** Compare on save only; this does not identify a retained or published definition. */
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const domainProductRecordFields = {
  ...currentRecordFields,
  id: domainProductIdSchema,
  domainId: id,
  ownerId: id,
  editable: z.boolean(),
};
/** A platform product has no domain or user owner and is read-only at runtime. */
const builtinProductRecordFields = {
  ...currentRecordFields,
  id: builtinProductIdSchema,
  domainId: z.null(),
  ownerId: z.null(),
  editable: z.literal(false),
};
const builtinVisibility = z.literal("platform");

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

function containsObjectIdentity(value: RuntimeJsonValue): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsObjectIdentity);
  if (panelObjectRefSchema.safeParse(value).success || panelFormTargetSchema.options[0].safeParse(value).success
    || panelChildObjectIdentitySchema.safeParse(value).success) return true;
  const skill = runtimeSkillRefSchema.safeParse(value);
  return (skill.success && skill.data.namespace.kind === "domain") || Object.values(value).some(containsObjectIdentity);
}

const domainProjectionBinding = (field: string) => `Platform-supplied projections cannot bind a domain object: ${field}`;
/** Read parameters whose literal is the identity of an existing object within its owner. */
const domainIdentityParameters: ReadonlySet<string> = new Set(["governanceSource", "scheduledRunId"]);

function validateBuiltinProjection(projection: DirectProjectionPorts, ctx: z.RefinementCtx) {
  validateDirectProjection(projection, ctx);
  const reject = (path: string[]) => ctx.addIssue({
    code: z.ZodIssueCode.custom, path, message: domainProjectionBinding(path.join(".")),
  });
  if (projection.conversationEntry?.target.kind === "id") reject(["conversationEntry", "target", "id"]);
  for (const [side, ports] of Object.entries({ inputs: projection.inputs, outputs: projection.outputs })) {
    for (const [name, port] of Object.entries(ports)) {
      const objectType = port.kind === "object" ? port.objectType : port.kind === "list" ? port.items.objectType : undefined;
      if (objectType !== undefined && !Object.hasOwn(platformObjectTypes, objectType)) reject([side, name]);
    }
  }
  for (const [name, datum] of Object.entries(projection.data)) {
    const source = datum.source;
    if ("type" in source && source.type.kind !== "PlatformObjectType") reject(["data", name, "source", "type"]);
    if ("object" in source && "literal" in source.object) reject(["data", name, "source", "object", "literal"]);
    const declaration = directReadDeclaration(projection, datum);
    for (const [param, value] of Object.entries(datum.params)) {
      if (!("literal" in value)) continue;
      const parameter = declaration && panelReadParameterId(declaration, param);
      const scopedType = (parameter === "className" || parameter === "ontologyType")
        && typeof value.literal === "string" && !Object.hasOwn(platformObjectTypes, value.literal);
      const scopedIdentity = parameter !== undefined && domainIdentityParameters.has(parameter);
      const heldChoices = parameter === "optionValues" && Array.isArray(value.literal) && value.literal.length > 0;
      if (scopedType || scopedIdentity || heldChoices || containsObjectIdentity(value.literal))
        reject(["data", name, "params", param, "literal"]);
    }
  }
  for (const [name, binding] of Object.entries(projection.operations ?? {})) {
    if (binding.operation.kind === "Action") reject(["operations", name, "operation", "id"]);
    if (binding.target && "literal" in binding.target) reject(["operations", name, "target", "literal"]);
  }
  for (const [key, value] of Object.entries(projection.config)) {
    if (containsObjectIdentity(value)) reject(["config", key]);
  }
}

const builtinProjectionDefinition = projectionDefinition.extend({
  visibility: builtinVisibility,
  componentId: projectionDefinition.shape.componentId.refine(
    componentId => componentId !== METRIC_CHART_COMPONENT, domainProjectionBinding("componentId"),
  ),
});
export const builtinProductProjectionInputSchema = builtinProjectionDefinition.superRefine(validateBuiltinProjection);
export type BuiltinProductProjectionInput = z.infer<typeof builtinProductProjectionInputSchema>;

export const chartProjectionSchema = chartProjectionDefinition.extend(domainProductRecordFields).superRefine(validateDirectProjection);
export const productProjectionSchema = z.union([
  chartProjectionSchema,
  ordinaryProjectionDefinition.extend(domainProductRecordFields).superRefine(validateDirectProjection),
  builtinProjectionDefinition.extend(builtinProductRecordFields).superRefine(validateBuiltinProjection),
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
/** The flat panel message key used as the localized panel name by the host. */
export const PANEL_NAME_MESSAGE_KEY = "panel.name";

/** Panel-authored text, by locale and literal flat key, using the platform's named interpolation syntax. */
export const panelMessagesSchema = z.record(z.string().min(1), z.record(panelMessageKeySchema, z.string()))
  .refine(messages => new TextEncoder().encode(JSON.stringify(messages)).byteLength <= panelContentByteLimit,
    "Panel messages must not exceed 256 KiB")
  .superRefine((messages, ctx) => {
    for (const [locale, entries] of Object.entries(messages)) {
      const name = entries[PANEL_NAME_MESSAGE_KEY];
      if (name !== undefined && !productNameSchema.safeParse(name).success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [locale, PANEL_NAME_MESSAGE_KEY],
          message: "A localized panel name must contain 1 to 200 characters" });
      }
    }
  });
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

export const panelDefinitionForRegistrationSchema = panelDefinitionContentSchema.extend({
  manifest: panelManifestForRegistrationSchema,
});

export type PanelDefinitionContent = z.infer<typeof panelDefinitionContentSchema>;
export const productPanelInputSchema = panelDefinitionContentSchema.extend(editableDefinitionFields);
export type ProductPanelInput = z.infer<typeof productPanelInputSchema>;

function validateBuiltinPanel(panel: PanelDefinitionContent, ctx: z.RefinementCtx) {
  const reject = (path: (string | number)[]) => ctx.addIssue({
    code: z.ZodIssueCode.custom, path, message: `Platform-supplied panels cannot bind a domain object: ${path.join(".")}`,
  });
  for (const [name, member] of Object.entries(panel.manifest.members)) {
    const { target, inputs } = member;
    const path = ["manifest", "members", name];
    if ("projectionId" in target && !builtinProductIdSchema.safeParse(target.projectionId).success)
      reject([...path, "target", "projectionId"]);
    if ("panelId" in target && !builtinProductIdSchema.safeParse(target.panelId).success)
      reject([...path, "target", "panelId"]);
    if ("candidates" in target && "panelIds" in target.candidates) {
      target.candidates.panelIds.forEach((panelId, index) => {
        if (!builtinProductIdSchema.safeParse(panelId).success) reject([...path, "target", "candidates", "panelIds", index]);
      });
    }
    for (const [port, input] of Object.entries(inputs ?? {})) {
      if ("literal" in input && containsObjectIdentity(input.literal)) reject([...path, "inputs", port, "literal"]);
    }
  }
  for (const [name, state] of Object.entries(panel.manifest.state)) {
    if (state.default !== undefined && containsObjectIdentity(state.default)) reject(["manifest", "state", name, "default"]);
  }
}

const builtinPanelDefinition = productPanelInputSchema.extend({ visibility: builtinVisibility });
export const builtinProductPanelInputSchema = builtinPanelDefinition
  .extend({ manifest: panelManifestForRegistrationSchema }).superRefine(validateBuiltinPanel);
export type BuiltinProductPanelInput = z.infer<typeof builtinProductPanelInputSchema>;

export const productPanelSchema = z.discriminatedUnion("visibility", [
  productPanelInputSchema.extend(domainProductRecordFields),
  builtinPanelDefinition.extend(builtinProductRecordFields),
]).superRefine((panel, ctx) => {
  if (panel.visibility === "platform") validateBuiltinPanel(panel, ctx);
});
export type ProductPanel = z.infer<typeof productPanelSchema>;
export const currentPanelRecordSchema = productPanelSchema;

/** An entry without a menu name uses the panel's localized name or its stored default. */
export function productPanelDisplayName(panel: Pick<ProductPanel, "name" | "content">, locale: string, defaultLocale: string): string {
  const messages = panel.content.messages;
  return messages?.[locale]?.[PANEL_NAME_MESSAGE_KEY]?.trim()
    || messages?.[defaultLocale]?.[PANEL_NAME_MESSAGE_KEY]?.trim()
    || panel.name;
}

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

/** An entry shipped by the platform must point to a panel shipped by the platform. */
export const builtinApplicationPanelUseSchema = applicationPanelUseSchema.extend({ panelId: builtinProductIdSchema });

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
  uses: z.array(applicationPanelUseSchema.pick({ id: true, panelId: true, inputs: true, defaultAgent: true })),
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
  manifest: panelManifestForRegistrationSchema,
  revision: z.number().int().nonnegative(),
});
export type RegisterProductPanelRequest = z.infer<typeof registerProductPanelRequestSchema>;

export const productPanelResponseSchema = z.object({
  panel: currentPanelRecordSchema,
  pageSkillContext: pageSkillContextSchema.optional(),
}).strict();
export type ProductPanelResponse = z.infer<typeof productPanelResponseSchema>;

const productCurrentSummarySchema = z.object({
  ...editableDefinitionFields,
  id: domainProductRecordFields.id,
  ownerId: domainProductRecordFields.ownerId,
  updatedAt: currentRecordFields.updatedAt,
  revision: currentRecordFields.revision,
  editable: domainProductRecordFields.editable,
}).strict();
const builtinProductCurrentSummarySchema = productCurrentSummarySchema.extend({
  id: builtinProductRecordFields.id,
  ownerId: builtinProductRecordFields.ownerId,
  visibility: builtinVisibility,
  editable: builtinProductRecordFields.editable,
});
const panelSummaryFields = panelDefinitionContentSchema.pick({ template: true }).shape;
const projectionSummaryFields = projectionDefinition.pick({ componentId: true }).shape;
export const productPanelSummarySchema = z.discriminatedUnion("visibility", [
  productCurrentSummarySchema.extend(panelSummaryFields),
  builtinProductCurrentSummarySchema.extend(panelSummaryFields),
]);
export const productProjectionSummarySchema = z.discriminatedUnion("visibility", [
  productCurrentSummarySchema.extend(projectionSummaryFields),
  builtinProductCurrentSummarySchema.extend(projectionSummaryFields),
]);
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
export const deleteProductPanelResponseSchema = deleteProductCurrentResponseSchema.extend({
  deletedProjectionIds: z.array(id),
  retainedProjectionIdsWithoutEdit: z.array(id),
});

/** Copy returns the same response shape as reading the new current record. */
export const copyProductCurrentRequestSchema = domainProductIdParamsSchema.extend({
  name: editableDefinitionFields.name,
});

/** Visible references include names. Hidden panels contribute only to the count. */
export const productProjectionUsedBySchema = z.object({
  panels: z.array(z.object({ id, name: editableDefinitionFields.name }).strict()),
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
