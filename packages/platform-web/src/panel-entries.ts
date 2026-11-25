import type { NavigationGuard, RouteLocationNormalized, RouteRecordRaw, Router } from "vue-router";
import { panelUsePath } from "@ontomato/contracts/panel-host";
import { isPanelApplication, type CatalogApplication } from "@ontomato/contracts/platform-identity";
import { isNativeApplicationEntry, type ApplicationEntryResolution } from "@ontomato/contracts/product-panels";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { builtinApplicationForPath, firstVisiblePanelPath, useApplicationCatalog } from "./catalog";
import { externalLinkTab } from "./external-link";
import { resolveApplicationEntry } from "./panel-host";
import { startPage } from "./shell";

declare module "vue-router" {
  interface RouteMeta {
    /** Opening result from the initial standalone route match, consumed by the redirected panel route. */
    openedPanelEntry?: ApplicationEntryResolution;
  }
}

/** The paths one router has already opened an entry route for. */
const servedEntries = new WeakMap<Router, Set<string>>();

/**
 * Opens every entry the loaded catalog details now list that has no route yet. A page that asks to open another page's
 * address (the graph's modeling page, say) asks before either address has been visited, so it is opened on that ask too
 * rather than answered "no such page" (M4, 2026-11-22).
 */
export function servePanelEntries(router: Router): void {
  const catalog = useApplicationCatalog();
  const served = servedEntries.get(router) ?? new Set<string>();
  servedEntries.set(router, served);
  for (const app of catalog.mergedApplications.value) {
    if (isPanelApplication(app)) continue;
    for (const use of app.panelUses ?? []) {
      if (isNativeApplicationEntry(use)) continue;
      const path = panelUsePath(use.path);
      if (path === platformRoutes.home.path) continue;
      if (served.has(path)) continue;
      served.add(path);
      router.addRoute(platformRoutes.layout.name, {
        path,
        meta: { ownHeader: true },
        component: () => import("./pages/PanelApplicationRoute.vue"),
        props: { applicationId: app.id },
      });
    }
  }
}

function isStandaloneRequest(to?: Pick<RouteLocationNormalized, "query">): boolean {
  return to?.query?.standalone === "1" || externalLinkTab();
}

async function resolveBuiltInEntryOwner(
  router: Router,
  path: string,
  options: { standalone?: boolean; opened?: (entry: ApplicationEntryResolution) => void } = {},
): Promise<CatalogApplication | null> {
  const catalog = useApplicationCatalog();
  let owner = builtinApplicationForPath(path);
  const hadOwner = owner !== null;
  if (!owner) {
    if (options.standalone) {
      try {
        const resolved = await resolveApplicationEntry({ path });
        owner = await catalog.ensureApplication(resolved.applicationId);
        options.opened?.(resolved);
      } catch {
        return null;
      }
      servePanelEntries(router);
      return owner;
    }
    await catalog.ensureCatalog();
    servePanelEntries(router);
    owner = builtinApplicationForPath(path);
  }
  if (!owner) return null;
  if (owner.panelUses === undefined) {
    owner = await catalog.ensureApplication(owner.id).catch(() => owner);
  } else if (hadOwner) {
    owner = await catalog.refreshApplication(owner.id).catch(() => owner);
  }
  servePanelEntries(router);
  return owner;
}

/**
 * Opens the entries for the requested address (or the catalog when no address is specified): a page can be asked for
 * before its owning application's entry table has been read, and an address that exists must not be called missing
 * because nobody had looked yet.
 */
export async function readAndServePanelEntries(router: Router, address?: string): Promise<void> {
  if (address) {
    const path = address.split("?")[0]!;
    await resolveBuiltInEntryOwner(router, path, { standalone: externalLinkTab() });
    return;
  }
  await useApplicationCatalog().refresh();
  servePanelEntries(router);
}

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
 * owning application's entry table is loaded on demand — navigation summaries omit `panelUses`, and standalone links
 * resolve directly via `resolveApplicationEntry` without loading the full catalog — and the address opens that use
 * relation's panel through the same route a panel application's pages take. An address no entry serves for this reader
 * goes on to the edition's own guards; whatever is still unserved after them lands with `addressLandingGuard`.
 */
export function panelEntryGuard(router: Router): NavigationGuard {
  const unknown = (address: string) => router.resolve(address).name === platformRoutes.unknown.name;
  return async (to) => {
    if (to.name !== platformRoutes.unknown.name) return true;
    servePanelEntries(router);
    if (!unknown(to.fullPath)) return to.fullPath;
    // A cold link, an unloaded built-in summary, or a newly granted entry loads its owning application on demand.
    const owner = await resolveBuiltInEntryOwner(router, to.path, {
      standalone: isStandaloneRequest(to),
      opened: entry => { to.meta.openedPanelEntry = entry; },
    });
    if (!unknown(to.fullPath)) return to.fullPath;
    // Entering a built-in application's root prefix (e.g. `/settings`, `/permissions`, `/ops`) lands on its first visible entry.
    if (owner && to.path === owner.entry.path) {
      const landing = owner.entry.home ?? firstVisiblePanelPath(owner);
      if (landing && !unknown(landing)) {
        return { path: landing, query: to.query, hash: to.hash };
      }
    }
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
        (app) => !isPanelApplication(app) && app.id !== platformRoutes.home.path.slice(1) && app.id !== "application-gallery",
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
