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
 * where the root does, or, when that landing is itself an address nothing serves for this reader, on the first page
 * their access opens.
 */
export function panelEntryGuard(router: Router): NavigationGuard {
  const catalog = useApplicationCatalog();
  const served = new Set<string>();
  const unknown = (address: string) => router.resolve(address).name === platformRoutes.unknown.name;
  /** Opens every entry the catalog now lists that has no route yet. */
  function serveEntries() {
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
  }
  /** The address last sent to the landing because nothing served it for this reader. */
  let sentToLanding: string | null = null;
  return async (to) => {
    if (to.name !== platformRoutes.unknown.name) return true;
    serveEntries();
    // A catalog read for another moment (before sign-in, before a grant) may not list the entry yet: read it again once.
    if (unknown(to.fullPath)) {
      await catalog.refresh();
      serveEntries();
    }
    if (!unknown(to.fullPath)) {
      sentToLanding = null;
      return to.fullPath;
    }
    const start = startPage();
    if (!unknown(start)) return start;
    // The landing a reader may not open — a start page a panel took over that this reader's catalog does not offer — is
    // the platform's landing for such a reader: the first page their access opens, as for a native page they lack. When
    // that landing picks this same address again, nothing serves it for them: the home.
    if (sentToLanding === to.fullPath) {
      sentToLanding = null;
      return platformRoutes.home.path;
    }
    sentToLanding = to.fullPath;
    return { name: platformRoutes.ontology.name };
  };
}
