import type { PilotPage, PilotPageResolver } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import DashboardsPage from "./pages/DashboardsRoute.vue";
import PanelApplicationRoute from "./pages/PanelApplicationRoute.vue";
import { DETAIL_SELECTIONS, detailSelectionAddress, type DetailSelection } from "./detail-selection";
import { panelEntryApplication } from "./catalog";

/**
 * The pages this assembly mounts beside a conversation (DESIGN.md "Applications and shells"). A page's own address is
 * what the conversation beside it carries (`?page=`), and the resolver turns that address into the props the page's own
 * component takes: the page keeps one component and one address, and the page beside the chat is that page.
 *
 * The pages here are the dashboards, the agents' settings, a panel application's page and a built-in application's panel
 * entry, each shown by the same page the platform shows it with, so one address has one page and one panel instance.
 *
 * A page's own navigation (another board, another agent, the list, a saved draft's handoff) is the callback it is given
 * here. The callback changes the parameter the conversation carries, never the browser's address, so the conversation
 * stays where it is and the page keeps its own address and its own state.
 *
 * An address an answer or a knowledge text names may be a page's old detail address: it opens the panel that took that
 * page over, with its object selected, by the same conversion the router makes (`detail-selection.ts`).
 */
export function pilotPageResolver(
  setPage: (address: string) => void, selections: readonly DetailSelection[] = DETAIL_SELECTIONS,
): PilotPageResolver {
  return (asked) => {
    const address = detailSelectionAddress(selections, asked) ?? asked;
    const [path, search = ""] = address.split("?");
    const query = new URLSearchParams(search);
    // A built-in application's panel entry at its own address (`/ontology/components`), as the reader's catalog lists it:
    // the same page that shows it full, as that application's page. A declared entry is the page at its address.
    const entry = panelEntryApplication(path);
    if (entry) {
      return {
        id: "panel-application",
        component: PanelApplicationRoute,
        instance: path,
        props: { applicationId: entry, address, navigate: setPage },
      } satisfies PilotPage;
    }
    // A panel application's page: a use relation's full path under `/applications/<application>`, shown by the same
    // component that shows it full. It opens at the state its address names and reports selections to the display
    // controller. The panel stays the same instance while only its state changes.
    const panel = /^\/applications\/([^/]+)(?:\/.*)?$/.exec(path);
    if (panel) {
      return {
        id: "panel-application",
        component: PanelApplicationRoute,
        instance: path,
        props: {
          applicationId: decodeURIComponent(panel[1]!),
          address,
          navigate: setPage,
        },
      } satisfies PilotPage;
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
