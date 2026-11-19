import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { buildTestContextSchema } from "./build-tests";
import { pageContextSchema } from "./page-context";
import { pageDraftLinkSchema } from "./page-draft";
import { panelUseRefSchema } from "./panel-agent";
import { panelDeepLinkStateValueSchema, panelObjectIdentitySchema, panelOpenRequestSchema, panelOperationSchema, type PanelDeepLinkStateValue, type PanelObjectIdentity } from "./panel-manifest";
import { applicationPanelUseSchema, directPanelDefinitionContentSchema, directPanelSchema, panelDefinitionContentSchema, productPanelSchema } from "./product-panels";
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

export const directPanelHostSourceSchema = z.discriminatedUnion("kind", [
  registeredPanelSourceSchema.extend({ panel: directPanelSchema }),
  candidatePanelSourceSchema.extend({ panel: directPanelDefinitionContentSchema }),
]);
export type DirectPanelHostSource = z.infer<typeof directPanelHostSourceSchema>;

export const productPanelReadSourceSchema = z.discriminatedUnion("kind", [
  panelUseRefSchema.extend({ kind: z.literal("registered") }),
  candidatePanelSourceSchema.pick({ kind: true, workspace: true }),
]);
export type ProductPanelReadSource = z.infer<typeof productPanelReadSourceSchema>;

/** The first direct instance reads one named item of a fixed member. */
export const directPanelMemberPathSchema = z.tuple([z.object({ member: z.string().min(1).max(200) }).strict()]);
export type DirectPanelMemberPath = z.infer<typeof directPanelMemberPathSchema>;

export const productPanelReadRequestSchema = z.object({
  source: productPanelReadSourceSchema,
  memberPath: directPanelMemberPathSchema,
  dataName: z.string().min(1).max(200),
  inputs: runtimeJsonObjectSchema,
}).strict();
export type ProductPanelReadRequest = z.infer<typeof productPanelReadRequestSchema>;

const panelReadResults = [
  z.object({ status: z.literal("ready"), value: runtimeJsonValueSchema }).strict(),
  z.object({ status: z.literal("empty") }).strict(),
  z.object({ status: z.literal("error"), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal("forbidden") }).strict(),
] as const;
export const productPanelReadResponseSchema = z.discriminatedUnion("status", panelReadResults);
export type ProductPanelReadResponse = z.infer<typeof productPanelReadResponseSchema>;
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
    state: z.record(z.string(), panelDeepLinkStateValueSchema),
  })
  .strict();
export type PanelHostMessage = z.infer<typeof panelHostMessageSchema>;

/** What a running panel frame tells its host. */
export const panelFrameMessageSchema = z.discriminatedUnion("kind", [
  /** What a message from this instance carries now: the one page context line. */
  z.object({ kind: z.literal("context"), context: pageContextSchema }).strict(),
  /** The instance's deep-linkable state, which the host keeps in the address. */
  z.object({ kind: z.literal("state"), fromAddress: z.string().min(1).max(4000), state: z.record(z.string(), panelDeepLinkStateValueSchema) }).strict(),
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

const panelCapacityPageSchema = z.object({
  /** Stable identity from the display host, scoped to its application, user and conversation or candidate source. */
  instance: z.string().min(1),
  /** Query/state may change while the instance identity stays the same. */
  address: z.string().max(4000),
}).strict();

/** The existing leave guard has finished before the display requests a capacity plan. */
export const panelCapacityRequestSchema = z.object({
  current: panelCapacityPageSchema.nullable(),
  next: panelCapacityPageSchema.nullable(),
  departure: z.enum(["retain-clean", "discarded"]),
}).strict();
export type PanelCapacityRequest = z.infer<typeof panelCapacityRequestSchema>;

export const panelCapacityPlanSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("admitted"),
    next: z.enum(["reuse", "mount", "none"]),
    reclaim: z.array(panelCapacityPageSchema.shape.instance),
  }).strict(),
  z.object({ kind: z.literal("refused") }).strict(),
]);
export type PanelCapacityPlan = z.infer<typeof panelCapacityPlanSchema>;

export type PanelCapacityAdmission =
  | Extract<PanelCapacityPlan, { kind: "refused" }>
  | (Extract<PanelCapacityPlan, { kind: "admitted" }> & {
    /** Apply the plan once the switch is confirmed. A refused write discards the plan without calling this. */
    commit(): void;
  });

/** The display remains authoritative. Admission plans reuse or reclamation without changing the shown page. */
export interface PanelCapacityPort {
  admit(request: PanelCapacityRequest): PanelCapacityAdmission | Promise<PanelCapacityAdmission>;
}

/** One message on the panel channel as it arrives: the channel's own key, and the message it carries. */
export function panelMessageOf<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, event: { data?: unknown }): T | null {
  const data = event.data as { channel?: unknown } | null;
  if (!data || data.channel !== PANEL_HOST_CHANNEL) return null;
  const { channel: _channel, ...message } = data as Record<string, unknown>;
  const parsed = schema.safeParse(message);
  return parsed.success ? parsed.data : null;
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
