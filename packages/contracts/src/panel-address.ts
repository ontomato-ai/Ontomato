import {
  matchesDirectPanelValue, panelOpenRequestSchema,
  type PanelDeepLinkStateValue, type PanelState,
} from "./panel-manifest";
import { applicationPanelUsePathSchema } from "./product-panels";

/*
 * The one address of a panel page: `path?frame=<JSON>&state=<JSON>` (overall design §3, "one address, one route").
 *
 * - `path` is Java's canonical route for the entry, with no query and no fragment.
 * - `frame` is the outer panel's state: what the application shares across its pages, so a term chosen once survives a
 *   jump, a reload, a browser-back, a full-page open and the same page beside a conversation. It leaves the address.
 * - `state` is the shown panel's own state, and only the fields that panel declares deep-linkable.
 *
 * Every parameter that is not one of the two segments — a draft the agent wrote for this page, a tab — is carried
 * through as it came. Reading and writing both happen here and nowhere else, so an address written by a panel, by the
 * shell, by a conversation or by the platform's own link is the same address.
 */

/** The field of the address a value came from, or went to. */
export type PanelAddressSegment = "frame" | "state";

/**
 * A value the address cannot carry: its segment and field, named as the reader would see them (`frame.term`), so the
 * address entry says which field it refused instead of guessing an identity.
 */
export class PanelAddressError extends Error {
  constructor(readonly field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "PanelAddressError";
  }
}

/** An address taken apart: the entry's path, the two state segments, and every other parameter, in order. */
export interface PanelAddress {
  path: string;
  frame: Record<string, PanelDeepLinkStateValue>;
  state: Record<string, PanelDeepLinkStateValue>;
  search: URLSearchParams;
}

const segments: readonly PanelAddressSegment[] = ["frame", "state"];
const stateValues = panelOpenRequestSchema.shape.state;

/** Splits an address into its path and its two segments; a segment that is absent is empty, never an error. */
export function readPanelAddress(address: string): PanelAddress {
  const [path = "", query = ""] = splitOnce(address, "?");
  const search = new URLSearchParams(query);
  const frame = readSegment("frame", search.get("frame"));
  const state = readSegment("state", search.get("state"));
  for (const segment of segments) search.delete(segment);
  return { path: entryPathOf(path), frame, state, search };
}

/** The address those parts make: the two segments after the page's own parameters, an empty segment left out. */
export function writePanelAddress(address: PanelAddress): string {
  const path = entryPathOf(address.path);
  const search = new URLSearchParams(address.search);
  for (const segment of segments) {
    search.delete(segment);
    const values = stateValues.parse(segment === "frame" ? address.frame : address.state);
    if (Object.keys(values).length) search.set(segment, JSON.stringify(values));
  }
  const rest = search.toString();
  return rest ? `${path}?${rest}` : path;
}

/**
 * The path an entry is at, as Java declares it and as an address carries it: complete, local, and already encoded the
 * one way — so two readers writing the same entry write the same string. The rule itself is the entry's, in
 * `applicationPanelUsePathSchema`; this only reports a refused path as an address field.
 */
export function entryPathOf(path: string): string {
  const parsed = applicationPanelUsePathSchema.safeParse(path);
  if (!parsed.success) throw new PanelAddressError("path", parsed.error.issues[0]?.message ?? "The address names no entry path");
  return parsed.data;
}

/**
 * The values of one segment that the panel may take from an address: only the fields it declares deep-linkable, each
 * checked against the type it declared. An undeclared or closed field is refused by name rather than dropped, because a
 * link that asked for something the panel no longer offers is a broken link, not an empty one.
 */
export function deepLinkedStateOf(
  declared: PanelState, values: Record<string, PanelDeepLinkStateValue>, segment: PanelAddressSegment,
): Record<string, PanelDeepLinkStateValue> {
  const kept: Record<string, PanelDeepLinkStateValue> = {};
  for (const [name, value] of Object.entries(values)) {
    const field = declared[name];
    if (!field) throw new PanelAddressError(`${segment}.${name}`, "The panel declares no such state field");
    if (!field.deepLink) throw new PanelAddressError(`${segment}.${name}`, "The panel does not accept this field in an address");
    if (!matchesDirectPanelValue(field.type, value))
      throw new PanelAddressError(`${segment}.${name}`, "The value does not match the state field's declared type");
    kept[name] = value;
  }
  return kept;
}

/** Where Java resolves an entry from its path: the same gateway prefix the application's use relations come from. */
export const applicationResolveEntryPath = "/api/data-query/platform/applications/resolve-entry";

/**
 * The request that asks which entry an address names. Only the path is sent: what the two state segments carry is this
 * port's business, and Java never reads it.
 */
export function resolveEntryPath(path: string): string {
  return `${applicationResolveEntryPath}?${new URLSearchParams({ path: entryPathOf(path) })}`;
}

function readSegment(segment: PanelAddressSegment, raw: string | null): Record<string, PanelDeepLinkStateValue> {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PanelAddressError(segment, "The segment is not JSON");
  }
  const parsed = stateValues.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  const name = issue.path.length ? String(issue.path[0]) : null;
  throw new PanelAddressError(name ? `${segment}.${name}` : segment, issue.message);
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const at = value.indexOf(separator);
  return at < 0 ? [value, undefined] : [value.slice(0, at), value.slice(at + 1)];
}
