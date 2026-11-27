import type { NavigationGuard, RouteLocationNormalizedLoaded, RouteRecordRaw, Router } from "vue-router";
import { panelUsePath } from "@ontomato/contracts/panel-host";
import { isPanelApplication } from "@ontomato/contracts/platform-identity";
import { isNativeApplicationEntry, type ApplicationOpenResponse } from "@ontomato/contracts/product-panels";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "./catalog";
import { resolveApplicationEntry } from "./panel-host";
import { startPage } from "./shell";

declare module "vue-router" {
  interface RouteMeta {
    /** Opening result for this navigation, shared by the layout, outer frame, and panel route. */
    openedPanelEntry?: ApplicationOpenResponse;
  }
}

/** Entry path a route belongs to: explicit entryPath, declared native page path, or the route's own path. */
export function routeEntryPath(route: Pick<RouteLocationNormalizedLoaded, "path" | "meta">): string {
  if (typeof route.meta.entryPath === "string") return route.meta.entryPath;
  if (typeof route.meta.page === "string") return route.meta.page;
  return route.path;
}

/** Returns the pre-opened entry carried on this navigation, optionally matched against `path`. */
export function routeOpenedEntry(
  route: Pick<RouteLocationNormalizedLoaded, "meta" | "redirectedFrom">,
  path?: string,
): ApplicationOpenResponse | null {
  const entry = route.meta.openedPanelEntry ?? route.redirectedFrom?.meta.openedPanelEntry ?? null;
  if (!entry) return null;
  if (path !== undefined && panelUsePath(entry.use.path) !== panelUsePath(path)) return null;
  return entry;
}

/** The paths one router has already opened an entry route for. */
const servedEntries = new WeakMap<Router, Set<string>>();

function addPanelEntryRoute(router: Router, applicationId: string, rawPath: string): void {
  const path = panelUsePath(rawPath);
  if (path === platformRoutes.home.path || path.startsWith("/applications/")) return;
  const served = servedEntries.get(router) ?? new Set<string>();
  servedEntries.set(router, served);
  if (served.has(path)) return;
  served.add(path);
  router.addRoute(platformRoutes.layout.name, {
    path,
    meta: { ownHeader: true },
    component: () => import("./pages/PanelApplicationRoute.vue"),
    props: { applicationId },
  });
}

/** Registers built-in panel routes directly from an authoritative opening response. */
export function serveOpenedEntry(router: Router, resolved: ApplicationOpenResponse): void {
  for (const entry of [resolved.use, ...resolved.menu.panelUses]) {
    if (isNativeApplicationEntry(entry)) continue;
    addPanelEntryRoute(router, resolved.applicationId, entry.path);
  }
}

/**
 * Opens every entry the loaded catalog details now list that has no route yet. A page that asks to open another page's
 * address (the graph's modeling page, say) asks before either address has been visited, so it is opened on that ask too
 * rather than answered "no such page" (M4, 2026-11-22).
 */
export function servePanelEntries(router: Router): void {
  const catalog = useApplicationCatalog();
  for (const app of catalog.mergedApplications.value) {
    if (isPanelApplication(app)) continue;
    for (const use of app.panelUses ?? []) {
      if (isNativeApplicationEntry(use)) continue;
      addPanelEntryRoute(router, app.id, use.path);
    }
  }
}

/**
 * Opens the entry for the requested address (or refreshes the catalog when no address is specified): a page can be
 * asked for before its owning application's entry table has been read, and an address that exists must not be called
 * missing because nobody had looked yet.
 */
export async function readAndServePanelEntries(router: Router, address?: string): Promise<ApplicationOpenResponse | null> {
  if (address) {
    const path = address.split("?")[0]!;
    try {
      const resolved = await resolveApplicationEntry({ path });
      serveOpenedEntry(router, resolved);
      return resolved;
    } catch {
      return null;
    }
  }
  await useApplicationCatalog().refresh();
  servePanelEntries(router);
  return null;
}

/**
 * The platform's last route: an address no page of its own serves. It draws nothing and redirects nowhere by itself —
 * `panelEntryGuard` decides where such an address goes, so a landing that is itself such an address (a deployment's
 * start page that a panel has taken over) cannot send the router round in a loop.
 */
export const unknownAddressRoute: RouteRecordRaw = { ...platformRoutes.unknown, component: { render: () => null } };

/*
 * A built-in application's panel entry at its own address (big main's ruling, 2026-11-21: one panel route serves every
 * declared entry, whatever its prefix). Unknown addresses resolve directly through `resolveApplicationEntry`, which
 * admits the reader and returns the entry, menu, standalone policy, and bundled frame/content definitions in one round
 * trip without preloading the application catalog. An address no entry serves for this reader falls through to the
 * edition's own guards and finally `addressLandingGuard`.
 */
export function panelEntryGuard(router: Router): NavigationGuard {
  const unknown = (address: string) => router.resolve(address).name === platformRoutes.unknown.name;
  return async (to) => {
    if (to.name !== platformRoutes.unknown.name) return true;
    servePanelEntries(router);
    if (!unknown(to.fullPath)) return to.fullPath;
    let resolved: ApplicationOpenResponse;
    try {
      resolved = await resolveApplicationEntry({ path: to.path });
    } catch {
      return true;
    }
    serveOpenedEntry(router, resolved);
    to.meta.openedPanelEntry = resolved;
    const landing = panelUsePath(resolved.use.path);
    if (landing !== to.path && !unknown(landing)) {
      return { path: landing, query: to.query, hash: to.hash };
    }
    if (!unknown(to.fullPath)) return to.fullPath;
    return true;
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
  return async (to) => {
    if (to.name === platformRoutes.ontology.name) {
      // Every page guard left this reader at `/ontology` because they have no native page in the navigation:
      // land on the first available panel entry — ontology first (for example business knowledge),
      // then another native application (for example settings' audit log or operations' user feedback).
      await catalog.ensureCatalog();
      const nativeApps = catalog.mergedApplications.value.filter(
        app => !isPanelApplication(app) && (app.ownerService === "data-engine" || app.rail !== "top"),
      );
      const ordered = [
        ...nativeApps.filter((app) => app.id === "ontology"),
        ...nativeApps.filter((app) => app.id !== "ontology"),
      ];
      for (const candidate of ordered) {
        const app = candidate.panelUses !== undefined
          ? candidate
          : await catalog.ensureApplication(candidate.id).catch(() => candidate);
        const first = app.panelUses?.find(use => !isNativeApplicationEntry(use));
        if (first) {
          servePanelEntries(router);
          return panelUsePath(first.path);
        }
      }
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
