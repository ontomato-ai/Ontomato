import type {
  LocationQuery, RouteLocationRaw, RouteMeta, RouteParamsGeneric, RouteRecordRaw, RouteRecordSingleView,
} from "vue-router";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { observePageRoutes, type ObserveRouteOptions } from "./observe-routes";

type PageComponent = NonNullable<RouteRecordSingleView["component"]>;

/**
 * The capability library's oldest address: the agents page's `?tab=capabilities`, on `/agents/settings` or on the bare
 * `/agents`. Such a link (a bookmark, an old page) lands on the skills, keeping the rest of its query; any other address
 * is not this link.
 */
function capabilityTabLink(to: { query: LocationQuery }): RouteLocationRaw | undefined {
  if (to.query.tab !== "capabilities") return undefined;
  const { tab: _tab, ...query } = to.query;
  return { path: routes.ontologySkills.path, query };
}

/** The builder's old top-level entry: the agent platform's settings at the agent it named, its query kept. */
function agentBuilderRedirect(to: { params: RouteParamsGeneric; query: LocationQuery }): RouteLocationRaw {
  const id = to.params.agentId;
  const base = routes.agents.path;
  return { path: typeof id === "string" && id ? `${base}/${encodeURIComponent(id)}` : base, query: to.query };
}

export function legacyAgentSettingsTab(to: { path: string; query: LocationQuery }): RouteLocationRaw | undefined {
  return to.path === routes.agents.path ? capabilityTabLink(to) : undefined;
}

/** Native workbench pages and legacy addresses. Both agent settings entries are mounted by the panel entry guard. */
export function workbenchPages(
  component: PageComponent,
  observe: ObserveRouteOptions = {},
): RouteRecordRaw[] {
  return [
    // The capability library's earlier addresses: skills are the ontology manager's panel, external MCP the system settings'.
    ...[routes.ontologyCapabilities, routes.agentSettingsCapabilities, routes.agentSettingsSkills].map(
      (location) => ({ ...location, redirect: routes.ontologySkills.path }),
    ),
    ...[routes.ontologyMcp, routes.agentSettingsMcp].map(
      (location) => ({ ...location, redirect: routes.externalMcp.path }),
    ),
    { ...routes.chat, component, meta: { workbench: true } },
    // The builder's old top-level entry turns to the agent platform's settings.
    ...([{ path: "/agent-builder" }, { path: "/agent-builder/:agentId" }] as const).map(
      (location): RouteRecordRaw => ({ ...location, redirect: (to) => agentBuilderRedirect(to) }),
    ),
    // The application's prefix is no page: the old tab link lands on the skills, and anything else opens the conversation.
    { path: "/agents", redirect: (to) => capabilityTabLink(to) ?? { name: routes.chat.name, query: to.query } },
    // The old agent platform models direct link forwards to the model usage page.
    { path: "/agents/settings/models", redirect: routes.usage.path },
    { path: "/settings/model-config/agents", redirect: routes.usage.path },
    { path: "/settings/model-config/app-builder", redirect: routes.usage.path },
    ...observePageRoutes(observe),
  ];
}

/** The agent platform's old schedules address opens the application filter on the platform's panel. */
export const schedulePages = (): RouteRecordRaw[] => [
  { path: routes.agentSchedules.path, redirect: { path: routes.schedules.path, query: { app: "agents" } } },
];

/**
 * 应用构建: one page at the workspace its address names, with the platform's facts the builder needs (its route page),
 * and the author's preview of that workspace's panel candidate. An edition adds what its guard reads to let a reader in
 * (the enterprise edition the application's entry permission, `app-builder`); Node lets only the workspace's author read
 * its candidate.
 */
export const appBuilderPages = (meta: RouteMeta = {}): RouteRecordRaw[] => [
  { ...routes.appBuilder, component: () => import("./pages/AppBuilderRoute.vue"), meta: { workbench: true, ...meta } },
  {
    name: "PanelCandidatePreview",
    path: "/app-builder/:workspaceId/panel-preview/:ref/:pageKey",
    component: () => import("./pages/PanelCandidateRoute.vue"),
    props: (route) => ({ workspaceId: route.params.workspaceId, revision: route.params.ref, pageKey: route.params.pageKey }),
    meta: { workbench: true, ...meta },
  },
];

/**
 * The dashboards' legacy address under the agent platform redirects to the canonical `/dashboards` panel entry
 * mounted automatically by the panel entry guard.
 */
export const dashboardPages = (): RouteRecordRaw[] => [
  { path: "/agents/dashboards", redirect: (to) => ({ path: routes.dashboards.path, query: to.query }) },
];

export const personalWorkspacePages = (): RouteRecordRaw[] => [
  { ...routes.personalWorkspace, redirect: {name:routes.home.name} },
];
