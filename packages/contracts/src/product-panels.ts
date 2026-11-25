import { z } from "zod";
import { domainComponentIdSchema, domainComponentRuntimeSchema } from "./domain-component-runtime";
import { defaultAgentSchema } from "./default-agent";
import { panelConversationEntrySchema } from "./panel-conversation-entry";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";
import {
  panelChildObjectIdentitySchema, panelFormTargetSchema, panelManifestSchema, panelMemberPathSegmentSchema, panelMessageKeySchema,
  panelObjectRefSchema, panelThemeOverridesSchema,
} from "./panel-manifest";
import {
  directProjectionPortsSchema, directReadDeclaration, panelReadParameterId, validateDirectProjection,
  type DirectProjectionPorts,
} from "./panel-projection";
import { METRIC_VIEW, platformObjectTypes } from "./platform-object-types";
import { applicationMetadataSchema } from "./application-metadata";
import { domainApplicationIconSchema } from "./application-icons";
import { pageSkillContextSchema, pageSkillEntranceSchema } from "./page-skills";
import { runtimeJsonValueSchema, type RuntimeJsonValue } from "./agent-runtime-values";
import { dashboardCardRequestSchema, dashboardChartFileSchema } from "./dashboard";
export { chartProjectionTemplateSchema } from "./dashboard";
export { ontologyElementRefSchema, type OntologyElementRef } from "./ontology-element-ref";
import { objectDetailUsedByResponseSchema } from "./object-detail";
import { productCatalogCursorSchema } from "./product-catalog-query";
export {
  productCatalogQuerySchema,
  productProjectionCatalogQuerySchema,
  productProjectionComponentFilterSchema,
  productProjectionObjectTypeFilterSchema,
  type ProductCatalogQuery,
  type ProductProjectionCatalogQuery,
} from "./product-catalog-query";
import { builtinProductIdSchema, domainProductIdParamsSchema, domainProductIdSchema, isDomainComponentId, productCurrentIdParamsSchema } from "./product-record-id";
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
export const AGENT_CHAT_COMPONENT = "@ontomato/sdk:AgentChat";
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
const domainIdentityParameters: ReadonlySet<string> = new Set(["scheduledRunId"]);

