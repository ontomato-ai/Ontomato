import type { PilotPage, PilotPageResolver } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import DashboardsPage from "./pages/DashboardsRoute.vue";
import GovernanceReportRoute from "./pages/GovernanceReportRoute.vue";

/**
 * The pages this assembly mounts beside a conversation (DESIGN.md "Applications and shells"). A page's own address is
 * what the conversation beside it carries (`?page=`), and the resolver turns that address into the props the page's own
 * component takes: the page keeps one component and one address, and the page beside the chat is that page.
 *
 * The pages here: the dashboards, one governance record's report, and the agent settings, which the workbench mounts
 * itself.
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
  return null;
};

/** `path` with one query parameter set or dropped, the rest of the page's address kept as it is. */
function addressWith(path: string, search: string, key: string, value: string | undefined) {
  const target = new URLSearchParams(search);
  if (value) target.set(key, value);
  else target.delete(key);
  return `${path}${target.size ? `?${target}` : ""}`;
}
