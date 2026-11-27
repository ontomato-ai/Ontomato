import { panelUsePath } from "@ontomato/contracts/panel-host";
import type { ApplicationOpenResponse } from "@ontomato/contracts/product-panels";
import type { PlatformAccess } from "@ontomato/platform-admin";
import { ApiRequestError } from "@ontomato/workbench-ui";
import { computed } from "vue";
import { useApplicationCatalog } from "./catalog";
import { routeEntryPath, routeOpenedEntry } from "./panel-entries";
import { resolveApplicationEntry } from "./panel-host";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import type { Router } from "vue-router";

/** One-shot handoff carrying the active navigation's `verifyEntry` response into `to.meta.openedPanelEntry`. */
let verifiedForNavigation: { path: string; entry: ApplicationOpenResponse } | null = null;

function claimVerifiedEntry(path: string): ApplicationOpenResponse | null {
  const current = verifiedForNavigation;
  verifiedForNavigation = null;
  return current && current.path === panelUsePath(path) ? current.entry : null;
}

export function hasOntologyServiceEntry(): boolean {
  return useApplicationCatalog().applications.value.some(app => app.ownerService === "data-engine");
}

export function installCatalogueEntryGuard(router: Router, access = catalogueEntryAccess()) {
  router.beforeEach(async (to, from) => {
    const path = to.meta.entryPath;
    if (typeof path !== "string") return true;
    if (routeOpenedEntry(to, path)) return true;
    const sameEntry = from.path === to.path ? routeOpenedEntry(from, path) : null;
    if (sameEntry) {
      to.meta.openedPanelEntry = sameEntry;
      return true;
    }
    const admission = await access.verifyEntry(path);
    if (admission !== "allowed") return { name: platformRoutes.ontology.name };
    const opened = claimVerifiedEntry(path);
    if (opened) to.meta.openedPanelEntry = opened;
    return true;
  });
  // Attach responses produced by upstream page guards (such as `installPageGuard`) onto the committed route.
  router.beforeResolve(to => {
    const opened = claimVerifiedEntry(routeEntryPath(to));
    if (opened && !to.meta.openedPanelEntry) to.meta.openedPanelEntry = opened;
  });
  router.afterEach(() => {
    verifiedForNavigation = null;
  });
}

export function catalogueEntryAccess(): PlatformAccess {
  const catalogue = useApplicationCatalog();
  const paths = computed(() => new Set(catalogue.applications.value.flatMap(app => app.entryPaths!.map(panelUsePath))));
  return {
    get ready() { return !catalogue.loading.value; },
    get error() { return catalogue.error.value; },
    canEnter: path => paths.value.has(panelUsePath(path)),
    async verifyEntry(path) {
      verifiedForNavigation = null;
      const normalized = panelUsePath(path);
      try {
        const opened = await resolveApplicationEntry({ path: normalized });
        verifiedForNavigation = { path: normalized, entry: opened };
        return "allowed";
      } catch (error) {
        if (error instanceof ApiRequestError) {
          if (error.status === 402) return "license-required";
          if (error.status === 403 || error.status === 404) return "denied";
        }
        throw error;
      }
    },
    load: catalogue.ensureCatalog,
  };
}
