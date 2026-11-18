import type {
  LocationQuery, RouteLocationRaw, RouteMeta, RouteParamsGeneric, RouteRecordRaw, RouteRecordSingleView,
} from "vue-router";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { observeRoutes } from "./observe-routes";
import AgentSettingsRoute from "./pages/AgentSettingsRoute.vue";
import DashboardsPage from "./pages/DashboardsRoute.vue";
import GovernanceReportRoute from "./pages/GovernanceReportRoute.vue";
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
  // A named location inherits the parameters it does not name; the new agent has none.
  if (id === "new") return { name: routes.agentSettingsNew.name, params: {}, query: to.query };
  return typeof id === "string" && id
    ? { name: routes.agentSettings.name, params: { agentId: id }, query: to.query }
    : { name: routes.agents.name, query: to.query };
}

/**
 * The agent platform's pages: the conversation, its agents' settings, the diagnosis app's root, and the pages of its own
 * that the platform assembles. The agents' settings are one page (`AgentSettingsRoute`) that two applications show: the
 * ontology manager's product layer at `/ontology/agents`, and the agent platform at `/agents/settings` inside its own
 * shell, beside its column.
 */
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
    /*
     * The agents' settings in the ontology manager's product layer: the page itself, wrapping the workbench's own editor
     * with the platform's API, authentication, text and page context.
     */
    { ...routes.ontologyAgents, component: AgentSettingsRoute, meta: { service: true, ownHeader: true, page: routes.ontologyAgents.path } },
    { ...routes.ontologyAgentNew, component: AgentSettingsRoute, meta: { service: true, ownHeader: true, page: routes.ontologyAgents.path } },
    { ...routes.ontologyAgent, component: AgentSettingsRoute, meta: { service: true, ownHeader: true, page: routes.ontologyAgents.path } },
    /*
     * The same page in the agent platform: the platform's shell shows it full beside its column, as it shows any of its
     * pages enlarged, so the reader stays in the application. The old capability-library link on these addresses still
     * lands on the skills.
     */
    ...[routes.agents, routes.agentSettingsNew, routes.agentSettings].map((location): RouteRecordRaw => ({
      ...location,
      component,
      meta: { workbench: true, page: routes.agents.path },
      beforeEnter: (to) => capabilityTabLink(to) ?? true,
    })),
    // The builder's old top-level entry turns to the agent platform's settings.
    ...([{ path: "/agent-builder" }, { path: "/agent-builder/:agentId" }] as const).map(
      (location): RouteRecordRaw => ({ ...location, redirect: (to) => agentBuilderRedirect(to) }),
    ),
    // The application's prefix is no page: the old tab link lands on the skills, and anything else opens the conversation.
    { path: "/agents", redirect: (to) => capabilityTabLink(to) ?? { name: routes.chat.name, query: to.query } },
    // The models of the platform's ontology service agents: a page of its navigation, so it opens with its permission.
    { ...routes.agentModels, component, meta: { workbench: true, page: routes.agentModels.path } },
    // One governance record's report: the page the conversation beside it also draws, with the platform's composer at its
    // foot. It belongs to business knowledge — the page's own menu code — so `meta.page` sits on its parent (the
    // parameterised address never equals a page address, and the guard reads the tree's).
    {
      path: routes.governance.path.replace("/:recordId", ""),
      meta: { service: true, page: routes.knowledge.path },
      children: [{ ...routes.governance, component: GovernanceReportRoute }],
    },
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
  { ...routes.personalWorkspace, redirect: {name:routes.home.name} },
];
