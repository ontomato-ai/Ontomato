import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { buildTestContextSchema } from "./build-tests";
import { pageContextSchema } from "./page-context";
import { panelUseRefSchema } from "./panel-agent";
import {
  normalizePanelDeepLinkState, normalizeExternalPanelValue, panelChildObjectIdentitySchema,
  panelMemberPathSchema, panelMemberPathSegmentSchema,
  panelObjectIdentitySchema, panelObjectRefSchema, panelOpenRequestSchema, panelOperationSchema,
  panelOperationUnavailableSchema, type DirectPanelPortType, type PanelDeepLinkStateValue,
  type PanelManifest, type PanelObjectIdentity, type PanelStateField,
} from "./panel-manifest";
import { domainComponentIdSchema, domainComponentRuntimeSchema } from "./domain-component-runtime";
import { panelCompletedOperationSchema, panelOperationAffectedSchema, panelOwnerOperationDescriptorSchema } from "./panel-operations";
import { panelLocalOperationNameSchema } from "./panel-projection";
import { applicationFrameSourceSchema, applicationPanelUsePathSchema, applicationPanelUseSchema, panelDefinitionContentSchema, productPanelSchema } from "./product-panels";
import { productCurrentIdParamsSchema } from "./product-record-id";
import { definitionRevisionSchema, type ProductDefinitionRevision, type ProductDefinitionTarget } from "./product-subscriptions";
import { workspaceDiffSchema, workspaceIdSchema } from "./workspaces";

/*
 * The port between a panel host and the frame a panel runs in (overall design 3.3, 3.4). A panel's content is text —
 * HTML and a module — so it runs in its own frame, where the SDK it names is the one the platform serves. The host owns
 * the address and the current record; the frame owns the instance. The state that may travel in an address is the
 * panel's declared deep-linkable state, and the host is what writes it there: a credential never appears in a message.
 */

export const PANEL_HOST_CHANNEL = "ontomato-panel-v1";

/** The formal host source, after application use and current record have been read under the reader's permissions. */
export const registeredPanelSourceSchema = z.object({
  kind: z.literal("registered"),
  applicationId: z.string().min(1),
  use: applicationPanelUseSchema,
  panel: productPanelSchema,
}).strict();

/** The author-only source. Only the host installs this workspace's execution context into the request bridge. */
export const candidatePanelSourceSchema = z.object({
  kind: z.literal("candidate"),
  workspace: z.object({ id: workspaceIdSchema, ref: workspaceDiffSchema.shape.to }).strict(),
  panel: panelDefinitionContentSchema,
  /** Author-registered components declared in `panel.manifest.components`, bundled for preview rendering. */
  domainComponents: z.record(domainComponentIdSchema, domainComponentRuntimeSchema).optional(),
  previewContext: z.object({
    kind: z.literal("build-test"),
    /** Null is the existing build-test NONE state; it never denotes live execution. */
    test: buildTestContextSchema.nullable(),
  }).strict(),
}).strict();

export const panelHostSourceSchema = z.discriminatedUnion("kind", [registeredPanelSourceSchema, candidatePanelSourceSchema]);
export type PanelHostSource = z.infer<typeof panelHostSourceSchema>;
export type CandidatePanelSource = z.infer<typeof candidatePanelSourceSchema>;

export const directPanelHostSourceSchema = panelHostSourceSchema;
export type DirectPanelHostSource = PanelHostSource;

const registeredPanelReadSourceSchema = panelUseRefSchema.extend({ kind: z.literal("registered") });
export const productPanelReadSourceSchema = z.discriminatedUnion("kind", [
  registeredPanelReadSourceSchema,
  applicationFrameSourceSchema,
  candidatePanelSourceSchema.pick({ kind: true, workspace: true }),
]);
export type ProductPanelReadSource = z.infer<typeof productPanelReadSourceSchema>;

/** Resolve each segment against its parent before reading the named datum at the last member. */
export const directPanelMemberPathSchema = panelMemberPathSchema.nonempty();
export type DirectPanelMemberPath = z.infer<typeof directPanelMemberPathSchema>;

