import type { RouteLocation } from "vue-router";
import { panelAddress } from "@ontomato/contracts/panel-host";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import { ACTION, FUNCTION, METRIC_VIEW, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { platformRoutes } from "@ontomato/platform-shell/routes";

/*
 * A page's detail address once a panel has taken the page over: the address a link, a bookmark, an agent's answer or a
 * knowledge text still names opens the panel at its use path with that object selected. One conversion, made where an
 * address enters a page: the router, before any route is entered, and the page beside a conversation, before its
 * address is resolved to a page. A conversion that consumes legacy query keys at an existing entry keeps the rest of
 * that entry's address.
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
  /** Legacy keys consumed at this entry. Other query keys and explicitly supplied state stay. */
  consumeQuery?: readonly string[];
  /** The panel state the address selects, or null for an address that selects nothing (the panel's own address). */
  state(params: Readonly<Record<string, string>>, query: URLSearchParams): Record<string, PanelStateValue> | null;
}

/**
 * The detail addresses the platform converts: M4's table (its work item's "详情地址转选中"). A page's entries go in when
 * a panel takes that page over, together with taking out the page they replace: until then a detail address is still the
 * page's own.
 */
export const DETAIL_SELECTIONS: readonly DetailSelection[] = [
  ...[
    { path: platformRoutes.ontologyAgent.path, use: platformRoutes.ontologyAgents.path },
    { path: platformRoutes.agentSettings.path, use: platformRoutes.agents.path },
  ].map(({ path, use }): DetailSelection => ({
    path,
    use,
    state({ agentId }): Record<string, PanelStateValue> | null {
      if (use === platformRoutes.agents.path && ["capabilities", "skills", "mcp", "models"].includes(agentId!)) return null;
      return agentId === "new"
        ? { mode: "create" }
        : { selected: agentId!, mode: "edit" };
    },
  })),
  {
    path: platformRoutes.relation.path,
    use: `${platformRoutes.relations.path}/detail`,
    state: ({ relationship }) => relationship === "detail"
      ? null
      : { selected: relationship! },
  },
  // Legacy catalog links carrying `selected` forward straight to the non-menu relation detail entry.
  {
    path: platformRoutes.relations.path,
    use: `${platformRoutes.relations.path}/detail`,
    state: (_params, query): Record<string, PanelStateValue> | null => {
      const selected = query.get("selected");
      if (!selected || !selected.trim()) return null;
      const prefix = `${RELATIONSHIP}~`;
      const primaryKey = selected.startsWith(prefix) ? selected.slice(prefix.length) : selected;
      return primaryKey ? { selected: primaryKey } : null;
    },
  },
  {
    path: platformRoutes.schedules.path,
    use: platformRoutes.schedules.path,
    consumeQuery: ["taskId"],
    state: (_params, query): Record<string, PanelStateValue> | null => {
      const taskId = query.get("taskId");
      if (!taskId) return null;
      return { selectedTask: taskId };
    },
  },
  // The visual modeling page: the graph's "go to modeling" carries the class or relation to select.
  {
    path: platformRoutes.modeling.path,
    use: platformRoutes.modeling.path,
    // The use path is the model's own too, so an address without a selection converts to nothing: the panel's own
    // address (and its already converted form) would otherwise redirect to itself.
    state: (_params, query): Record<string, PanelStateValue> | null => {
      const id = query.get("id");
      if (!id) return null;
      return query.get("focus") === "relation"
        ? { selectedEdge: id }
        : { selectedNode: id };
    },
  },
  // The object types page: a class's detail address opens the catalog with that class selected.
  {
    path: platformRoutes.object.path,
    use: platformRoutes.objects.path,
    state: ({ className }) => ({ selected: className! }),
  },
  // The actions page: old `/new` opens the catalog; `:id` (other than `detail`/`new`) and legacy catalog `?selected=`
  // links forward straight to the non-menu action detail entry.
  {
    path: `${platformRoutes.actions.path}/new`,
    use: platformRoutes.actions.path,
    state: (): Record<string, PanelStateValue> => ({}),
  },
  {
    path: platformRoutes.action.path,
    use: `${platformRoutes.actions.path}/detail`,
    state: ({ id }): Record<string, PanelStateValue> | null =>
      id === "detail" || id === "new" ? null : { selected: id! },
  },
  {
    path: platformRoutes.actions.path,
    use: `${platformRoutes.actions.path}/detail`,
    state: (_params, query): Record<string, PanelStateValue> | null => {
      const selected = query.get("selected");
      if (!selected || !selected.trim()) return null;
      const prefix = `${ACTION}~`;
      const primaryKey = selected.startsWith(prefix) ? selected.slice(prefix.length) : selected;
      return primaryKey ? { selected: primaryKey } : null;
    },
  },
  // The functions page: legacy `/new`, `/:id`, and catalog `?selected=` links forward to the non-menu detail entry.
  {
    path: `${platformRoutes.functions.path}/new`,
    use: `${platformRoutes.functions.path}/detail`,
    state: (): Record<string, PanelStateValue> => ({ mode: "create" }),
  },
  {
    path: platformRoutes.function.path,
    use: `${platformRoutes.functions.path}/detail`,
    state: ({ id }): Record<string, PanelStateValue> | null =>
      id === "detail" || id === "new" ? null : { selected: id! },
  },
  {
    path: platformRoutes.functions.path,
    use: `${platformRoutes.functions.path}/detail`,
    state: (_params, query): Record<string, PanelStateValue> | null => {
      const selected = query.get("selected");
      if (!selected || !selected.trim()) return null;
      const prefix = `${FUNCTION}~`;
      const primaryKey = selected.startsWith(prefix) ? selected.slice(prefix.length) : selected;
      return primaryKey ? { selected: primaryKey } : null;
    },
  },
  // The metric views page: `/new` opens the non-menu detail entry in create mode, `:id` selects a metric (exempting
  // `detail` and `new`), and legacy catalog links carrying `selected` forward straight to the detail entry.
  {
    path: `${platformRoutes.metrics.path}/new`,
    use: `${platformRoutes.metrics.path}/detail`,
    state: (): Record<string, PanelStateValue> => ({ mode: "create" }),
  },
  {
    path: platformRoutes.metric.path,
    use: `${platformRoutes.metrics.path}/detail`,
    state: ({ id }): Record<string, PanelStateValue> | null => {
      if (id === "detail" || id === "new") return null;
      return { selected: id! };
    },
  },
  {
    path: platformRoutes.metrics.path,
    use: `${platformRoutes.metrics.path}/detail`,
    state: (_params, query): Record<string, PanelStateValue> | null => {
      const selected = query.get("selected");
      if (!selected || !selected.trim()) return null;
      const prefix = `${METRIC_VIEW}~`;
      const primaryKey = selected.startsWith(prefix) ? selected.slice(prefix.length) : selected;
      return primaryKey.trim() ? { selected: primaryKey } : null;
    },
  },
  // The skill library: a skill's detail address opens the library with that skill selected.
  {
    path: platformRoutes.ontologySkill.path,
    use: platformRoutes.ontologySkills.path,
    state: ({ skillId }): Record<string, PanelStateValue> => ({
      selected: skillId!,
    }),
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
    if (entry.consumeQuery) {
      const query = new URLSearchParams(url.search);
      for (const key of entry.consumeQuery) query.delete(key);
      const merged: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(state)) {
        if (!query.has(key)) merged[key] = value;
      }
      return panelAddress(query.size ? `${entry.use}?${query}` : entry.use, merged);
    }
    return panelAddress(entry.use, state);
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
