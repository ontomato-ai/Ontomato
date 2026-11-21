import type { NavigationGuard, Router } from "vue-router";
import { panelUsePath } from "@ontomato/contracts/panel-host";
import { isPanelApplication } from "@ontomato/contracts/platform-identity";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "./catalog";

/*
 * A built-in application's panel entry at its own address (big main's ruling, 2026-11-21: one panel route serves every
 * declared entry, whatever its prefix). A native application declares its entries at its original addresses
 * (`/ontology/components`), which no route of the platform's names, so they reach the catch-all. Before it lands the
 * reader elsewhere, the application catalog is asked who declares the address — the catalog lists only the entries the
 * reader may open, so the entry's access has been checked — and the address opens that use relation's panel through the
 * same route a panel application's pages take, with its title, composer, page skill and admission. An address no entry
 * declares goes on to the catch-all.
 */
export function panelEntryGuard(router: Router): NavigationGuard {
  const catalog = useApplicationCatalog();
  const served = new Set<string>();
  return async (to) => {
    const asked = to.redirectedFrom;
    // Only an address the catch-all sent elsewhere. Retried, the address keeps that origin but is served where it is.
    if (asked?.name !== platformRoutes.unknown.name || to.fullPath === asked.fullPath) return true;
    // A deep link arrives before the shell has read the catalog.
    if (catalog.applications.value.length === 0) await catalog.refresh();
    for (const app of catalog.applications.value) {
      if (isPanelApplication(app)) continue;
      for (const use of app.panelUses ?? []) {
        const path = panelUsePath(use.path);
        if (served.has(path)) continue;
        served.add(path);
        router.addRoute(platformRoutes.layout.name, {
          path,
          component: () => import("./pages/PanelApplicationRoute.vue"),
          props: { applicationId: app.id },
        });
      }
    }
    return router.resolve(asked.fullPath).name === platformRoutes.unknown.name ? true : asked.fullPath;
  };
}
