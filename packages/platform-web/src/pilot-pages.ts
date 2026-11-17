import type { PilotPage, PilotPageResolver } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import AgentSettingsRoute from "./pages/AgentSettingsRoute.vue";
import DashboardsPage from "./pages/DashboardsRoute.vue";

/**
 * The pages this assembly mounts beside a conversation (DESIGN.md "Applications and shells"). A page's own address is
 * what the conversation beside it carries (`?page=`), and the resolver turns that address into the props the page's own
 * component takes: the page keeps one component and one address, and the page beside the chat is that page.
 *
 * The pages here are the dashboards and the agents' settings; the knowledge report joins them when its migration lands.
 */
export const resolvePilotPage: PilotPageResolver = (address) => {
  const [path, search = ""] = address.split("?");
  const query = new URLSearchParams(search);
  const agents = /^\/ontology\/agents(?:\/(new|[^/]+))?$/.exec(path);
  if (agents) {
    const id = agents[1] ?? null;
    return {
      component: AgentSettingsRoute,
      props: { agentId: id === "new" ? null : id, creating: id === "new" },
    };
  }
  if (path !== platformRoutes.dashboards.path) return null;
  return {
    component: DashboardsPage,
    props: { paired: true, dashboardId: query.get("dashboardId") ?? undefined },
    // The page's own navigation lands on the address it would be at; the frame changes the parameter it carries.
    navigate(next) {
      const target = new URLSearchParams(search);
      if (next.dashboardId) target.set("dashboardId", next.dashboardId);
      else target.delete("dashboardId");
      return `${platformRoutes.dashboards.path}${target.size ? `?${target}` : ""}`;
    },
  } satisfies PilotPage;
};
