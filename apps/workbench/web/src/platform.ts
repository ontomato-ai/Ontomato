import { defineComponent, h } from "vue";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "@ontomato/workbench-ui/styles/style.css";
import "./narrow-dialogs.css";
import "@ontomato/workbench-ui/styles/admin-common.css";
import { openOntologyServiceAccess } from "@ontomato/workbench-ui";
import {
  appBuilderPages,
  dashboardPages,
  personalWorkspacePages,
  legacyAdminRoutes,
  observeRoutes,
  PlatformShellLayout,
  platformLayoutRoute,
  schedulePages,
  startWorkbenchWeb,
  workbenchPages,
} from "@ontomato/platform-web";
import { ossBrand } from "@ontomato/design-tokens/oss";
import { anonymousAuthHost } from "./auth";
import { ossLanguage } from "./language";
import { workbenchContent } from "./workbench-content";

import { normalizeManagerEntry, reloadOnStaleBuild, startPage } from "@ontomato/platform-web";
import { ossServicePages } from "./manager/platform";

/**
 * The open-source platform shell: the platform's layout with this edition's mark. The image is served beside index.html
 * (public/), so a path relative to the page follows the deployment's prefix, as the favicon does; the name is the
 * platform's service name.
 */
// A component object, not a bare render function: the router takes a bare function for a lazy loader and expects a
// promise from it, which left the whole open-source site blank (2026-11-12).
const OssPlatformShell = defineComponent({
  name: "OssPlatformShell",
  render: () => h(PlatformShellLayout, { brand: { logo: "./ontomato-mark-green.svg" } }),
});

export function startPlatform() {
  normalizeManagerEntry();
  reloadOnStaleBuild();
  startWorkbenchWeb({
    brand: ossBrand,
    language: ossLanguage,
    auth: anonymousAuthHost,
    errorPunctuation: { detailSeparator: ":", listSeparator: ";" },
    content: workbenchContent,
    // The open-source /observe has no permission gate: the turn diagnosis entry is visible to all users.
    turnDiagnosis: { prepare: () => {}, visible: () => true },
    // The open-source edition has no platform permissions: the Ontology Service entry is always shown.
    ontologyService: openOntologyServiceAccess,
    routes: (app, router) => [
      // One layout for every application: the platform shell draws the rail and the column, the routes fill it.
      platformLayoutRoute([
        ...workbenchPages(() => import("@ontomato/workbench-ui/features/workbench").then((m) => m.BusinessWorkbench), {
          ...observeRoutes.root,
          props: { account: null },
        }),
        ...dashboardPages(),
        ...personalWorkspacePages(),
        ...schedulePages(),
        // The open-source edition has no permissions: every reader may build.
        ...appBuilderPages(),
        ...ossServicePages(app, router),
      ], OssPlatformShell),
      ...legacyAdminRoutes,
      // An unknown address lands where the root does.
      { path: "/:unknown(.*)*", redirect: () => startPage() },
    ],
  });
}