function validateBuiltinProjection(projection: DirectProjectionPorts, ctx: z.RefinementCtx) {
  validateDirectProjection(projection, ctx);
  const reject = (path: string[]) => ctx.addIssue({
    code: z.ZodIssueCode.custom, path, message: domainProjectionBinding(path.join(".")),
  });
  if (projection.conversationEntry?.target.kind === "id") reject(["conversationEntry", "target", "id"]);
  for (const [side, ports] of Object.entries({ inputs: projection.inputs, outputs: projection.outputs })) {
    for (const [name, port] of Object.entries(ports)) {
      const objectType = port.kind === "object"
        ? port.objectType
        : port.kind === "list" && port.items.kind === "object"
          ? port.items.objectType
          : undefined;
      if (objectType !== undefined && objectType !== "@any" && !Object.hasOwn(platformObjectTypes, objectType)) reject([side, name]);
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
    for (const [param, value] of Object.entries(binding.params ?? {})) {
      if ("literal" in value && containsObjectIdentity(value.literal))
        reject(["operations", name, "params", param, "literal"]);
    }
  }
  for (const [key, value] of Object.entries(projection.config)) {
    if (containsObjectIdentity(value)) reject(["config", key]);
  }
}

const builtinProjectionDefinition = projectionDefinition.extend({
  visibility: builtinVisibility,
  componentId: projectionDefinition.shape.componentId.refine(
    componentId => !isDomainComponentId(componentId), domainProjectionBinding("componentId"),
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
  module: panelText.optional(),
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
  for (const name of Object.keys(panel.manifest.components ?? {})) {
    reject(["manifest", "components", name]);
  }
}

const builtinPanelDefinition = productPanelInputSchema.extend({ visibility: builtinVisibility });
export const builtinProductPanelInputSchema = builtinPanelDefinition.superRefine(validateBuiltinPanel);
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

/** Whether an application panel entry renders the platform's bottom page composer. Defaults to `"bottom"`. */
export const applicationPanelPageComposerSchema = z.enum(["bottom", "none"]);
export type ApplicationPanelPageComposer = z.infer<typeof applicationPanelPageComposerSchema>;

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
  /** Optional page heading text, independent of whether the entry is in the menu. */
  descriptions: z.record(z.string().refine(text => text.trim().length > 0, "Expected a nonblank description"))
    .refine(text => Object.keys(text).length > 0, "At least one localized description is required").optional(),
  /** Optional curated icon key rendered beside this entry in the application menu. */
  icon: z.string().refine(text => text.trim().length > 0, "Expected a nonblank icon").optional(),
  inputs: applicationPanelInputsSchema.optional(),
  groupKey: applicationMetadataSchema.shape.groups.element.shape.key.optional(),
  /** Suppresses the host's bottom floating PageComposer when set to `"none"` (e.g. page renders an inline composer). */
  pageComposer: applicationPanelPageComposerSchema.optional(),
}).strict();
export type ApplicationPanelUse = z.infer<typeof applicationPanelUseSchema>;

/** An entry shipped by the platform must point to a panel shipped by the platform. */
export const builtinApplicationPanelUseSchema = applicationPanelUseSchema.extend({ panelId: builtinProductIdSchema });

/**
 * A built-in native page entry inside a platform application's entry table (read-only / built-in declarations only).
 * Domain applications cannot declare native entries; explicit `kind: "native"` prevents an omitted `panelId` from
 * silently bypassing panel validation, and forbids panel-only fields (`panelId`, `inputs`, `defaultAgent`).
 */
export const builtinNativeEntrySchema = z.object({
  id,
  pageKey: id,
  kind: z.literal("native"),
  path: applicationPanelUsePathSchema,
  access: applicationPanelUseSchema.shape.access,
  names: applicationPanelUseSchema.shape.names,
  descriptions: applicationPanelUseSchema.shape.descriptions,
  icon: applicationPanelUseSchema.shape.icon,
  groupKey: applicationPanelUseSchema.shape.groupKey,
}).strict();
export type BuiltinNativeEntry = z.infer<typeof builtinNativeEntrySchema>;

export const frameConversationEntrySchema = builtinNativeEntrySchema.extend({
  kind: z.literal("frame-conversation"),
});
export type FrameConversationEntry = z.infer<typeof frameConversationEntrySchema>;

export const panelApplicationEntryUseSchema =
  z.unknown().transform((value, ctx): ApplicationPanelUse | FrameConversationEntry => {
    const target = value && typeof value === "object" && !Array.isArray(value)
      && "kind" in value && (value as { kind?: unknown }).kind === "frame-conversation"
      ? frameConversationEntrySchema
      : applicationPanelUseSchema;
    const parsed = target.safeParse(value);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) ctx.addIssue(issue);
    return z.NEVER;
  });

/** Entry table item exposed by the catalog and frame menu. */
export const applicationMenuEntrySchema = z.union([applicationPanelUseSchema, frameConversationEntrySchema, builtinNativeEntrySchema]);
export type ApplicationMenuEntry = z.infer<typeof applicationMenuEntrySchema>;

export function isNativeApplicationEntry(entry: ApplicationMenuEntry): entry is BuiltinNativeEntry {
  return "kind" in entry && entry.kind === "native";
}

export function isFrameConversationEntry(entry: ApplicationMenuEntry): entry is FrameConversationEntry {
  return "kind" in entry && entry.kind === "frame-conversation";
}

export function isApplicationPanelUse(entry: ApplicationMenuEntry): entry is ApplicationPanelUse {
  return "panelId" in entry;
}

