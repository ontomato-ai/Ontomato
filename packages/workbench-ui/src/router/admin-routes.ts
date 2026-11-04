import type { RouteLocationNormalized, RouteRecordRaw } from "vue-router";
import { ONTOLOGY_MANAGER_PATH } from "../config/app";

/** Visual modeling location parameters the Manager understands; the rest of the query (including credentials) is not passed on. */
const MANAGER_VIEW_PARAMS = ["focus", "id", "back"] as const;
/** The only return target the Manager's visual modeling knows: its own graph. */
const MANAGER_BACK_TARGETS = new Set(["playground"]);

export function managerViewQuery(query: Record<string, unknown>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const key of MANAGER_VIEW_PARAMS) {
    const value = query[key];
    if (typeof value !== "string") continue;
    if (key === "back" && !MANAGER_BACK_TARGETS.has(value)) continue;
    picked[key] = value;
  }
  return picked;
}

/** Old workbench Manager views and the Manager hash routes that replace them. */
const MANAGER_VIEWS: Record<string, string> = {
  assets: "/assets/metrics",
  knowledge: "/knowledge",
  "data-browser": "/data",
  "visual-modeling": "/visual-modeling",
};

/**
 * Manager page address for an old workbench Manager route: the view becomes the Manager hash route (visual modeling
 * also takes focus/id/back); without a known view the Manager opens on its own initial page.
 */
export function managerLocation(query: Record<string, unknown>): string {
  const view = typeof query.view === "string" ? MANAGER_VIEWS[query.view] : undefined;
  if (!view) return ONTOLOGY_MANAGER_PATH;
  const params =
    view === MANAGER_VIEWS["visual-modeling"] ? new URLSearchParams(managerViewQuery(query)).toString() : "";
  return `${ONTOLOGY_MANAGER_PATH}#${view}${params ? `?${params}` : ""}`;
}

/*
 * The Manager is a page of its own next to the workbench. An old Manager address opened in the workbench replaces the
 * current tab with the Manager page (no pop-up to block); the workbench never renders it.
 */
function leaveForManager(to: RouteLocationNormalized) {
  window.location.replace(managerLocation(to.query));
  return false;
}

const managerMeta = { group: "data-assets", permissions: ["ontology-modeling"] };

/*
 * The old admin console is gone: its pages moved into the function area (agents, operations diagnosis) or into the
 * Ontology Service (feedback records, system configuration). These records keep the old addresses working by opening the
 * new place in the same tab; the Manager deep links keep their existing redirects to the Manager page.
 *
 * Every record is a redirect, so no page of the workbench is rendered from here.
 */
export const legacyAdminRoutes = {
  root: { path: "/admin", redirect: "/chat" },
  // The Manager deep links (already moved to the Ontology Service before the console was retired).
  intelligenceAssets: {
    path: "/admin/intelligence-assets",
    redirect: "/admin/ontology-manager?view=assets",
    meta: managerMeta,
  },
  ontologyManager: {
    path: "/admin/ontology-manager",
    name: "OntologyManager",
    component: { render: () => null },
    beforeEnter: leaveForManager,
    meta: managerMeta,
  },
  ontology: {
    path: "/admin/ontology",
    name: "Ontology",
    redirect: "/admin/ontology-manager",
    meta: managerMeta,
  },
  visualModeling: {
    path: "/admin/ontology/visual-modeling",
    name: "VisualModeling",
    redirect: (to) => ({
      path: "/admin/ontology-manager",
      query: { ...managerViewQuery(to.query), view: "visual-modeling" },
    }),
    meta: managerMeta,
  },
  metricViews: {
    path: "/admin/metric-views",
    redirect: "/admin/ontology-manager?view=assets",
    meta: { permissions: ["ontology-modeling"] },
  },
  knowledge: {
    path: "/admin/knowledge",
    redirect: "/admin/ontology-manager?view=knowledge",
    meta: { group: "data-assets", permissions: ["business-knowledge"] },
  },
  actionManagement: {
    path: "/admin/action-management",
    redirect: "/admin/ontology-manager?view=assets",
    meta: managerMeta,
  },
  writeTasks: {
    path: "/admin/write-tasks",
    redirect: "/admin/ontology-manager?view=assets",
    meta: managerMeta,
  },
  // The console's own pages, now in the function area of the workbench.
  analysis: { path: "/admin/analysis", redirect: "/chat?feature=agents" },
  systemAgents: { path: "/admin/system-agents", redirect: "/chat?feature=agents" },
  skills: { path: "/admin/skills", redirect: "/chat?feature=agents&tab=capabilities" },
  skillsAnalysis: { path: "/admin/skills/analysis", redirect: "/chat?feature=agents&tab=capabilities" },
  skillsVisualization: { path: "/admin/skills/visualization", redirect: "/chat?feature=agents&tab=capabilities" },
  mcpService: { path: "/admin/mcp-service", redirect: "/chat?feature=agents&tab=capabilities" },
  // Operation addresses that lived under the console now open operations diagnosis, which keeps its own path and pages.
  observe: { path: "/admin/observe", redirect: "/observe" },
  observePage: {
    path: "/admin/observe/:page(.*)",
    redirect: (to) => ({ path: `/observe/${String(to.params.page ?? "")}`, query: to.query }),
  },
  // Retired pages: the system configuration and the feedback records are no longer settings of this application.
  systemConfig: { path: "/admin/system-config", redirect: "/chat" },
  feedbackRecords: { path: "/admin/feedback-records", redirect: "/chat" },
} satisfies Record<string, RouteRecordRaw>;

/** @deprecated The admin console is gone; kept as an alias while old imports are removed. */
export const adminRoutes = legacyAdminRoutes;