/** A projection definition requested for rendering in the deployment's current SDK. */
export const PANEL_MEMBER_RENDER_HEADER = "X-Ontomato-Panel-Member-Render";

const unresolvedObjectDetailSegmentSchema = panelMemberPathSegmentSchema.extend({
  selection: z.object({ stateValue: panelObjectRefSchema }).strict(),
});

const nestedPanelMemberPathSchema = z.array(z.union([
  panelMemberPathSegmentSchema,
  unresolvedObjectDetailSegmentSchema,
])).nonempty().superRefine((path, ctx) => {
  for (const [index, { selection }] of path.slice(0, -1).entries()) {
    if (selection && "stateValue" in selection && !("target" in selection)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "selection", "target"],
        message: "Only the final object detail placement may omit its target",
      });
    }
  }
});

/** Read the current contents reached through an authorized placement.
 * The resolver checks the actual member's objectDetail rule before deriving an omitted terminal target.
 */
export const PANEL_NESTED_READ_PATH = "/product-panels/nested";
export const productPanelNestedReadRequestSchema = z.object({
  source: productPanelReadSourceSchema,
  memberPath: nestedPanelMemberPathSchema,
}).strict();
export type ProductPanelNestedReadRequest = z.infer<typeof productPanelNestedReadRequestSchema>;

export const productPanelNestedReadResponseSchema = z.object({
  panel: panelDefinitionContentSchema.pick({ content: true, manifest: true, theme: true }).extend({
    id: productCurrentIdParamsSchema.shape.id,
    revision: definitionRevisionSchema.shape.revision,
  }),
  /** Author-registered components declared in the nested panel's `manifest.components`. */
  domainComponents: z.record(domainComponentIdSchema, domainComponentRuntimeSchema).optional(),
}).strict();
export type ProductPanelNestedReadResponse = z.infer<typeof productPanelNestedReadResponseSchema>;

const readPanelMemberPathSegmentSchema = panelMemberPathSegmentSchema.omit({ itemKey: true });
const readPanelMemberPathSchema = z.array(readPanelMemberPathSegmentSchema).nonempty();

const panelMemberReadRequestSchema = z.object({
  source: productPanelReadSourceSchema,
  /** Reads carry normal memberPath and inputs. */
  memberPath: readPanelMemberPathSchema,
  inputs: runtimeJsonObjectSchema,
  /** Component-supplied parameter values for this datum, separate from the projection's bound inputs. */
  runtimeParams: runtimeJsonObjectSchema.optional(),
}).strict();
export const productPanelReadRequestSchema = z.union([
  panelMemberReadRequestSchema.extend({ dataName: z.string().min(1).max(200) }),
  panelMemberReadRequestSchema.extend({ operations: z.literal(true) }),
]);
export type ProductPanelReadRequest = z.infer<typeof productPanelReadRequestSchema>;

const panelPersonalStateScopeSchema = z.object({
  source: z.discriminatedUnion("kind", [registeredPanelReadSourceSchema, applicationFrameSourceSchema]),
  memberPath: panelMemberPathSchema,
}).strict();
export const PANEL_PERSONAL_STATE_PATH = "/product-panels/personal-state";
export const PANEL_PERSONAL_STATE_READ_PATH = `${PANEL_PERSONAL_STATE_PATH}/read`;
export const panelPersonalStateReadRequestSchema = panelPersonalStateScopeSchema.extend({
  fields: z.array(z.string().min(1)).nonempty(),
});
export const panelPersonalStateResponseSchema = z.object({ values: runtimeJsonObjectSchema }).strict();
/** A missing key leaves the stored field alone; an explicit null clears its value. */
export const panelPersonalStateWriteRequestSchema = panelPersonalStateScopeSchema.extend(panelPersonalStateResponseSchema.shape);
export type PanelPersonalStateReadRequest = z.infer<typeof panelPersonalStateReadRequestSchema>;
export type PanelPersonalStateWriteRequest = z.infer<typeof panelPersonalStateWriteRequestSchema>;
export type PanelPersonalStateResponse = z.infer<typeof panelPersonalStateResponseSchema>;