export const panelUseRefSchema = z.object({ applicationId: id, useId: id }).strict();
export type PanelUseRef = z.infer<typeof panelUseRefSchema>;

export const applicationEntryResolutionQuerySchema = z.union([
  z.object({ path: applicationPanelUsePathSchema }).strict(),
  panelUseRefSchema,
]);
export type ApplicationEntryResolutionQuery = z.infer<typeof applicationEntryResolutionQuerySchema>;
export const applicationEntryMenuSchema = z.object({
  names: applicationMetadataSchema.shape.names.optional(),
  groups: applicationMetadataSchema.shape.groups,
  panelUses: z.array(applicationMenuEntrySchema),
}).strict();
export type ApplicationEntryMenu = z.infer<typeof applicationEntryMenuSchema>;

export const applicationEntryResolutionSchema = z.object({
  applicationId: id,
  use: panelApplicationEntryUseSchema,
  framePanelId: id.optional(),
  theme: panelThemeOverridesSchema.optional(),
  menu: applicationEntryMenuSchema,
}).strict();
export type ApplicationEntryResolution = z.infer<typeof applicationEntryResolutionSchema>;

/** Only the host hands this context to an application's frame. */
export const currentApplicationEntrySchema = panelUseRefSchema.extend({
  pageKey: applicationPanelUseSchema.shape.pageKey,
  panelId: applicationPanelUseSchema.shape.panelId.optional(),
  kind: z.enum(["panel", "native", "frame-conversation"]).optional(),
  path: applicationPanelUsePathSchema,
}).readonly();
export type CurrentApplicationEntry = z.infer<typeof currentApplicationEntrySchema>;

export const applicationFrameContextSchema = z.object({
  currentEntry: currentApplicationEntrySchema,
  menu: applicationEntryMenuSchema,
}).strict().readonly();
export type ApplicationFrameContext = z.infer<typeof applicationFrameContextSchema>;

export function applicationFrameContextOf({ applicationId, use, menu }: ApplicationEntryResolution): ApplicationFrameContext {
  const { id: useId, pageKey, path } = use;
  const placement = isFrameConversationEntry(use)
    ? { kind: use.kind }
    : { kind: "panel", panelId: use.panelId };
  return applicationFrameContextSchema.parse({ currentEntry: { applicationId, useId, pageKey, path, ...placement }, menu });
}

/** Origin of reads on a frame's own members. Resolve the granted frame from the application use. */
export const applicationFrameSourceSchema = panelUseRefSchema.extend({ kind: z.literal("frame") });
export type ApplicationFrameSource = z.infer<typeof applicationFrameSourceSchema>;

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
  /** Submit on creation or when the icon changes. Unchanged stored values are not checked here. */
  icon: domainApplicationIconSchema.optional(),
  framePanelId: id.optional(),
  frameConversationEntryIds: z.array(id).optional(),
  uses: z.array(applicationPanelUseSchema.pick({ id: true, panelId: true, inputs: true, defaultAgent: true, pageComposer: true }).extend({
    icon: domainApplicationIconSchema.optional(),
  })),
  theme: applicationEntrySettings.theme,
  delivery: applicationDeliverySchema.pick({ panels: true, projections: true }),
}).strict();
export type ApplicationPanelReferencesRequest = z.infer<typeof applicationPanelReferencesRequestSchema>;

/** Java exposes registered entry facts to the authenticated provider service. */
export const panelSkillSourceSchema = panelUseRefSchema.extend({
  panelId: id,
  path: applicationPanelUsePathSchema,
  entrance: pageSkillEntranceSchema,
  names: z.record(z.string(), z.string()).optional(),
  applicationNames: z.record(z.string(), z.string()).optional(),
});
export type PanelSkillSource = z.infer<typeof panelSkillSourceSchema>;
export const panelSkillSourcesResponseSchema = z.array(panelSkillSourceSchema);
export const panelSkillSourcesQuerySchema = z.union([
  z.object({ domainId: id }).strict(),
  panelUseRefSchema.extend({ domainId: id }),
]);

