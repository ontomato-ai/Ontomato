import type { RouteLocation } from "vue-router";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { PAGE_DRAFT_QUERY_KEYS } from "@ontomato/contracts/page-draft";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import { ACTION, FUNCTION, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { platformRoutes } from "@ontomato/platform-shell/routes";

/*
 * A page's detail address once a panel has taken the page over: the address a link, a bookmark, an agent's answer or a
 * knowledge text still names opens the panel at its use path with that object selected. One conversion, made where an
 * address enters a page: the router, before any route is entered, and the page beside a conversation, before its
 * address is resolved to a page. The panel knows only its own address and state. Of the query, only a draft's stays:
 * what else a detail address carried (where its old page's "back" went) the panel has no use for.
 *
 * A detail address is either one of its own (`/ontology/objects/:className`) or the panel's own path naming the
 * selection in its query (modelling's `?focus=&id=`); an entry's state says which addresses it selects from.
 */
export interface DetailSelection {
  /**
   * The address that names a selection, as a path whose `:name` segments are its parameters. A parameter is one segment,
   * so a deeper page under it (`/ontology/objects/:className/view`) is not converted.
   */
  path: string;
  /** The use path of the panel that took the page over. */
  use: string;
  /** The panel state the address selects, or null for an address that selects nothing (the panel's own address). */
  state(params: Readonly<Record<string, string>>, query: URLSearchParams): Record<string, PanelStateValue> | null;
}

/**
 * The detail addresses the platform converts: M4's table (its work item's "详情地址转选中"). A page's entries go in when
 * a panel takes that page over, together with taking out the page they replace: until then a detail address is still the
 * page's own.
 */
export const DETAIL_SELECTIONS: readonly DetailSelection[] = [
  {
    path: platformRoutes.relation.path,
    use: platformRoutes.relations.path,
    state: ({ relationship }) => ({ selected: { className: RELATIONSHIP, primaryKey: relationship! } }),
  },
  // The actions page: an action's detail selects it; the old page's `new` (its creation dialog) opens the catalog, since
  // an action is created by asking the page's agent.
  {
    path: platformRoutes.action.path,
    use: platformRoutes.actions.path,
    state: ({ id }): Record<string, PanelStateValue> =>
      id === "new" ? {} : { selected: { className: ACTION, primaryKey: id! } },
  },
  // The functions page: a function's detail selects it; the old page's `new` opens the catalog, whose own button starts a
  // new function.
  {
    path: platformRoutes.function.path,
    use: platformRoutes.functions.path,
    state: ({ id }): Record<string, PanelStateValue> =>
      id === "new" ? {} : { selected: { className: FUNCTION, primaryKey: id! } },
  },
];

/** The panel address a detail address opens, or null for an address none of the entries converts. */
export function detailSelectionAddress(entries: readonly DetailSelection[], address: string): string | null {
  const url = new URL(address, "http://page.invalid");
  const segments = url.pathname.split("/");
  for (const entry of entries) {
    const pattern = entry.path.split("/");
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const matches = pattern.every((part, index) => {
      const segment = segments[index]!;
      if (!part.startsWith(":")) return part === segment;
      params[part.slice(1)] = decodeURIComponent(segment);
      return segment !== "";
    });
    const state = matches ? entry.state(params, url.searchParams) : null;
    if (!state) continue;
    const kept = new URLSearchParams();
    for (const key of PAGE_DRAFT_QUERY_KEYS) {
      const value = url.searchParams.get(key);
      if (value !== null) kept.set(key, value);
    }
    return panelAddress(kept.size ? `${entry.use}?${kept}` : entry.use, state);
  }
  return null;
}

/**
 * The router's guard: a detail address is redirected in place of the navigation asked for, so it never becomes a page of
 * its own in the reader's history.
 */
export function detailSelectionGuard(entries: readonly DetailSelection[]) {
  return (to: RouteLocation) => detailSelectionAddress(entries, to.fullPath) ?? undefined;
}
