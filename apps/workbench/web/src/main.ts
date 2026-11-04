import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "@ontomato/workbench-ui/styles/style.css";
import "./narrow-dialogs.css";
import "@ontomato/workbench-ui/styles/admin-common.css";
import en from "element-plus/es/locale/lang/en";
import publicEn from "@ontomato/workbench-ui/locales/en";
import {
  legacyAdminRoutes,
  observeRoutes,
  openOntologyServiceAccess,
  startWorkbenchWeb,
} from "@ontomato/workbench-ui";
import { ossBrand } from "@ontomato/design-tokens/oss";
import { anonymousAuthHost } from "./auth";
import { workbenchContent } from "./workbench-content";

/*
 * Open-source web entry. Assembles the /chat workbench (its function area holds dashboards, agents, operations
 * diagnosis, scheduled tasks and the Ontology Service link) and the operations pages under /observe. The admin console is
 * gone: its pages are now the agents page of the function area, and its old addresses redirect there (the Manager deep
 * links keep leaving for the Ontology Service in the same tab). The UI has passed browser acceptance against locally
 * synthesized APIs; real full-stack integration is not yet verified, so this build cannot replace the production frontend.
 */
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
  // The open-source edition has no platform permissions: the Ontology Service entry is always shown.
  ontologyService: openOntologyServiceAccess,
  routes: [
    { path: "/", redirect: "/chat" },
    { path: "/chat", name: "Chat", component: () => import("./layout/UnifiedLayout.vue") },
    { path: "/analysis", name: "AnalysisMode", redirect: "/chat" },
    // Old admin addresses and the old Manager deep links: redirects only.
    ...Object.values(legacyAdminRoutes),
    // The open-source /observe had no auth/permission meta; the header has no account.
    { ...observeRoutes.root, props: { account: null }, children: observeRoutes.children },
  ],
});
