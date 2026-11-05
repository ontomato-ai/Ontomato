import type { RouteLocation, RouteRecordRaw } from "vue-router";
import { platformRoutes as routes } from "@ontomato/platform-admin/routes";

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

const capabilityTab = { path: routes.agents.path, query: { tab: "capabilities" } };
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
  ...["skills", "skills/analysis", "skills/visualization", "mcp-service"].map((key) => ({
    path: "/admin/" + key, redirect: capabilityTab,
  })),
  ...["/observe", "/admin/observe"].map((base) => ({
    path: base + "/:page(.*)?",
    redirect: (to: RouteLocation) => ({
      path: routes.ops.path + (to.path.slice(base.length).replace(/\/$/, "") || "/diagnosis"),
      query: to.query,
    }),
  })),
  ...["/analysis", "/admin", "/admin/system-config", "/admin/feedback-records"].map((path) => ({ path, redirect: routes.chat.path })),
  { path: "/chat", redirect(to) {
    const { feature, ...query } = to.query;
    const path = feature === "schedule" ? routes.agentTasks.path : feature === "agents" ? routes.agents.path :
      feature === "dashboards" ? routes.dashboards.path : routes.chat.path;
    return { path, query };
  } },
];
