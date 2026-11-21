import type { NavigationGuard, RouteRecordRaw, Router } from "vue-router";
import { panelUsePath } from "@ontomato/contracts/panel-host";
import { isPanelApplication } from "@ontomato/contracts/platform-identity";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "./catalog";
import { startPage } from "./shell";

/**
 * The platform's last route: an address no page of its own serves. It draws nothing and redirects nowhere by itself —
 * `panelEntryGuard` decides where such an address goes, so a landing that is itself such an address (a deployment's
 * start page that a panel has taken over) cannot send the router round in a loop.
 */
export const unknownAddressRoute: RouteRecordRaw = { ...platformRoutes.unknown, component: { render: () => null } };

/*
 * A built-in application's panel entry at its own address (big main's ruling, 2026-11-21: one panel route serves every
 * declared entry, whatever its prefix). A native application declares its entries at its original addresses
 * (`/ontology/components`), which no route of the platform's names, so they reach the platform's last route. There the
 * application catalog is asked who declares the address — the catalog lists only the entries the reader may open, so the
 * entry's access has been checked — and the address opens that use relation's panel through the same route a panel
 * application's pages take, with its title, composer, page skill and admission. An address no entry declares lands
 * where the root does, or at the home when that landing is itself an address nothing serves for this reader.
 */
export function panelEntryGuard(router: Router): NavigationGuard {
  const catalog = useApplicationCatalog();
  const served = new Set<string>();
  const unknown = (address: string) => router.resolve(address).name === platformRoutes.unknown.name;
  return async (to) => {
    if (to.name !== platformRoutes.unknown.name) return true;
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
    if (!unknown(to.fullPath)) return to.fullPath;
    const start = startPage();
    return unknown(start) ? platformRoutes.home.path : start;
  };
}
