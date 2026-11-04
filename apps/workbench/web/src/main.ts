import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "@ontomato/workbench-ui/styles/style.css";
import "./narrow-dialogs.css";
import "@ontomato/workbench-ui/styles/admin-common.css";
import en from "element-plus/es/locale/lang/en";
import publicEn from "@ontomato/workbench-ui/locales/en";
import {
  adminGroups,
  AdminLayout,
  adminMenuItems,
  adminRoutes,
  observeRoutes,
  startWorkbenchWeb,
  type AdminLayoutConfig,
} from "@ontomato/workbench-ui";
import { ossBrand } from "@ontomato/design-tokens/oss";
import { anonymousAuthHost } from "./auth";
import { workbenchContent } from "./workbench-content";

/*
 * Open-source web entry. Assembles the /chat workbench layout, /observe and all open-source admin pages (the /admin
 * layout, business agents, system agents, knowledge governance, skills, MCP services, model configuration, the
 * workbench part of the system config and feedback records). Audit logs, system monitoring and the ontology service
 * part of the system config are platform pages in the Ontology Manager. Old Manager addresses (the Manager entry, business knowledge,
 * smart assets, visual modeling) leave for the Ontology Manager page in the same tab. The UI has
 * passed browser acceptance against locally synthesized APIs; real full-stack integration is not yet verified, so this
 * build cannot replace the production frontend.
 * Menu: the Ontology Manager tab (a link that opens the Manager page in a new window); Agents and Skills: analysis,
 * system-agents, skills, mcp-service; System Management: system-config, feedback-records.
 */
const adminLayout: AdminLayoutConfig = {
  access: { ready: true, can: () => true },
  groups: [
    adminGroups.dataAssets,
    adminGroups.appCapabilities,
    adminGroups.platformManagement,
  ],
  items: [
    adminMenuItems.businessAgents,
    adminMenuItems.systemAgents,
    adminMenuItems.skills,
    adminMenuItems.mcpService,
    adminMenuItems.systemConfig,
    adminMenuItems.feedbackRecords,
  ],
  account: null,
};

startWorkbenchWeb({
  brand: ossBrand,
  language: {
    supported: ["en"],
    defaultLocale: "en",
    initialLocale: "en",
    switchEnabled: false,
    save: null,
    messages: { en: publicEn },
    elementLocale: () => en,
  },
  auth: anonymousAuthHost,
  errorPunctuation: { detailSeparator: ":", listSeparator: ";" },
  content: workbenchContent,
  // The open-source /observe has no permission gate: the turn diagnosis entry is visible to all users.
  turnDiagnosis: { prepare: () => {}, visible: () => true },
  routes: [
    { path: "/", redirect: "/chat" },
    { path: "/chat", name: "Chat", component: () => import("./layout/UnifiedLayout.vue") },
    { path: "/analysis", name: "AnalysisMode", redirect: "/chat" },
    {
      path: "/admin",
      component: AdminLayout,
      props: adminLayout,
      children: [
        adminRoutes.root,
        adminRoutes.intelligenceAssets,
        adminRoutes.ontologyManager,
        adminRoutes.ontology,
        adminRoutes.visualModeling,
        adminRoutes.metricViews,
        adminRoutes.knowledge,
        adminRoutes.actionManagement,
        adminRoutes.writeTasks,
        adminRoutes.analysis,
        adminRoutes.systemAgents,
        adminRoutes.mcpService,
        adminRoutes.skills,
        adminRoutes.skillsAnalysis,
        adminRoutes.skillsVisualization,
        adminRoutes.systemConfig,
        adminRoutes.feedbackRecords,
      ],
    },
    // The open-source /observe had no auth/permission meta; the header has no account.
    { ...observeRoutes.root, props: { account: null }, children: observeRoutes.children },
  ],
});
