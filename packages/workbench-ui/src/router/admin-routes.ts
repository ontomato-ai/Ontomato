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
 * Shared /admin child route records. Each app lists them explicitly in the original order (its own pages go between the
 * shared ones), with no registration or ordering framework. meta keeps only fields with consumers: group (layout tab
 * lookup) and permissions (app guards; any one of them grants access); the original title/icon/hidden had no reader.
 */
export const adminRoutes = {
  // The Ontology Manager is a link tab, so the console opens on its first own page.
  root: { path: "", name: "AdminRoot", redirect: "/admin/analysis" },
  intelligenceAssets: {
    path: "intelligence-assets",
    redirect: "/admin/ontology-manager?view=assets",
    meta: managerMeta,
  },
  ontologyManager: {
    path: "ontology-manager",
    name: "OntologyManager",
    component: { render: () => null },
    beforeEnter: leaveForManager,
    meta: managerMeta,
  },
  ontology: {
    path: "ontology",
    name: "Ontology",
    redirect: "/admin/ontology-manager",
    meta: managerMeta,
  },
  // Visual modeling now lives in the Manager: the old route leaves for it with the focus/id/back it understands.
  visualModeling: {
    path: "ontology/visual-modeling",
    name: "VisualModeling",
    redirect: (to) => ({
      path: "/admin/ontology-manager",
      query: { ...managerViewQuery(to.query), view: "visual-modeling" },
    }),
    meta: managerMeta,
  },
  metricViews: {
    path: "metric-views",
    redirect: "/admin/ontology-manager?view=assets",
    meta: { permissions: ["ontology-modeling"] },
  },
  // Business knowledge moved into the Ontology Manager; the old route redirects to the Manager's knowledge page.
  knowledge: {
    path: "knowledge",
    redirect: "/admin/ontology-manager?view=knowledge",
    meta: { group: "data-assets", permissions: ["business-knowledge"] },
  },
  actionManagement: {
    path: "action-management",
    redirect: "/admin/ontology-manager?view=assets",
    meta: managerMeta,
  },
  writeTasks: {
    path: "write-tasks",
    redirect: "/admin/ontology-manager?view=assets",
    meta: managerMeta,
  },
  analysis: {
    path: "analysis",
    name: "Analysis",
    component: () => import("../features/agents/components/AgentSettingsPage.vue"),
    meta: { group: "app-capabilities", permissions: ["analysis-agent"] },
  },
  systemAgents: {
    path: "system-agents",
    name: "SystemAgents",
    component: () => import("../features/admin/components/SystemAgents.vue"),
    meta: { group: "app-capabilities", permissions: ["observer"] },
  },
  mcpService: {
    path: "mcp-service",
    name: "McpService",
    component: () => import("../features/mcp/components/McpManager.vue"),
    meta: { group: "app-capabilities", permissions: ["mcp-service"] },
  },
  skills: {
    path: "skills",
    name: "Skills",
    component: () => import("../features/skills/components/SkillManager.vue"),
    meta: { group: "app-capabilities", permissions: ["skill-management"] },
  },
  skillsAnalysis: {
    path: "skills/analysis",
    redirect: "/admin/skills",
    meta: { group: "app-capabilities", permissions: ["analytical-skills"] },
  },
  skillsVisualization: {
    path: "skills/visualization",
    redirect: "/admin/skills",
    meta: { group: "app-capabilities", permissions: ["visualization-skills"] },
  },
  modelConfig: {
    path: "model-config",
    name: "ModelConfig",
    component: () => import("../features/system/components/ModelConfig.vue"),
    meta: { group: "platform-management", permissions: ["system-config"] },
  },
  // Edition values (BusinessConfigProps) are passed by the app as props on the route record.
  businessConfig: {
    path: "system-config",
    name: "SystemConfig",
    component: () => import("../features/system/components/BusinessConfig.vue"),
    meta: { group: "platform-management", permissions: ["system-config"] },
  },
  auditLog: {
    path: "audit-log",
    name: "AuditLog",
    component: () => import("../features/admin/components/platform-operations/AuditLogManager.vue"),
    meta: { group: "platform-management", permissions: ["audit-logs"] },
  },
  feedbackRecords: {
    path: "feedback-records",
    name: "FeedbackRecords",
    component: () => import("../features/admin/components/platform-operations/FeedbackRecords.vue"),
    meta: { group: "platform-management", permissions: ["audit-logs"] },
  },
  systemMonitor: {
    path: "system-monitor",
    name: "SystemMonitor",
    component: () => import("../features/admin/components/platform-operations/SystemMonitor.vue"),
    meta: { group: "platform-management", permissions: ["system-monitoring"] },
  },
} satisfies Record<string, RouteRecordRaw>;
