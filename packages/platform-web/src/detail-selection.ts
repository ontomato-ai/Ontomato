import type { RouteLocation, RouteLocationRaw, RouteRecordRaw } from "vue-router";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { PAGE_DRAFT_QUERY_KEYS } from "@ontomato/contracts/page-draft";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";

/*
 * A page's detail address once a panel has taken the page over: the address a link, a bookmark or an answer still names
 * opens the panel at its use path with that object selected. The address is converted here, at the route boundary,
 * once and in place of the address the reader asked for; the panel knows only its own address and state. Of the query,
 * only a draft's stays: what else a detail address carried (where its page's "back" went) the panel has no use for.
 *
 * Two shapes of detail address: one of its own (`/ontology/objects/:className`), which a route record sends on, and the
 * panel's own path naming the selection in its query (modelling's `?focus=&id=`), which a guard rewrites.
 *
 * The entries are their page's owner's (M4's table). A page's entries are added when a panel takes that page over,
 * together with taking out the page they replace: until then the detail address is still the page's own.
 */

/** A detail address of its own. */
export interface DetailSelection {
  /** The detail address, as the router matches it: one segment per parameter, so a deeper page is not converted. */
  path: string;
  /** The use path of the panel that took the page over. */
  use: string;
  /** The panel state the detail address selects: deep-linkable fields the panel declares. */
  state(to: RouteLocation): Record<string, PanelStateValue>;
}

/** The panel's own path, naming a selection in its query. */
export interface QuerySelection {
  use: string;
  /** The state the query selects, or null for an address that selects nothing. */
  state(to: RouteLocation): Record<string, PanelStateValue> | null;
}

function selectionAddress(use: string, to: RouteLocation, state: Record<string, PanelStateValue>) {
  const kept = new URLSearchParams();
  for (const key of PAGE_DRAFT_QUERY_KEYS) if (typeof to.query[key] === "string") kept.set(key, to.query[key]);
  const search = kept.toString();
  return panelAddress(search ? `${use}?${search}` : use, state);
}

/** The route records that send each detail address of its own to its panel, with the address's object selected. */
export function detailSelectionRoutes(entries: readonly DetailSelection[]): RouteRecordRaw[] {
  return entries.map(entry => ({
    path: entry.path,
    redirect: (to: RouteLocation) => selectionAddress(entry.use, to, entry.state(to)),
  }));
}

/**
 * The router guard that rewrites a panel's own path naming a selection in its query. A guard, not a route record: the
 * address is the panel's own route, and it is reached from that same page as well as from elsewhere.
 */
export function querySelectionGuard(entries: readonly QuerySelection[]) {
  return (to: RouteLocation): RouteLocationRaw | undefined => {
    const entry = entries.find(candidate => candidate.use === to.path);
    if (!entry) return undefined;
    const state = entry.state(to);
    if (!state) return undefined;
    const address = new URL(selectionAddress(entry.use, to, state), "http://page.invalid");
    // A redirect, in place of the navigation asked for: the selecting address never becomes a page of its own in history.
    return { path: address.pathname, query: Object.fromEntries(address.searchParams) };
  };
}