/** The Java declaration is the sole takeover authority, including for legacy writers. */
export const panelApplicationEntrySchema = z.object({
  path,
  renderer: z.literal("panels"),
}).strict();
export type PanelApplicationEntry = z.infer<typeof panelApplicationEntrySchema>;

const [menuEntrance, domainMemberEntrance] = pageSkillEntranceSchema.options;
export const productPanelPageSkillContextQuerySchema = z.union([
  panelUseRefSchema.merge(menuEntrance),
  panelUseRefSchema.merge(domainMemberEntrance),
]);
export type ProductPanelPageSkillContextQuery = z.infer<typeof productPanelPageSkillContextQuerySchema>;
export const productPanelPageSkillContextResponseSchema = z.object({ pageSkillContext: pageSkillContextSchema }).strict();

export const applicationFrameReadQuerySchema = panelUseRefSchema.extend({ source: applicationFrameSourceSchema.shape.kind });
/** Record and snapshot reads accept the same content or frame entry. A frame has no content page-skill context. */
export const productPanelReadQuerySchema = z.union([
  z.object({}).strict(),
  ...productPanelPageSkillContextQuerySchema.options,
  applicationFrameReadQuerySchema,
]);
export const productPanelSnapshotQuerySchema = productPanelReadQuerySchema;
export type ProductPanelReadQuery = z.infer<typeof productPanelReadQuerySchema>;

const includeProjectionsQuery = { includeProjections: z.literal("1").optional() };
const [menuPanelReadQuery, domainMemberPanelReadQuery] = productPanelPageSkillContextQuerySchema.options;
/** Panel record GET accepts the standard read query plus optional `includeProjections=1` bundling of fixed members. */
export const productPanelGetQuerySchema = z.union([
  z.object(includeProjectionsQuery).strict(),
  menuPanelReadQuery.extend(includeProjectionsQuery).strict(),
  domainMemberPanelReadQuery.extend(includeProjectionsQuery).strict(),
  applicationFrameReadQuerySchema.extend(includeProjectionsQuery).strict(),
]);
export type ProductPanelGetQuery = z.infer<typeof productPanelGetQuerySchema>;

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

/** The authorized render read may include source for the one component the projection names. */
export const productProjectionRenderResponseSchema = productProjectionResponseSchema.extend({
  domainComponent: domainComponentRuntimeSchema.optional(),
});
export type ProductProjectionRenderResponse = z.infer<typeof productProjectionRenderResponseSchema>;

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

/**
 * One fixed projection member bundled into a panel record read (`?includeProjections=1`): either the authorized render
 * payload, or a per-member 403/404 isolation state so one unavailable member does not fail the whole panel read.
 */
export const bundledPanelProjectionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    projection: currentProjectionRecordSchema,
    domainComponent: domainComponentRuntimeSchema.optional(),
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    httpStatus: z.union([z.literal(403), z.literal(404)]),
    message: z.string(),
  }).strict(),
]);
export type BundledPanelProjection = z.infer<typeof bundledPanelProjectionSchema>;

