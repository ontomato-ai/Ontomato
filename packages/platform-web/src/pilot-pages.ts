import type { PilotPage, PilotPageResolver } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import AgentSettingsRoute from "./pages/AgentSettingsRoute.vue";
import DashboardsPage from "./pages/DashboardsRoute.vue";
import GovernanceReportRoute from "./pages/GovernanceReportRoute.vue";
import PanelApplicationRoute from "./pages/PanelApplicationRoute.vue";

/**
 * The pages this assembly mounts beside a conversation (DESIGN.md "Applications and shells"). A page's own address is
 * what the conversation beside it carries (`?page=`), and the resolver turns that address into the props the page's own
 * component takes: the page keeps one component and one address, and the page beside the chat is that page.
 *
 * The pages here are the dashboards, the agents' settings, one governance record's report and a panel application's
 * page, which is shown by the same page the platform shows it with, so one address has one page and one panel instance.
 *
 * A page's own navigation (another board, another agent, the list, a saved draft's handoff) is the callback it is given
 * here. The callback changes the parameter the conversation carries, never the browser's address, so the conversation
 * stays where it is and the page keeps its own address and its own state.
 */
export function pilotPageResolver(setPage: (address: string) => void): PilotPageResolver {
  return (address) => {
    const [path, search = ""] = address.split("?");
    const query = new URLSearchParams(search);
    // The agents' settings at the agent platform's own prefix: the address an answer and a draft link name.
    if (path === platformRoutes.agents.path || path.startsWith(`${platformRoutes.agents.path}/`)) {
      return {
        id: "agents",
        component: AgentSettingsRoute,
        props: {
          // The page keeps its own address beside the conversation, a draft handoff included; which agent it shows, and
          // whether it is a new one, is what that address says.
          address,
          navigate: setPage,
        },
      };
    }
    const report = /^\/governance\/reports\/([^/]+)$/.exec(path);
    if (report) {
      const recordId = decodeURIComponent(report[1]!);
      return {
        id: "governance-report",
        component: GovernanceReportRoute,
        props: {
          paired: true,
          recordId,
          issueId: query.get("issue") ?? undefined,
          navigate: (next: { issue?: string }) => {
            const target = new URLSearchParams(search);
            if (next.issue) target.set("issue", next.issue);
            else target.delete("issue");
            setPage(`/governance/reports/${encodeURIComponent(recordId)}${target.size ? `?${target}` : ""}`);
          },
        },
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
