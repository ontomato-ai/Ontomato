import { z } from "zod";
import { pageContextSchema } from "./page-context";
import { panelOpenRequestSchema, panelOperationSchema, panelStateValueSchema } from "./panel-manifest";
import { productPanelSchema } from "./product-panels";

/*
 * The port between a panel host and the frame a panel runs in (overall design 3.3, 3.4). A panel's content is text —
 * HTML and a module — so it runs in its own frame, where the SDK it names is the one the platform serves. The host owns
 * the address and the current record; the frame owns the instance. The state that may travel in an address is the
 * panel's declared deep-linkable state, and the host is what writes it there: a credential never appears in a message.
 */

export const PANEL_HOST_CHANNEL = "ontomato-panel-v1";

/** What the host writes into a panel frame's document before its module runs: the run's facts, as one JSON value. */
export const panelHostMessageSchema = z
  .object({
    kind: z.literal("panel-host-message"),
    /** The current panel record, read under this application use's Grant. */
    panel: productPanelSchema,
    /** This instance's registration key: the application use's pageKey. */
    pageKey: z.string().min(1).max(200),
    /** The instance's address, as the reader and a message see it. */
    url: z.string().min(1).max(4000),
    label: z.string().min(1).max(500),
    /** The declared deep-linkable state to restore, as the host read it from the address. */
    state: z.record(z.string(), panelStateValueSchema),
  })
  .strict();
export type PanelHostMessage = z.infer<typeof panelHostMessageSchema>;

/** What a running panel frame tells its host. */
export const panelFrameMessageSchema = z.discriminatedUnion("kind", [
  /** What a message from this instance carries now: the one page context line. */
  z.object({ kind: z.literal("context"), context: pageContextSchema }).strict(),
  /** The instance's deep-linkable state, which the host keeps in the address. */
  z.object({ kind: z.literal("state"), state: z.record(z.string(), panelStateValueSchema) }).strict(),
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
  /** The frame's answer to a panel definition change: nothing was unsaved, so the host may open it again. */
  z.object({ kind: z.literal("reloaded"), reloaded: z.boolean() }).strict(),
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
  /** The panel's own definition changed; the host has already decided it may be shown. */
  z.object({ kind: z.literal("definition-changed"), panel: productPanelSchema }).strict(),
  /**
   * One projection's definition changed, by ID. The instance reads that projection again and redraws it where it is
   * used; a projection no slot of this panel names is not read at all.
   */
  z.object({ kind: z.literal("projection-changed"), projectionId: z.string().min(1).max(200) }).strict(),
  /**
   * A person clicked one of the instance's operations in the platform's header. The frame runs it with that person's
   * own credential; an agent's call never comes this way. `requestId` pairs the answer with this call alone.
   */
  z.object({ kind: z.literal("invoke"), requestId: z.string().min(1).max(100), id: z.string().min(1).max(300), input: z.record(z.string(), z.unknown()).optional() }).strict(),
]);
export type PanelHostFrameMessage = z.infer<typeof panelHostFrameMessageSchema>;

/** One message on the panel channel as it arrives: the channel's own key, and the message it carries. */
export function panelMessageOf<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, event: { data?: unknown }): T | null {
  const data = event.data as { channel?: unknown } | null;
  if (!data || data.channel !== PANEL_HOST_CHANNEL) return null;
  const { channel: _channel, ...message } = data as Record<string, unknown>;
  const parsed = schema.safeParse(message);
  return parsed.success ? parsed.data : null;
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
export function panelAddressState(address: string): Record<string, unknown> {
  const value = new URL(address, "http://page.invalid").searchParams.get("state");
  return value === null ? {} : panelOpenRequestSchema.shape.state.parse(JSON.parse(value));
}
