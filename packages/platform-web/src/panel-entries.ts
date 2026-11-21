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
 * application's pages take, with its title, composer, page skill and admission. An address no entry serves for this
 * reader goes on to the edition's own guards: one its navigation still lists is a page this reader lacks, and goes where
 * any such page goes. Whatever is still unserved after them lands with `addressLandingGuard`.
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
  /** This start of the platform's own read of the catalog: one read before the first unknown address is decided. */
  let read: Promise<void> | null = null;
  return async (to) => {
    if (to.name !== platformRoutes.unknown.name) return true;
    await (read ??= catalog.refresh());
    serveEntries();
    // A grant since that read may not be listed yet: read it again once.
    if (unknown(to.fullPath)) {
      await catalog.refresh();
      serveEntries();
    }
    return unknown(to.fullPath) ? true : to.fullPath;
  };
}

/**
 * Where an address nothing serves for this reader lands, once every other guard has had its say: where the root does,
 * or — when that landing is itself such an address, a start page a panel took over that this reader's catalog does not
 * offer — the platform's landing for a reader, the first page their access opens. When that landing picks this same
 * address again, nothing serves it for them: the home.
 */
export function addressLandingGuard(router: Router): NavigationGuard {
  const catalog = useApplicationCatalog();
  const unknown = (address: string) => router.resolve(address).name === platformRoutes.unknown.name;
  /** The address last sent to the landing because nothing served it for this reader. */
  let sentToLanding: string | null = null;
  let read: Promise<void> | null = null;
  return async (to) => {
    if (to.name === platformRoutes.ontology.name) {
      // Every page guard left this reader at `/ontology` because they have no native page in the navigation:
      // land on the first permission-gated panel entry they hold — ontology first (for example business knowledge),
      // then another native application (for example operations' user feedback).
      await (read ??= catalog.refresh());
      const nativeApps = catalog.applications.value.filter((app) => !isPanelApplication(app));
      const ordered = [
        ...nativeApps.filter((app) => app.id === "ontology"),
        ...nativeApps.filter((app) => app.id !== "ontology"),
      ];
      const first = ordered
        .flatMap((app) => app.panelUses ?? [])
        .find((use) => "permissionCode" in use.access);
      if (first) return panelUsePath(first.path);
      return true;
    }
    if (to.name !== platformRoutes.unknown.name) {
      sentToLanding = null;
      return true;
    }
    const start = startPage();
    if (!unknown(start)) return start;
    if (sentToLanding === to.fullPath) {
      sentToLanding = null;
      return platformRoutes.home.path;
    }
    sentToLanding = to.fullPath;
    return { name: platformRoutes.ontology.name };
  };
}
