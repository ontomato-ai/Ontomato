import { stringifyQuery, type RouteLocation, type RouteRecordRaw } from "vue-router";
import { panelAddress } from "@ontomato/contracts/panel-host";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";

/*
 * A page's detail address once a panel has taken the page over: the address a link, a bookmark or an answer still names
 * (`/ontology/objects/:className`, for one) opens the panel at its use path with that object selected. The address is
 * converted here, at the route boundary, once and in place of the address the reader asked for; the panel knows only its
 * own address and state. The rest of the query, a draft's among it, stays on the panel's address.
 *
 * The entries are their page's owner's. A page's entries are added when a panel takes that page over, together with
 * taking out the page they replace: until then the detail address is still the page's own.
 */
export interface DetailSelection {
  /** The detail address, as the router matches it. */
  path: string;
  /** The use path of the panel that took the page over. */
  use: string;
  /** The panel state the detail address selects: deep-linkable fields the panel declares. */
  state(to: RouteLocation): Record<string, PanelStateValue>;
}

/** The route records that send each detail address to its panel, with the address's object selected. */
export function detailSelectionRoutes(entries: readonly DetailSelection[]): RouteRecordRaw[] {
  return entries.map(entry => ({
    path: entry.path,
    redirect: (to: RouteLocation) => {
      const search = stringifyQuery(to.query);
      return panelAddress(search ? `${entry.use}?${search}` : entry.use, entry.state(to));
    },
  }));
}
