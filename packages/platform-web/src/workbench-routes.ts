import type {
  LocationQuery, RouteLocationRaw, RouteMeta, RouteParamsGeneric, RouteRecordRaw, RouteRecordSingleView,
} from "vue-router";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { observeRoutes } from "./observe-routes";
import DashboardsPage from "./pages/DashboardsRoute.vue";
import PlatformSchedulesPage from "./pages/PlatformSchedulesRoute.vue";

type PageComponent = NonNullable<RouteRecordSingleView["component"]>;

/**
 * The capability library's oldest address: the agents page's `?tab=capabilities`, on `/agents/settings` or on the bare
 * `/agents`. Such a link (a bookmark, an old page) lands on the skills, keeping the rest of its query; any other address
 * is not this link.
 */
function capabilityTabLink(to: { query: LocationQuery }): RouteLocationRaw | undefined {
  if (to.query.tab !== "capabilities") return undefined;
  const { tab: _tab, ...query } = to.query;
  return { name: routes.ontologySkills.name, query };
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
  observe: { component: PageComponent; meta?: RouteMeta; props?: Record<string, unknown> },
): RouteRecordRaw[] {
  return [
    {...routes.systemAgentModels,component:()=>import('./pages/SystemAgentModelsRoute.vue'),meta:{service:true,page:routes.systemAgentModels.path}},
    {...routes.builderModels,component:()=>import('./pages/BuilderModelsRoute.vue'),meta:{service:true,page:routes.builderModels.path}},
    { ...routes.publishedMcp,
      component: () => import("@ontomato/workbench-ui/features/workbench").then(module => module.PublishedMcpServices),
      meta: { service: true, page: routes.publishedMcp.path } },
    { ...routes.externalMcp,
      component: () => import("./pages/ExternalMcpRoute.vue"),
      meta: { service: true, page: routes.externalMcp.path, ownHeader: true } },
    { ...routes.ontologySkills,
      component: () => import("@ontomato/workbench-ui/features/workbench").then(module => module.SkillLibrary),
      meta: { service: true, page: routes.ontologySkills.path, ownHeader: true } },
    { ...routes.ontologySkill,
      component: () => import("@ontomato/workbench-ui/features/workbench").then(module => module.SkillDetail),
      props: true,
      meta: { service: true, page: routes.ontologySkills.path, ownHeader: true } },
    // The capability library's earlier addresses: skills are the ontology manager's, external MCP the system settings'.
    ...[routes.ontologyCapabilities, routes.agentSettingsCapabilities, routes.agentSettingsSkills].map(
      (location) => ({ ...location, redirect: { name: routes.ontologySkills.name } }),
    ),
    ...[routes.ontologyMcp, routes.agentSettingsMcp].map(
      (location) => ({ ...location, redirect: { name: routes.externalMcp.name } }),
    ),
    { ...routes.chat, component, meta: { workbench: true } },
    // The builder's old top-level entry turns to the agent platform's settings.
    ...([{ path: "/agent-builder" }, { path: "/agent-builder/:agentId" }] as const).map(
      (location): RouteRecordRaw => ({ ...location, redirect: (to) => agentBuilderRedirect(to) }),
    ),
    // The application's prefix is no page: the old tab link lands on the skills, and anything else opens the conversation.
    { path: "/agents", redirect: (to) => capabilityTabLink(to) ?? { name: routes.chat.name, query: to.query } },
    // The models of the platform's ontology service agents: a page of its navigation, so it opens with its permission.
    { ...routes.agentModels, component, meta: { workbench: true, page: routes.agentModels.path } },
    { ...observeRoutes.root, ...observe, children: observeRoutes.children },
  ];
}

/**
 * The platform's scheduled tasks: one page for every task of every application.
 *
 * The page is marked as a platform page (`meta.service`), which is what an edition's router guard reads to decide that
 * it needs a signed-in account: every other application's pages carry the mark through `installPlatformPages`.
 */
export const schedulePages = (): RouteRecordRaw[] => [
  { ...routes.schedules, component: PlatformSchedulesPage, meta: { service: true } },
  // The agent platform's own scheduled tasks are the platform's list narrowed to that application. The list is filtered
  // by application only, so an old link's agent is dropped.
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
 * The dashboards: an application of their own. Their address carries the open board as `?dashboardId=`, so a board can
 * be linked; the old address under the agent platform moves here.
 */
export const dashboardPages = (): RouteRecordRaw[] => [
  { ...routes.dashboards, component: DashboardsPage, meta: { workbench: true } },
  { path: "/agents/dashboards", redirect: (to) => ({ path: routes.dashboards.path, query: to.query }) },
];

export const personalWorkspacePages = (): RouteRecordRaw[] => [
  { ...routes.personalWorkspace, redirect: {name:routes.home.name} },
];