/** Per-row availability of one declared operation on a list projection, returned in batch alongside list rows. */
export const panelRowOperationAvailabilitySchema = z.object({
  available: z.boolean(),
  unavailable: panelOperationUnavailableSchema.optional(),
}).strict();
export type PanelRowOperationAvailability = z.infer<typeof panelRowOperationAvailabilitySchema>;

/** Map from row key (`primaryKey` or `${className}:${primaryKey}`) -> local operation name -> availability status. */
export const panelRowOperationsMapSchema = z.record(
  z.string().min(1),
  z.record(panelLocalOperationNameSchema, panelRowOperationAvailabilitySchema),
);
export type PanelRowOperationsMap = z.infer<typeof panelRowOperationsMapSchema>;

const panelReadResults = [
  z.object({
    status: z.literal("ready"),
    value: runtimeJsonValueSchema,
    /** Batch per-row operation availability returned together with list query data to eliminate N+1 requests. */
    rowOperations: panelRowOperationsMapSchema.optional(),
  }).strict(),
  z.object({ status: z.literal("empty") }).strict(),
  z.object({ status: z.literal("error"), message: z.string().min(1), code: z.string().min(1).optional() }).strict(),
  z.object({ status: z.literal("forbidden"), reason: z.string().min(1).optional() }).strict(),
] as const;
export const productPanelReadResponseSchema = z.discriminatedUnion("status", panelReadResults);
export type ProductPanelReadResponse = z.infer<typeof productPanelReadResponseSchema>;

export const PANEL_READ_BATCH_PATH = "/product-panels/read-batch";
export const PANEL_READ_BATCH_MAX = 50;
export const productPanelReadBatchRequestSchema = z.object({
  reads: z.array(productPanelReadRequestSchema).nonempty().max(PANEL_READ_BATCH_MAX),
}).strict();
export const productPanelReadBatchResponseSchema = z.object({
  results: z.array(productPanelReadResponseSchema),
}).strict();
export type ProductPanelReadBatchRequest = z.infer<typeof productPanelReadBatchRequestSchema>;
export type ProductPanelReadBatchResponse = z.infer<typeof productPanelReadBatchResponseSchema>;
export const productPanelOperationsReadResponseSchema = z.discriminatedUnion("status", [
  panelReadResults[0].extend({ value: z.record(panelLocalOperationNameSchema, panelOwnerOperationDescriptorSchema) }),
  panelReadResults[1], panelReadResults[2], panelReadResults[3],
]);
export type ProductPanelOperationsReadResponse = z.infer<typeof productPanelOperationsReadResponseSchema>;
export const panelDataStateSchema = z.discriminatedUnion("status", [
  ...panelReadResults, z.object({ status: z.literal("loading") }).strict(),
]);
export type PanelDataState = z.infer<typeof panelDataStateSchema>;

/** What the host writes into a panel frame's document before its module runs: the run's facts, as one JSON value. */
export const panelHostMessageSchema = z
  .object({
    kind: z.literal("panel-host-message"),
    /** Only the renderable portion of the host source crosses into the frame. */
    panel: panelDefinitionContentSchema,
    /** This instance's registration key: the application use's pageKey. */
    pageKey: z.string().min(1).max(200),
    /** The effective application use shared with the skill. Candidates have no use and cannot write an operation. */
    use: panelUseRefSchema.nullable(),
    /** The instance's address, as the reader and a message see it. */
    url: z.string().min(1).max(4000),
    label: z.string().min(1).max(500),
    /** The declared deep-linkable state to restore, as the host read it from the address. */
    state: runtimeJsonObjectSchema,
  })
  .strict();
export type PanelHostMessage = z.infer<typeof panelHostMessageSchema>;

