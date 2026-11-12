import type { LocationQuery, RouteLocationRaw, RouteMeta, RouteRecordRaw, RouteRecordSingleView } from "vue-router";
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

/**
 * The agent platform's pages: the conversation and its settings, the diagnosis app's root, and the pages of its own that
 * the platform assembles.
 *
 * The settings keep one address per screen on purpose: `/agents/settings` (the first agent), `/agents/settings/:agentId`
 * (that agent) and `/agents/settings/new` (a new one). Each is a page of the same component, and the router has to
 * serve every one of them, so they are registered as siblings under the workbench's component rather than as children
 * of the settings address.
 */
export function workbenchPages(
  component: PageComponent,
  observe: { component: PageComponent; meta?: RouteMeta; props?: Record<string, unknown> },
): RouteRecordRaw[] {
  return [
    { ...routes.publishedMcp,
      component: () => import("@ontomato/workbench-ui/features/workbench").then(module => module.PublishedMcpServices),
      meta: { service: true, page: routes.publishedMcp.path, ownHeader: true } },
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
    // The application's prefix is no page: it opens the conversation, which is where the platform is entered.
    { path: "/agents", redirect: (to) => capabilityTabLink(to) ?? { name: routes.chat.name, query: to.query } },
    // The first agent's screen is a page, so its old tab link moves on as the screen is entered: from a bookmark, a
    // reload or another page.
    { ...routes.agents, component, meta: { workbench: true }, beforeEnter: (to) => capabilityTabLink(to) ?? true },
    ...[routes.agentSettingsNew, routes.agentSettings].map(
      (location) => ({ ...location, component, meta: { workbench: true } }),
    ),
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
 * 应用构建: one page at the workspace its address names, with the platform's facts the builder needs (its route page). An
 * edition adds what its guard reads to let a reader in (the enterprise edition the application's entry permission,
 * `app-builder`).
 */
export const appBuilderPages = (meta: RouteMeta = {}): RouteRecordRaw[] => [
  { ...routes.appBuilder, component: () => import("./pages/AppBuilderRoute.vue"), meta: { workbench: true, ...meta } },
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
  { ...routes.personalWorkspace, component: () => import("./pages/PersonalWorkspaceRoute.vue"), meta: { workbench: true } },
];
