import { z } from "zod";
import { defaultAgentSchema } from "./default-agent";
import { panelConversationEntrySchema } from "./panel-conversation-entry";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";
import { directPanelManifestSchema, ontologyObjectUnionTypeSchema, ontologyParameterTypeSchema, panelManifestSchema, panelMessageKeySchema } from "./panel-manifest";
import { PanelLayoutError, parsePanelLayout } from "./panel-layout";
import { directProjectionPortsSchema, validateDirectProjection } from "./panel-projection";
import { applicationMetadataSchema } from "./application-metadata";
import { appsSdkBuildSchema } from "./apps-sdk";
import { formFieldErrorSchema } from "./form-fields";
import { dashboardCardRequestSchema, dashboardChartFileSchema, dashboardMetricReferenceSchema } from "./dashboard";

const id = z.string().min(1).max(200);
const path = z.string().regex(/^\/(?!\/)/);

/** The Java-owned canonical site route, before any instance state or draft query is added. */
export const applicationPanelUsePathSchema = path.pipe(z.string().refine((value) => {
  if (/[?#\\\s\p{Cc}]|%(?:2f|5c|(?![0-9a-f]{2}))/iu.test(value)) return false;
  return new URL(value, "https://panel.invalid").pathname === value &&
    (value === "/" || value.slice(1).split("/").every(Boolean));
}, "Expected a canonical site path without query or fragment"));

/**
 * PlatformObjectType binds a platform-declared type and its owner APIs, including management of its definitions.
 * A MetricView, Action, ObjectType or Relationship binding targets one specific ontology element.
 * A PlatformOperation ID is the SDK client's registered operation name (for example, schedules.runNow),
 * identical to the derived operation's handlerRef; there is no second operation namespace.
 */
export const ontologyElementRefSchema = z.object({
  kind: z.enum(["MetricView", "Action", "ObjectType", "Relationship", "Definition", "PlatformObjectType", "PlatformOperation"]),
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

/** A graph uses its primary binding for nodes and this second binding for edges. */
export const projectionGraphSchema = z.object({
  /** Mixed node records carry their complete identities and these allowed types. */
  nodeIdentity: ontologyObjectUnionTypeSchema.optional(),
  edges: z.object({
    binding: ontologyElementRefSchema.extend({
      kind: ontologyElementRefSchema.shape.kind.extract(["PlatformObjectType", "Relationship"]),
    }),
    /** JSON Pointers inside the edge record's fields, each resolving to a node key, or a complete identity for a mixed graph. */
    sourcePath: formFieldErrorSchema.shape.field,
    targetPath: formFieldErrorSchema.shape.field,
  }).strict(),
}).strict();

export const METRIC_CHART_COMPONENT = "MetricChart";
export const chartProjectionSourceSchema = dashboardCardRequestSchema;
export type ChartProjectionSource = z.infer<typeof chartProjectionSourceSchema>;

/** Component-specific display validation belongs to the registered SDK component. */
const projectionDefinitionSchema = z.object({
  ...editableDefinitionFields,
  componentId: id,
  binding: ontologyElementRefSchema,
  graph: projectionGraphSchema.optional(),
  conversationEntry: panelConversationEntrySchema.optional(),
  inputs: z.record(id, ontologyParameterTypeSchema),
  display: z.record(z.unknown()),
}).strict();

const ordinaryProjectionDefinitionSchema = projectionDefinitionSchema.extend({
  componentId: id.refine(value => value !== METRIC_CHART_COMPONENT, "Register a chart from its source card"),
  display: projectionDefinitionSchema.shape.display.refine(
    display => !Object.hasOwn(display, "chartSource"), "Register a chart source through its owner",
  ),
});

const chartProjectionDefinitionSchema = projectionDefinitionSchema.extend({
  graph: z.never().optional(),
  componentId: z.literal(METRIC_CHART_COMPONENT),
  binding: ontologyElementRefSchema.extend({ kind: z.literal("MetricView") }),
  /** The owner omits parameters outside this vocabulary. Parameters without an input come from the source card. */
  inputs: projectionDefinitionSchema.shape.inputs,
  display: z.object({ chartSource: chartProjectionSourceSchema }).strict(),
});

export const productProjectionInputSchema = z.union([chartProjectionDefinitionSchema, ordinaryProjectionDefinitionSchema]);
export type ProductProjectionInput = z.infer<typeof productProjectionInputSchema>;

export const chartProjectionSchema = chartProjectionDefinitionSchema.extend(currentRecordFields);
export const productProjectionSchema = z.union([
  chartProjectionSchema,
  ordinaryProjectionDefinitionSchema.extend(currentRecordFields),
]);
export type ProductProjection = z.infer<typeof productProjectionSchema>;

const directProjectionInput = directProjectionPortsSchema.extend(editableDefinitionFields);
export const directProjectionInputSchema = directProjectionInput.superRefine(validateDirectProjection);
export type DirectProjectionInput = z.infer<typeof directProjectionInputSchema>;
export const directProjectionSchema = directProjectionInput.extend(currentRecordFields).superRefine(validateDirectProjection);
export type DirectProjection = z.infer<typeof directProjectionSchema>;
export const registerDirectProjectionRequestSchema = directProjectionInput.extend({
  revision: z.number().int().nonnegative(),
}).superRefine(validateDirectProjection);

const panelContentByteLimit = 256 * 1024;
const panelText = z.string().refine(value => new TextEncoder().encode(value).byteLength <= panelContentByteLimit,
  "Panel text must not exceed 256 KiB");
/** Panel-authored text, by locale and literal flat key, using the platform's named interpolation syntax. */
export const panelMessagesSchema = z.record(z.string().min(1), z.record(panelMessageKeySchema, z.string()))
  .refine(messages => new TextEncoder().encode(JSON.stringify(messages)).byteLength <= panelContentByteLimit,
    "Panel messages must not exceed 256 KiB");
export type PanelMessages = z.infer<typeof panelMessagesSchema>;

/** The text of a current panel definition or a workspace candidate. */
export const productPanelContentSchema = z.object({
  html: panelText,
  module: panelText,
  recipes: panelText.optional(),
  messages: panelMessagesSchema.optional(),
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

/** The no-code pilot records need neither executable content nor a pinned SDK version. */
export const directPanelContentSchema = productPanelContentSchema.omit({ module: true });
const directPanelDefinitionContent = z.object({ content: directPanelContentSchema, manifest: directPanelManifestSchema }).strict();

function validateDirectLayout(definition: z.infer<typeof directPanelDefinitionContent>, ctx: z.RefinementCtx): void {
  try {
    parsePanelLayout(definition.content.html, definition.manifest);
  } catch (error) {
    if (!(error instanceof PanelLayoutError)) throw error;
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["content", "html"], message: error.message, params: error.position });
  }
}

export const directPanelDefinitionContentSchema = directPanelDefinitionContent.superRefine(validateDirectLayout);
export type DirectPanelDefinitionContent = z.infer<typeof directPanelDefinitionContentSchema>;
const directPanelInput = directPanelDefinitionContent.extend(editableDefinitionFields);
export const directPanelInputSchema = directPanelInput.superRefine(validateDirectLayout);
export type DirectPanelInput = z.infer<typeof directPanelInputSchema>;
export const directPanelSchema = directPanelInput.extend(currentRecordFields).superRefine(validateDirectLayout);
export type DirectPanel = z.infer<typeof directPanelSchema>;
export const registerDirectPanelRequestSchema = directPanelInput.extend({
  revision: z.number().int().nonnegative(),
}).superRefine(validateDirectLayout);

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

/**
 * PUT creates at revision 0 or replaces a current definition at the supplied revision.
 * A chart metadata update repeats its current component and binding and supplies an empty display. The owner
 * compares those values with the current record and retains the registered source; only source registration creates
 * a MetricChart. The owner also rejects replacing a registered chart with an ordinary projection.
 */
export const registerProductProjectionRequestSchema = z.union([
  ordinaryProjectionDefinitionSchema.extend({ revision: z.number().int().nonnegative() }),
  chartProjectionDefinitionSchema.extend({
    revision: currentRecordFields.revision,
    display: z.object({}).strict(),
  }),
]);
export type RegisterProductProjectionRequest = z.infer<typeof registerProductProjectionRequestSchema>;

/** GET and PUT return the same current record; neither accepts a historical revision selector. */
export const productProjectionResponseSchema = z.object({ projection: productProjectionSchema }).strict();
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

/** Read the source card's current drawing and saved parameters under the projection's use grant. */
export const chartProjectionTemplateSchema = z.object({
  chartFile: dashboardChartFileSchema,
  parameters: dashboardMetricReferenceSchema.shape.parameters,
}).strict();

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
}).strict();
export type RegisterProductPanelRequest = z.infer<typeof registerProductPanelRequestSchema>;

export const productPanelResponseSchema = z.object({ panel: productPanelSchema }).strict();
export type ProductPanelResponse = z.infer<typeof productPanelResponseSchema>;

const productCatalogCursorSchema = z.string().min(1);
/** Query both current product collections. Cursors are opaque to callers. */
export const productCatalogQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  scope: z.enum(["all", "mine", "shared"]).default("all"),
  sort: z.enum(["updated", "name"]).default("updated"),
  cursor: productCatalogCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ProductCatalogQuery = z.infer<typeof productCatalogQuerySchema>;

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
  projectionDefinitionSchema.pick({ componentId: true, binding: true }).shape,
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
export const productPanelUsedBySchema = z.object({
  applicationEntries: z.array(z.object({
    applicationId: id,
    applicationName: z.string(),
    entryId: applicationPanelUseSchema.shape.id,
    path: applicationPanelUsePathSchema,
  }).strict()),
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