/** What a running panel frame tells its host. */
export const panelFrameMessageSchema = z.discriminatedUnion("kind", [
  /** What a message from this instance carries now: the one page context line. */
  z.object({ kind: z.literal("context"), context: pageContextSchema }).strict(),
  /** The instance's deep-linkable state, which the host keeps in the address. */
  z.object({ kind: z.literal("state"), fromAddress: z.string().min(1).max(4000), state: runtimeJsonObjectSchema }).strict(),
  /**
   * The operations this instance offers, as the header and an agent list them. They are the panel's projections' and its
   * own declaration's; the frame runs one when the host asks it to.
   */
  z.object({ kind: z.literal("operations"), operations: z.array(panelOperationSchema).max(100) }).strict(),
  /** The answer to one invocation, or the failure that stopped it: paired with the call by the request ID the host sent. */
  z.object({ kind: z.literal("invoked"), requestId: z.string().min(1).max(100), result: z.unknown().optional(), error: z.string().optional() }).strict(),
  /**
   * Whether the instance holds unsaved changes. The host asks before it replaces the panel's definition, and never
   * reloads over an answer of `true`: the form on screen is the reader's.
   */
  z.object({ kind: z.literal("dirty"), dirty: z.boolean() }).strict(),
  /**
   * The frame could not run its panel: a module the import map does not serve, a syntax error, or a component that threw
   * while mounting. The host shows it where the panel would have been — a frame that draws nothing and says nothing is
   * the one failure a reader cannot act on.
   */
  z.object({ kind: z.literal("failed"), message: z.string().min(1).max(2000) }).strict(),
]);
export type PanelFrameMessage = z.infer<typeof panelFrameMessageSchema>;

/** What the host tells a running panel frame. */
export const panelHostFrameMessageSchema = z.discriminatedUnion("kind", [
  /** A link changed the address of this same instance. */
  z.object({ kind: z.literal("address"), address: z.string().min(1).max(4000) }).strict(),
  /** Active only while the tab is visible, this instance is current, and its placement and parent are expanded. */
  z.object({ kind: z.literal("activity"), active: z.boolean() }).strict(),
  z.object({
    kind: z.literal("object-changed"),
    target: panelObjectIdentitySchema.nullable(),
    operation: panelCompletedOperationSchema.optional(),
    affected: panelOperationAffectedSchema.optional(),
  }).strict(),
  z.object({ kind: z.literal("projections-changed"), projections: z.array(definitionRevisionSchema) }).strict(),
  /**
   * A person clicked one of the instance's operations in the platform's header. The frame runs it with that person's
   * own credential; an agent's call never comes this way. `requestId` pairs the answer with this call alone.
   */
  z.object({ kind: z.literal("invoke"), requestId: z.string().min(1).max(100), id: z.string().min(1).max(300), input: z.record(z.string(), z.unknown()).optional() }).strict(),
]);
export type PanelHostFrameMessage = z.infer<typeof panelHostFrameMessageSchema>;

/** The author hosts in one document contribute targets to a single definition stream. */
export interface PanelAuthorDefinitions {
  observe(
    targets: readonly ProductDefinitionTarget[],
    onRevisions: (revisions: readonly ProductDefinitionRevision[]) => void,
    onError: (error: unknown) => void,
  ): {
    replace(targets: readonly ProductDefinitionTarget[]): void;
    close(): void;
  };
}

export type PanelDefinitionMode = { kind: "view" } | { kind: "author"; definitions: PanelAuthorDefinitions };

export interface PanelRefreshPort {
  refresh(target: PanelObjectIdentity | null): void;
}

/** One message on the panel channel as it arrives: the channel's own key, and the message it carries. */
export function panelMessageOf<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, event: { data?: unknown }): T | null {
  const data = event.data as { channel?: unknown } | null;
  if (!data || data.channel !== PANEL_HOST_CHANNEL) return null;
  const { channel: _channel, ...message } = data as Record<string, unknown>;
  const parsed = schema.safeParse(message);
  return parsed.success ? parsed.data : null;
}

type PanelAddressState = Record<string, PanelDeepLinkStateValue>;
const addressStateSchema = panelOpenRequestSchema.shape.state;
const addressSections = z.object({ frame: addressStateSchema, state: addressStateSchema }).strict();

/** Prefix used for application frame deep-link state parameters in canonical panel URLs (`frame.<name>=...`). */
export const PANEL_FRAME_QUERY_PREFIX = "frame.";

/**
 * Shell-owned query parameters that may appear alongside flat panel state in a route URL and must never be
 * interpreted as panel state or overwritten when panel state changes.
 */
export const PANEL_ADDRESS_RESERVED_QUERY_KEYS = [
  "standalone",
  "from",
  "navigationContext",
] as const;

