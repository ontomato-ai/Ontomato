import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import "@ontomato/workbench-ui/styles/style.css";
import "./narrow-dialogs.css";
import "@ontomato/workbench-ui/styles/admin-common.css";
import en from "element-plus/es/locale/lang/en";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { openOntologyServiceAccess } from "@ontomato/workbench-ui";
import {
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
import { workbenchContent } from "./workbench-content";

import { platformRoutes } from "@ontomato/platform-shell/routes";
import { normalizeManagerEntry, reloadOnStaleBuild } from "@ontomato/platform-web";
import { ossServicePages } from "./manager/platform";

export function startPlatform() {
  normalizeManagerEntry();
  reloadOnStaleBuild();
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
    routes: (app, router) => [
      // One layout for every application: the platform shell draws the rail and the column, the routes fill it.
      platformLayoutRoute([
        ...workbenchPages(() => import("@ontomato/workbench-ui/features/workbench").then((m) => m.BusinessWorkbench), {
          ...observeRoutes.root,
          props: { account: null },
        }),
        ...schedulePages(),
        ...ossServicePages(app, router),
      ], PlatformShellLayout),
      ...legacyAdminRoutes,
      { path: "/:unknown(.*)*", redirect: platformRoutes.chat.path },
    ],
  });
}
