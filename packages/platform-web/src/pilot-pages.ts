import type { PilotPage, PilotPageResolver } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import DashboardsPage from "./pages/DashboardsRoute.vue";

/**
 * The pages this assembly mounts beside a conversation (DESIGN.md "Applications and shells"). A page's own address is
 * what the conversation beside it carries (`?page=`), and the resolver turns that address into the props the page's own
 * component takes: the page keeps one component and one address, and the page beside the chat is that page.
 *
 * Only the pages whose own line has finished registering are here: the dashboards now, the knowledge report when its
 * migration lands, the agent settings inside the workbench that already mounts them.
 */
export const resolvePilotPage: PilotPageResolver = (address) => {
  const [path, search = ""] = address.split("?");
  const query = new URLSearchParams(search);
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