const RESERVED_QUERY_KEY_SET: ReadonlySet<string> = new Set(PANEL_ADDRESS_RESERVED_QUERY_KEYS);

function isUnnamedQueryKey(key: string): boolean {
  return key === "" || key === PANEL_FRAME_QUERY_PREFIX;
}

function isReservedOrFrameKey(key: string): boolean {
  return RESERVED_QUERY_KEY_SET.has(key) || key.startsWith(PANEL_FRAME_QUERY_PREFIX);
}

function formatQueryString(params: URLSearchParams): string {
  // Keep RFC 3986 query characters `:` and `~` unencoded so URLs stay readable and match Vue Router fullPath.
  return params.toString().replaceAll("%3A", ":").replaceAll("%7E", "~");
}

function joinAddress(path: string, params: URLSearchParams): string {
  const search = formatQueryString(params);
  return search ? `${path}?${search}` : path;
}

function isPlainDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((item, index) => isPlainDeepEqual(item, b[index]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  return aKeys.length === bKeys.length
    && aKeys.every((k) => Object.hasOwn(b as object, k)
      && isPlainDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function encodeFlatItem(value: PanelDeepLinkStateValue, type?: DirectPanelPortType): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Panel address number state must be finite");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  const ref = panelObjectRefSchema.safeParse(value);
  if (ref.success) {
    if (type?.kind === "object" && type.objectType === ref.data.className && !ref.data.primaryKey.includes("~")) {
      return ref.data.primaryKey;
    }
    return `${ref.data.className}~${ref.data.primaryKey}`;
  }
  const child = panelChildObjectIdentitySchema.safeParse(value);
  if (child.success) {
    if (
      type?.kind === "child-object"
      && type.parentType === child.data.parent.objectType
      && !child.data.parent.primaryKey.includes("~")
    ) {
      return `${child.data.parent.primaryKey}~${child.data.primaryKey}`;
    }
    return `${child.data.parent.objectType}~${child.data.parent.primaryKey}~${child.data.primaryKey}`;
  }
  throw new Error(`Unsupported deep-link value in panel address: ${JSON.stringify(value)}`);
}

function hasNonEmptyDefault(field: PanelStateField): boolean {
  if (field.default === undefined || field.default === null) return false;
  if (field.type.kind === "scalar" && field.type.type === "string") return field.default !== "";
  if (field.type.kind === "list") return Array.isArray(field.default) && field.default.length > 0;
  return true;
}

/**
 * Encode one state field into flat query values.
 *
 * Values equal to the field's declared default are omitted to keep URLs clean. Conversely, clearing a field that
 * declares a non-empty / non-null default (`""` for string, `[]` for list, `null` for nullable scalar/object/list)
 * emits an explicit empty marker (`[""]` -> `?name=`) so reloading or restoring the URL keeps the cleared value
 * instead of snapping back to the default. For `list<string>`, an empty list writes `?name=` and restores as `[]`;
 * empty-string list items are not restored separately without auxiliary parameters.
 */
function encodeFlatStateValues(value: PanelDeepLinkStateValue, field?: PanelStateField): string[] {
  if (value === undefined) return [];
  if (field) {
    if (!field.deepLink) return [];
    if (field.default !== undefined && isPlainDeepEqual(value, field.default)) return [];
    if (value === null) {
      return hasNonEmptyDefault(field) ? [""] : [];
    }
    if (value === "" && (field.default === undefined || field.default === null || field.default === "")) return [];
    if (Array.isArray(value) && value.length === 0) {
      const type = field.type;
      const stringList = type.kind === "list" && type.items.kind === "scalar" && type.items.type === "string";
      return stringList || hasNonEmptyDefault(field) ? [""] : [];
    }
  } else {
    if (value === null) return [];
    if (Array.isArray(value) && value.length === 0) return [];
    // Without a manifest, preserve explicit `""` so round-tripping parsed flat query params
    // (such as `?tags=` or `?frame.term=`) never drops an explicit empty-override marker.
  }
  if (Array.isArray(value)) {
    const itemType = field?.type.kind === "list" ? field.type.items : undefined;
    return value.map((item) => encodeFlatItem(item, itemType));
  }
  return [encodeFlatItem(value, field?.type)];
}

function appendFlatState(
  params: URLSearchParams, name: string, value: PanelDeepLinkStateValue, field?: PanelStateField,
) {
  for (const item of encodeFlatStateValues(value, field)) params.append(name, item);
}

function collapseBucket(
  bucket: Record<string, string[]>,
  manifest?: Pick<PanelManifest, "state">,
): PanelAddressState {
  const raw: Record<string, PanelDeepLinkStateValue> = {};
  for (const [name, values] of Object.entries(bucket)) {
    raw[name] = values.length === 1 ? values[0]! : values;
  }
  return manifest ? normalizePanelDeepLinkState(manifest, raw) : raw;
}

/**
 * Split a canonical site route into its flat-encoded frame state (`frame.<name>`), entry state (`<name>`),
 * and preserved shell/other query parameters. When manifests are provided, declared `deepLink` fields are decoded
 * to their typed values and undeclared query keys remain in `query`.
 */
export function parseApplicationPanelAddress(
  address: string,
  options?: {
    frameManifest?: Pick<PanelManifest, "state">;
    stateManifest?: Pick<PanelManifest, "state">;
  },
) {
  const separator = address.indexOf("?");
  const path = applicationPanelUsePathSchema.parse(separator < 0 ? address : address.slice(0, separator));
  const rawParams = new URLSearchParams(separator < 0 ? "" : address.slice(separator + 1));
  const query = new URLSearchParams();
  const frameBucket: Record<string, string[]> = {};
  const stateBucket: Record<string, string[]> = {};

  for (const [key, value] of rawParams.entries()) {
    // Ignore unnamed query parameters (`?=x` or `?frame.=x`) so legacy/malformed URLs never produce empty state keys.
    if (isUnnamedQueryKey(key)) continue;
    if (RESERVED_QUERY_KEY_SET.has(key)) {
      query.append(key, value);
      continue;
    }
    if (key.startsWith(PANEL_FRAME_QUERY_PREFIX)) {
      const name = key.slice(PANEL_FRAME_QUERY_PREFIX.length);
      if (options?.frameManifest && !options.frameManifest.state[name]?.deepLink) {
        query.append(key, value);
      } else {
        (frameBucket[name] ??= []).push(value);
      }
      continue;
    }
    if (options?.stateManifest && !options.stateManifest.state[key]?.deepLink) {
      query.append(key, value);
    } else {
      (stateBucket[key] ??= []).push(value);
    }
  }

  return {
    path,
    frame: collapseBucket(frameBucket, options?.frameManifest),
    state: collapseBucket(stateBucket, options?.stateManifest),
    query,
  };
}

/**
 * Encode frame (`frame.<name>`) and content (`<name>`) deep-link state as flat named query parameters,
 * omitting null/empty/default values and preserving shell query parameters (such as `standalone`).
 */
export function applicationPanelAddress(path: string, {
  frame = {}, state = {}, query, frameManifest, stateManifest,
}: {
  frame?: PanelAddressState;
  state?: PanelAddressState;
  query?: URLSearchParams;
  frameManifest?: Pick<PanelManifest, "state">;
  stateManifest?: Pick<PanelManifest, "state">;
} = {}): string {
  const route = applicationPanelUsePathSchema.parse(path);
  const values = addressSections.parse({ frame, state });
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of query.entries()) {
      if (isUnnamedQueryKey(key) || key.startsWith(PANEL_FRAME_QUERY_PREFIX)) continue;
      params.append(key, value);
    }
  }
  for (const [name, value] of Object.entries(values.frame)) {
    const key = `${PANEL_FRAME_QUERY_PREFIX}${name}`;
    params.delete(key);
    appendFlatState(params, key, value, frameManifest?.state[name]);
  }
  for (const [name, value] of Object.entries(values.state)) {
    if (isReservedOrFrameKey(name)) continue;
    params.delete(name);
    appendFlatState(params, name, value, stateManifest?.state[name]);
  }
  return joinAddress(route, params);
}

