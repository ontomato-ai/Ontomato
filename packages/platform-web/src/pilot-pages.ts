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
 *
 * A page's own navigation (another board, another agent, the list, a saved draft's handoff) is the callback it is given
 * here. The callback changes the parameter the conversation carries, never the browser's address, so the conversation
 * stays where it is and the page keeps its own address and its own state.
 */
export function pilotPageResolver(setPage: (address: string) => void): PilotPageResolver {
  return (address) => {
    const [path, search = ""] = address.split("?");
    const query = new URLSearchParams(search);
    const agents = /^\/ontology\/agents(?:\/(new|[^/]+))?$/.exec(path);
    if (agents) {
      const id = agents[1] ?? null;
      return {
        id: "agents",
        component: AgentSettingsRoute,
        props: {
          agentId: id === "new" ? null : id,
          creating: id === "new",
          // The page keeps its own address beside the conversation, a draft handoff included.
          address,
          navigate: setPage,
        },
      };
    }
    if (path !== platformRoutes.dashboards.path) return null;
    return {
      id: "dashboards",
      component: DashboardsPage,
      props: {
        paired: true,
        dashboardId: query.get("dashboardId") ?? undefined,
        navigate: (next: { dashboardId?: string }) => {
          const target = new URLSearchParams(search);
          if (next.dashboardId) target.set("dashboardId", next.dashboardId);
          else target.delete("dashboardId");
          setPage(`${platformRoutes.dashboards.path}${target.size ? `?${target}` : ""}`);
        },
      },
    } satisfies PilotPage;
  };
}
