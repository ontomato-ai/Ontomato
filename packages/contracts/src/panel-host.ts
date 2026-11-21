import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { buildTestContextSchema } from "./build-tests";
import { pageContextSchema } from "./page-context";
import { pageDraftLinkSchema } from "./page-draft";
import { panelUseRefSchema } from "./panel-agent";
import {
  matchesDirectPanelValue, panelMemberPathSchema, panelMemberPathSegmentSchema, panelObjectIdentitySchema, panelObjectRefSchema,
  panelOpenRequestSchema, panelOperationSchema, type PanelDeepLinkStateValue, type PanelManifest, type PanelObjectIdentity,
} from "./panel-manifest";
import { panelOwnerOperationDescriptorSchema } from "./panel-operations";
import { panelLocalOperationNameSchema } from "./panel-projection";
import { applicationPanelUsePathSchema, applicationPanelUseSchema, panelDefinitionContentSchema, productPanelSchema } from "./product-panels";
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

export const productPanelReadSourceSchema = z.discriminatedUnion("kind", [
  panelUseRefSchema.extend({ kind: z.literal("registered") }),
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
}).strict();
export type ProductPanelNestedReadResponse = z.infer<typeof productPanelNestedReadResponseSchema>;

const panelMemberReadRequestSchema = z.object({
  source: productPanelReadSourceSchema,
  memberPath: directPanelMemberPathSchema,
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
  source: productPanelReadSourceSchema.options[0],
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

const panelReadResults = [
  z.object({ status: z.literal("ready"), value: runtimeJsonValueSchema }).strict(),
  z.object({ status: z.literal("empty") }).strict(),
  z.object({ status: z.literal("error"), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal("forbidden") }).strict(),
] as const;
export const productPanelReadResponseSchema = z.discriminatedUnion("status", panelReadResults);
export type ProductPanelReadResponse = z.infer<typeof productPanelReadResponseSchema>;
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
   * The reader saved or discarded this linked draft. The host removes only its draft parameters if its current
   * address still names that artifact; it reflects the resulting address through the normal address message.
   */
  z.object({ kind: z.literal("draft-settled"), draft: pageDraftLinkSchema }).strict(),
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
  z.object({ kind: z.literal("object-changed"), target: panelObjectIdentitySchema.nullable() }).strict(),
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

/** Split a canonical site route, as supplied by the router, into its two state sections and other query parameters. */
export function parseApplicationPanelAddress(address: string) {
  const separator = address.indexOf("?");
  const path = applicationPanelUsePathSchema.parse(separator < 0 ? address : address.slice(0, separator));
  const query = new URLSearchParams(separator < 0 ? "" : address.slice(separator + 1));
  function read(section: "frame" | "state"): unknown {
    const values = query.getAll(section);
    if (values.length === 0) return {};
    if (values.length > 1) throw new Error(`The panel address supplies '${section}' more than once`);
    query.delete(section);
    try {
      return JSON.parse(values[0]!);
    } catch {
      throw new Error(`Invalid JSON in the panel address's '${section}' section`);
    }
  }
  return { path, ...addressSections.parse({ frame: read("frame"), state: read("state") }), query };
}

/** Encode the resolved frame and content state once, preserving other query parameters such as a draft link. */
export function applicationPanelAddress(path: string, {
  frame = {}, state = {}, query,
}: { frame?: PanelAddressState; state?: PanelAddressState; query?: URLSearchParams } = {}): string {
  const route = applicationPanelUsePathSchema.parse(path);
  const values = addressSections.parse({ frame, state });
  const params = new URLSearchParams(query);
  for (const section of ["frame", "state"] as const) {
    params.delete(section);
    if (Object.keys(values[section]).length > 0) params.set(section, JSON.stringify(values[section]));
  }
  const search = params.toString();
  return search ? `${route}?${search}` : route;
}

/** Verify address inputs after resolving the definitions, and remove keys owned by the entry's declared wiring. */
export function validateApplicationPanelAddressState(
  section: "frame" | "state",
  values: PanelAddressState,
  manifest: Pick<PanelManifest, "state"> | undefined,
  controlled: readonly string[] = [],
): PanelAddressState {
  return Object.fromEntries(Object.entries(values).filter(([name, value]) => {
    if (controlled.includes(name)) return false;
    const fields = manifest?.state;
    const field = fields && Object.hasOwn(fields, name) ? fields[name] : undefined;
    if (!field?.deepLink) throw new Error(`Panel address field '${section}.${name}' is not declared for deep linking`);
    if (!matchesDirectPanelValue(field.type, value)) {
      throw new Error(`Panel address field '${section}.${name}' does not match its declared type`);
    }
    return true;
  }));
}

/** The route owned by the application use. */
export function panelUsePath(path: string): string {
  return path;
}

/**
 * The address a panel instance is at: the page's own address with the state it restores — and nothing else. The page's
 * other parameters are kept, its own `state` is replaced, and a page with no state carries none, so an address is the
 * same page whatever the reader has selected in it.
 */
export function panelAddress(path: string, state: Record<string, unknown>): string {
  const values = panelOpenRequestSchema.shape.state.parse(state);
  const [route, search = ""] = path.split("?");
  const query = new URLSearchParams(search);
  query.delete("state");
  if (Object.keys(values).length) query.set("state", JSON.stringify(values));
  const rest = query.toString();
  return rest ? `${route}?${rest}` : route!;
}

/** The state an address restores, or none. The host checks it against the panel's declaration before using it. */
export function panelAddressState(address: string): Record<string, PanelDeepLinkStateValue> {
  const value = new URL(address, "http://page.invalid").searchParams.get("state");
  return value === null ? {} : panelOpenRequestSchema.shape.state.parse(JSON.parse(value));
}