/** Verify and normalize address inputs after resolving definitions, removing keys owned by the entry's declared wiring. */
export function validateApplicationPanelAddressState(
  section: "frame" | "state",
  values: PanelAddressState,
  manifest: Pick<PanelManifest, "state"> | undefined,
  controlled: readonly string[] = [],
): PanelAddressState {
  const result: PanelAddressState = {};
  for (const [name, value] of Object.entries(values)) {
    if (controlled.includes(name)) continue;
    const fields = manifest?.state;
    const field = fields && Object.hasOwn(fields, name) ? fields[name] : undefined;
    if (!field?.deepLink) throw new Error(`Panel address field '${section}.${name}' is not declared for deep linking`);
    const normalized = normalizeExternalPanelValue(field.type, value);
    if (!normalized.ok) {
      throw new Error(`Panel address field '${section}.${name}' does not match its declared type`);
    }
    result[name] = normalized.value;
  }
  return result;
}

/** The route owned by the application use. */
export function panelUsePath(path: string): string {
  return path;
}

/**
 * Build a panel address with flat named query parameters for its deep-linkable state.
 *
 * When `manifest` is supplied, every declared `deepLink` field in `manifest.state` is replaced from `state`
 * (omitting null, empty, and default values; encoding fixed-type objects as bare `primaryKey` and multi-type
 * `object-union` references as `className~primaryKey`), while all shell-reserved, `frame.*`, and non-deepLink query
 * parameters on `path` are preserved untouched. Without `manifest`, each key supplied in `state` is updated/removed
 * in place while preserving other query parameters.
 */
