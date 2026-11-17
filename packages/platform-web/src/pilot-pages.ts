import type { PilotPage, PilotPageResolver } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import DashboardsPage from "./pages/DashboardsRoute.vue";
import GovernanceReportRoute from "./pages/GovernanceReportRoute.vue";
import PanelApplicationRoute from "./pages/PanelApplicationRoute.vue";

/**
 * The pages this assembly mounts beside a conversation (DESIGN.md "Applications and shells"). A page's own address is
 * what the conversation beside it carries (`?page=`), and the resolver turns that address into the props the page's own
 * component takes: the page keeps one component and one address, and the page beside the chat is that page.
 *
 * The pages here: the dashboards, one governance record's report, and the agent settings, which the workbench mounts
 * itself. A panel application's address is here too: it is shown beside the conversation by the same page the platform
 * shows it with, so one address has one page and one panel instance either way.
 */
export const resolvePilotPage: PilotPageResolver = (address) => {
  const [path, search = ""] = address.split("?");
  const query = new URLSearchParams(search);
  if (path === platformRoutes.dashboards.path) {
    return {
      component: DashboardsPage,
      props: { paired: true, dashboardId: query.get("dashboardId") ?? undefined },
      // The page's own navigation lands on the address it would be at; the frame changes the parameter it carries.
      navigate(next) {
        return addressWith(platformRoutes.dashboards.path, search, "dashboardId", next.dashboardId);
      },
    } satisfies PilotPage;
  }
  // One governance record's report. The finding the reader selected is part of its address, so the message written at
  // its foot carries it and enlarging the page keeps it.
  const report = /^\/governance\/reports\/([^/]+)$/.exec(path);
  if (report) {
    const recordId = decodeURIComponent(report[1]!);
    return {
      component: GovernanceReportRoute,
      props: { paired: true, recordId, issueId: query.get("issue") ?? undefined },
      navigate(next) {
        return addressWith(`/governance/reports/${encodeURIComponent(recordId)}`, search, "issue", next.issue);
      },
    } satisfies PilotPage;
  }
  // A panel application's page: `/applications/<application>/<the use relation's path>`, shown beside the conversation
  // by the same component that shows it full.
  const panel = /^\/applications\/([^/]+)(\/.*)?$/.exec(path);
  if (panel) {
    return {
      component: PanelApplicationRoute,
      props: { applicationId: decodeURIComponent(panel[1]!), panelPath: (panel[2] ?? "").replace(/^\//, "") },
    } satisfies PilotPage;
  }
  return null;
};

/** `path` with one query parameter set or dropped, the rest of the page's address kept as it is. */
function addressWith(path: string, search: string, key: string, value: string | undefined) {
  const target = new URLSearchParams(search);
  if (value) target.set(key, value);
  else target.delete(key);
  return `${path}${target.size ? `?${target}` : ""}`;
}
