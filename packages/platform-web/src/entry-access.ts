import { panelUsePath } from "@ontomato/contracts/panel-host";
import type { PlatformAccess } from "@ontomato/platform-admin";
import { ApiRequestError } from "@ontomato/workbench-ui";
import { computed } from "vue";
import { useApplicationCatalog } from "./catalog";
import { resolveApplicationEntry } from "./panel-host";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import type { Router } from "vue-router";

export function hasOntologyServiceEntry(): boolean {
  return useApplicationCatalog().applications.value.some(app => app.ownerService === "data-engine");
}

export function installCatalogueEntryGuard(router: Router, access = catalogueEntryAccess()) {
  router.beforeEach(async to => {
    const path = to.meta.entryPath;
    if (typeof path !== "string") return true;
    const admission = await access.verifyEntry(path);
    return admission === "allowed" ? true : { name: platformRoutes.ontology.name };
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
      try {
        await resolveApplicationEntry({ path: panelUsePath(path) });
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