export const productPanelResponseSchema = z.object({
  panel: currentPanelRecordSchema,
  pageSkillContext: pageSkillContextSchema.optional(),
  projections: z.record(id, bundledPanelProjectionSchema).optional(),
  /** Author-registered components declared in `panel.manifest.components` for direct template/slot rendering. */
  domainComponents: z.record(domainComponentIdSchema, domainComponentRuntimeSchema).optional(),
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
const projectionSummaryFields = {
  ...projectionDefinition.pick({ componentId: true }).shape,
  /** Derived object types bound by the projection's existing data, operation, or chart bindings. */
  objectTypes: z.array(z.string().min(1)).optional(),
};

const platformOperationOwners = new Map<string, string>();
for (const [typeId, declaration] of Object.entries(platformObjectTypes)) {
  for (const operationId of declaration.operations ?? []) {
    platformOperationOwners.set(operationId, typeId);
  }
}

/** Platform operation IDs owned by the given platform object type, used when matching operation-bound projections. */
export function platformOperationsOwnedByType(objectType: string): string[] {
  const entry = Object.hasOwn(platformObjectTypes, objectType) ? platformObjectTypes[objectType] : undefined;
  return entry?.operations ? [...entry.operations] : [];
}

/** Declared ontology layer for a platform object type, or null for customer ontology classes and unknown IDs. */
export function platformLayerOfObjectType(objectType: string): string | null {
  const entry = Object.hasOwn(platformObjectTypes, objectType) ? platformObjectTypes[objectType] : undefined;
  return entry?.layer ?? null;
}

function addConcreteBoundObjectType(target: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "@any" || trimmed === "@binding" || trimmed.startsWith("@data:")) return;
  target.add(trimmed);
}

function collectInputPortObjectTypes(target: Set<string>, port: unknown) {
  if (!port || typeof port !== "object" || Array.isArray(port)) return;
  const record = port as Record<string, unknown>;
  if (record.kind === "object") {
    addConcreteBoundObjectType(target, record.objectType);
    return;
  }
  if (record.kind === "child-object") {
    addConcreteBoundObjectType(target, record.parentType);
    return;
  }
  if (record.kind === "list") {
    const items = record.items;
    if (items && typeof items === "object" && !Array.isArray(items) && (items as Record<string, unknown>).kind === "object") {
      addConcreteBoundObjectType(target, (items as Record<string, unknown>).objectType);
    }
    return;
  }
  if (record.kind === "object-union") {
    if (Array.isArray(record.objectTypes)) {
      for (const item of record.objectTypes) addConcreteBoundObjectType(target, item);
    }
    if (Array.isArray(record.layers)) {
      const layerSet = new Set(record.layers.filter((item): item is string => typeof item === "string"));
      for (const [typeId, declaration] of Object.entries(platformObjectTypes)) {
        if (declaration.layer && layerSet.has(declaration.layer)) target.add(typeId);
      }
    }
  }
}

/**
 * Derive the sorted unique object type IDs bound by a projection definition from its existing facts:
 * data sources (type, literal object, input port), operation targets/platform-operation owners, and chart metricId.
 */
export function projectionBoundObjectTypes(definition: unknown): string[] {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return [];
  const def = definition as Record<string, unknown>;
  const inputs = def.inputs && typeof def.inputs === "object" && !Array.isArray(def.inputs)
    ? (def.inputs as Record<string, unknown>)
    : {};
  const types = new Set<string>();

  if (def.data && typeof def.data === "object" && !Array.isArray(def.data)) {
    for (const datum of Object.values(def.data as Record<string, unknown>)) {
      if (!datum || typeof datum !== "object" || Array.isArray(datum)) continue;
      const source = (datum as Record<string, unknown>).source;
      if (!source || typeof source !== "object" || Array.isArray(source)) continue;
      const src = source as Record<string, unknown>;
      if (src.type && typeof src.type === "object" && !Array.isArray(src.type)) {
        addConcreteBoundObjectType(types, (src.type as Record<string, unknown>).id);
        continue;
      }
      if (src.object && typeof src.object === "object" && !Array.isArray(src.object)) {
        const obj = src.object as Record<string, unknown>;
        if (obj.literal && typeof obj.literal === "object" && !Array.isArray(obj.literal)) {
          addConcreteBoundObjectType(types, (obj.literal as Record<string, unknown>).className);
        } else if (typeof obj.input === "string") {
          collectInputPortObjectTypes(types, inputs[obj.input]);
        }
      }
    }
  }

  if (def.operations && typeof def.operations === "object" && !Array.isArray(def.operations)) {
    for (const binding of Object.values(def.operations as Record<string, unknown>)) {
      if (!binding || typeof binding !== "object" || Array.isArray(binding)) continue;
      const opBinding = binding as Record<string, unknown>;
      if (opBinding.target && typeof opBinding.target === "object" && !Array.isArray(opBinding.target)) {
        const target = opBinding.target as Record<string, unknown>;
        if (target.literal && typeof target.literal === "object" && !Array.isArray(target.literal)) {
          addConcreteBoundObjectType(types, (target.literal as Record<string, unknown>).className);
        } else if (typeof target.input === "string") {
          collectInputPortObjectTypes(types, inputs[target.input]);
        }
      }
      if (opBinding.operation && typeof opBinding.operation === "object" && !Array.isArray(opBinding.operation)) {
        const op = opBinding.operation as Record<string, unknown>;
        if (op.kind === "PlatformOperation" && typeof op.id === "string") {
          addConcreteBoundObjectType(types, platformOperationOwners.get(op.id));
        }
      }
    }
  }

  if (typeof def.metricId === "string" && def.metricId.trim().length > 0) {
    types.add(METRIC_VIEW);
  }

  return [...types].sort();
}
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

const productCataloguePageSchema = z.object({
  nextCursor: productCatalogCursorSchema.nullable(),
  /** Total visible items matching the query filters, ignoring pagination cursor and page limit. */
  total: z.number().int().nonnegative().optional(),
}).strict();
export const productPanelListResponseSchema = productCataloguePageSchema.extend({
  items: z.array(productPanelSummarySchema),
  /** Only records this catalogue read is authorized to list can appear here. */
  unavailableItems: z.array(z.object({ id, reason: z.string().min(1), revision: currentRecordFields.revision.optional() }).strict()).optional(),
});
export const productProjectionListResponseSchema = productCataloguePageSchema.extend({
  items: z.array(productProjectionSummarySchema),
});
export type ProductPanelListResponse = z.infer<typeof productPanelListResponseSchema>;
export type ProductProjectionListResponse = z.infer<typeof productProjectionListResponseSchema>;

export const deleteProductCurrentQuerySchema = z.object({
  revision: z.coerce.number().pipe(currentRecordFields.revision),
}).strict();
/** A panel may be removed by ID even when its stored definition cannot supply a revision to the reader. */
export const deleteProductPanelQuerySchema = deleteProductCurrentQuerySchema.partial();
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
/** A guarded update is allowed only while this panel is the projection's sole user. */
export const PROJECTION_REUSE_PANEL_HEADER = "X-Ontomato-Projection-Reuse-Panel";
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
  panelUses: z.array(panelApplicationEntryUseSchema),
  /** Required when creating an application; omitted updates retain existing metadata and entry access. */
  declaration: applicationMetadataSchema.optional(),
  entryAccess: z.array(id).min(1).optional(),
  /** Optional initial domain sharing intent when creating an application. */
  shared: z.boolean().optional(),
  /** Whether the application allows standalone open (`standalone=1`) and exposes an external link; defaults to true. */
  allowStandalone: z.boolean().optional(),
  ...applicationEntrySettings,
}).strict();
export type RegisterApplicationPanelUsesRequest = z.infer<typeof registerApplicationPanelUsesRequestSchema>;

/** Current Java-owned entry and use relations; Java owns their access checks. */
export const applicationPanelUsesResponseSchema = z.object({
  applicationId: id,
  entry: z.object({ path, renderer: id, home: path.optional() }).strict(),
  panelUses: z.array(applicationMenuEntrySchema),
}).strict();
export type ApplicationPanelUsesResponse = z.infer<typeof applicationPanelUsesResponseSchema>;

/** A maintenance read is the full declaration and uses, independent of the viewer's visible menu. */
export const applicationPanelUsesManagementSchema = applicationPanelUsesResponseSchema.extend({
  panelUses: z.array(panelApplicationEntryUseSchema),
  declaration: applicationMetadataSchema,
  entryAccess: z.array(id).min(1),
  allowStandalone: z.boolean().optional(),
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
