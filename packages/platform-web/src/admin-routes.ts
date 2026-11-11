import type { RouteLocation, RouteRecordRaw } from "vue-router";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";

export function managerViewQuery(query: Record<string, unknown>) {
  return Object.fromEntries(["focus", "id", "back"].flatMap((key) => {
    const value = query[key];
    return typeof value === "string" && (key !== "back" || value === "playground") ? [[key, value]] : [];
  }));
}

export function managerLocation(query: Record<string, unknown>) {
  switch (query.view) {
    case "assets": return routes.metrics.path;
    case "knowledge": return routes.knowledge.path;
    case "data-browser": return "/browser/data";
    case "visual-modeling": {
      const search = new URLSearchParams(managerViewQuery(query)).toString();
      return routes.modeling.path + (search ? "?" + search : "");
    }
    default: return routes.ontology.path;
  }
}

// Legacy console links open the matching Skill or MCP page.
export const legacyAdminRoutes: RouteRecordRaw[] = [
  { path: "/admin/ontology-manager", redirect: (to) => to.query.view === "visual-modeling"
    ? { path: routes.modeling.path, query: managerViewQuery(to.query) }
    : { path: managerLocation(to.query), query: {} } },
  { path: "/admin/ontology", redirect: routes.ontology.path },
  { path: "/admin/ontology/visual-modeling", redirect: (to) => ({ path: routes.modeling.path, query: managerViewQuery(to.query) }) },
  ...["intelligence-assets", "metric-views", "action-management", "write-tasks"].map((key) => ({
    path: "/admin/" + key, redirect: routes.metrics.path,
  })),
  { path: "/admin/knowledge", redirect: routes.knowledge.path },
  ...["analysis", "system-agents"].map((key) => ({ path: "/admin/" + key, redirect: routes.agents.path })),
  ...["skills", "skills/analysis", "skills/visualization"].map((key) => ({
    path: "/admin/" + key, redirect: routes.agentSettingsSkills.path,
  })),
  { path: "/admin/mcp-service", redirect: routes.agentSettingsMcp.path },
  ...["/observe", "/admin/observe"].map((base) => ({
    path: base + "/:page(.*)?",
    redirect: (to: RouteLocation) => ({
      path: routes.ops.path + (to.path.slice(base.length).replace(/\/$/, "") || "/diagnosis"),
      query: to.query,
    }),
  })),
  ...["/analysis", "/admin", "/admin/system-config", "/admin/feedback-records"].map((path) => ({ path, redirect: routes.chat.path })),
  // One list for every kind of task: the agent platform's own page is gone, and its address carries the agent it was
  // narrowed to into the platform's filter.
  { path: "/schedules/agents", redirect: routes.schedules.path },
  { path: "/schedules/functions/:id?", redirect: (to) => ({ path: routes.schedules.path, query: to.params.id ? { taskId: String(to.params.id) } : {} }) },
  { path: "/chat", redirect(to) {
    const { feature, ...query } = to.query;
    // The agent platform's column has no dashboards and no scheduled tasks any more: both are applications of their own.
    const path = feature === "schedule" ? routes.schedules.path : feature === "agents" ? routes.agents.path :
      feature === "dashboards" ? routes.dashboards.path : routes.chat.path;
    return { path, query };
  } },
];