export function panelAddress(
  path: string,
  state: Record<string, unknown>,
  manifest?: Pick<PanelManifest, "state">,
): string {
  const values = panelOpenRequestSchema.shape.state.parse(state);
  const separator = path.indexOf("?");
  const route = separator < 0 ? path : path.slice(0, separator);
  const params = new URLSearchParams(separator < 0 ? "" : path.slice(separator + 1));
  params.delete("");
  params.delete(PANEL_FRAME_QUERY_PREFIX);
  if (manifest) {
    for (const [name, field] of Object.entries(manifest.state)) {
      if (!field.deepLink || isReservedOrFrameKey(name)) continue;
      params.delete(name);
    }
  }
  for (const [name, value] of Object.entries(values)) {
    if (isReservedOrFrameKey(name)) continue;
    if (manifest && !manifest.state[name]?.deepLink) continue;
    params.delete(name);
    appendFlatState(params, name, value, manifest?.state[name]);
  }
  return joinAddress(route, params);
}

/**
 * Extract the entry panel's flat query parameters from an address. Shell-reserved keys (`standalone`, `from`,
 * `navigationContext`, draft keys) and `frame.*` keys are excluded. When `manifest` is provided, values are decoded
 * and validated against `manifest.state` (invalid values are safely ignored).
 */
export function panelAddressState(
  address: string,
  manifest?: Pick<PanelManifest, "state">,
): Record<string, PanelDeepLinkStateValue> {
  const params = new URL(address, "http://page.invalid").searchParams;
  const bucket: Record<string, string[]> = {};
  for (const [key, value] of params.entries()) {
    if (isUnnamedQueryKey(key) || isReservedOrFrameKey(key)) continue;
    if (manifest && !manifest.state[key]?.deepLink) continue;
    (bucket[key] ??= []).push(value);
  }
  return collapseBucket(bucket, manifest);
}

/** The complete deep-link state restored by an address, including defaults for omitted fields. */
export function restoredPanelAddressState(
  address: string,
  manifest: Pick<PanelManifest, "state">,
): Record<string, PanelDeepLinkStateValue> {
  const decoded = panelAddressState(address, manifest);
  return Object.fromEntries(Object.entries(manifest.state)
    .filter(([, field]) => field.deepLink)
    .map(([name, field]) => [name, Object.hasOwn(decoded, name) ? decoded[name]! : field.default ?? null]));
}

/** A live patch on a bare address for the same page preserves its current deep-link state. */
export function presentationAppliesAddress(current: string, next: string, hasStatePatch: boolean): boolean {
  return !hasStatePatch || next.includes("?") || next.includes("#")
    || next.split(/[?#]/, 1)[0] !== current.split(/[?#]/, 1)[0];
}
