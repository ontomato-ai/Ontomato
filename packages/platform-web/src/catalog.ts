import { computed, shallowRef } from "vue";
import { applicationCatalogSchema, isPanelApplication, type CatalogApplication } from "@ontomato/contracts/platform-identity";
import { isNativeApplicationEntry } from "@ontomato/contracts/product-panels";
import { panelUsePath } from "@ontomato/contracts/panel-host";
import { nodeApiRequest } from "@ontomato/workbench-ui";

const applications = shallowRef<CatalogApplication[]>([]);
const details = shallowRef<ReadonlyMap<string, CatalogApplication>>(new Map());
const error = shallowRef<string | null>(null);
const loading = shallowRef(true);
const inFlightDetails = new Map<string, Promise<CatalogApplication>>();
let inFlightCatalog: Promise<void> | null = null;
let generation = 0;

const mergedApplications = computed<CatalogApplication[]>(() => {
  const detailMap = details.value;
  if (detailMap.size === 0) return applications.value;
  const seen = new Set<string>();
  const merged = applications.value.map((app) => {
    seen.add(app.id);
    return detailMap.get(app.id) ?? app;
  });
  for (const [id, detail] of detailMap) {
    if (!seen.has(id)) merged.push(detail);
  }
  return merged;
});

export function resetApplicationCatalog(): void {
  generation += 1;
  applications.value = [];
  details.value = new Map();
  inFlightDetails.clear();
  inFlightCatalog = null;
  error.value = null;
  loading.value = true;
}

export async function readApplicationCatalog(purpose = "navigation") {
  const response = await nodeApiRequest(`/api/data-query/platform/applications?purpose=${purpose}`, {});
  const body = await response.json();
  if (!body.success) throw new Error(body.message);
  return applicationCatalogSchema.parse(body.data);
}

export async function readApplication(id: string): Promise<CatalogApplication> {
  const response = await nodeApiRequest(`/api/data-query/platform/applications/${encodeURIComponent(id)}`, {});
  const body = await response.json();
  if (!body.success) throw new Error(body.message);
  return applicationCatalogSchema.element.parse(body.data);
}

function storeDetail(app: CatalogApplication): void {
  const next = new Map(details.value);
  next.set(app.id, app);
  details.value = next;
}

export function applicationById(id: string): CatalogApplication | null {
  return details.value.get(id) ?? applications.value.find((app) => app.id === id) ?? null;
}

export async function refreshApplication(id: string): Promise<CatalogApplication> {
  const epoch = generation;
  const task = readApplication(id).then((app) => {
    if (epoch === generation) storeDetail(app);
    return app;
  }).finally(() => {
    if (inFlightDetails.get(id) === task) inFlightDetails.delete(id);
  });
  inFlightDetails.set(id, task);
  return task;
}

export async function ensureApplication(id: string): Promise<CatalogApplication> {
  const existing = details.value.get(id);
  if (existing) return existing;
  const listed = applications.value.find((app) => app.id === id);
  if (listed?.panelUses !== undefined) return listed;
  const pending = inFlightDetails.get(id);
  if (pending) return pending;
  return refreshApplication(id);
}

async function refreshCatalog(): Promise<void> {
  const epoch = generation;
  loading.value = true;
  const task = readApplicationCatalog().then(
    (next) => {
      if (epoch !== generation) return;
      applications.value = next;
      error.value = null;
    },
    (failure) => {
      if (epoch !== generation) return;
      error.value = failure instanceof Error ? failure.message : String(failure);
    },
  ).finally(() => {
    if (epoch === generation) loading.value = false;
    if (inFlightCatalog === task) inFlightCatalog = null;
  });
  inFlightCatalog = task;
  return task;
}

async function ensureCatalog(): Promise<void> {
  if (applications.value.length > 0 || !loading.value) return;
  if (inFlightCatalog) return inFlightCatalog;
  return refreshCatalog();
}

/**
 * The applications this reader may open, as the rail shows them. The list and the error are those of the last read that
 * finished: while the catalog is read again (after a publication, a rollback, another navigation) both stay, so the rail
 * never empties and fills up again, and the new list replaces the old one whole. A read that fails reports its error and
 * keeps the list there was.
 */
export function useApplicationCatalog() {
  return {
    applications,
    details,
    mergedApplications,
    error,
    loading,
    applicationById,
    ensureApplication,
    refreshApplication,
    ensureCatalog,
    refresh: refreshCatalog,
  };
}

/**
 * First visible panel entry path of an application, ordered by its declared groups (named entries preferred).
 */
export function firstVisiblePanelPath(app: CatalogApplication): string | null {
  const uses = app.panelUses ?? [];
  if (uses.length === 0) return null;
  const ordered = app.groups?.length
    ? [
        ...[...app.groups].sort((left, right) => left.sort - right.sort).flatMap((group) =>
          uses.filter((use) => use.groupKey === group.key),
        ),
        ...uses.filter((use) => !use.groupKey || !app.groups!.some((group) => group.key === use.groupKey)),
      ]
    : uses;
  const first = ordered.find((use) => Boolean(use.names)) ?? ordered[0];
  return first ? panelUsePath(first.path) : null;
}

/**
 * The native built-in application whose declared address space (`entry.path`) holds `path`, longest prefix winning.
 * Used to locate which single application to load on demand when navigation summaries omit `panelUses`.
 */
export function builtinApplicationForPath(path: string): CatalogApplication | null {
  let match: CatalogApplication | null = null;
  for (const app of mergedApplications.value) {
    if (app.kind !== "native" || isPanelApplication(app)) continue;
    const prefix = app.entry.path;
    if (path !== prefix && (app.id === "application-gallery" || !path.startsWith(`${prefix}/`))) continue;
    if (!match || prefix.length > match.entry.path.length) match = app;
  }
  return match;
}

/**
 * The built-in application that declares a panel entry at this address and lets this reader open it, from already-loaded
 * single-application details (or pre-populated catalog entries); null when none does or before that application is loaded.
 */
export function panelEntryApplication(path: string): string | null {
  return mergedApplications.value.find((app) => !isPanelApplication(app)
    && (app.panelUses ?? []).some((use) => !isNativeApplicationEntry(use) && panelUsePath(use.path) === path))?.id ?? null;
}
