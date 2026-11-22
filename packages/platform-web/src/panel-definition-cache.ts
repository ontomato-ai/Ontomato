import type {
  BundledPanelProjection,
  ProductPanel,
  ProductProjectionRenderResponse,
} from "@ontomato/contracts/product-panels";
import type { PanelDefinitionSnapshot } from "@ontomato/contracts/product-subscriptions";
import { PanelMemberUnavailable } from "@ontomato/apps-sdk/direct";
import { authHost, type WorkbenchAuthHost } from "@ontomato/workbench-ui/utils/auth";

/*
 * Revision-checked client cache for registered panel and projection definitions.
 *
 * Only definitions (panel records and authorized projection render payloads) are cached here — never business data.
 * Entries are scoped to the active auth host, credential, user and domain: signing out, switching accounts or domains,
 * or installing a new auth host clears the cache immediately. Candidate previews never read or write this cache.
 */

export interface DefinitionCacheScope {
  readonly host: WorkbenchAuthHost;
  readonly key: string;
}

interface CachedPanelEntry {
  revision: number;
  panel: ProductPanel;
}

interface CachedProjectionEntry {
  revision: number;
  value: ProductProjectionRenderResponse;
}

let activeScope: DefinitionCacheScope | null = null;
const panels = new Map<string, CachedPanelEntry>();
const projections = new Map<string, CachedProjectionEntry>();
const inFlightProjections = new Map<string, Promise<ProductProjectionRenderResponse>>();

function sameScope(a: DefinitionCacheScope | null, b: DefinitionCacheScope | null): boolean {
  return a !== null && b !== null && a.host === b.host && a.key === b.key;
}

/** Captures the active reader's auth/domain identity, or `null` when no auth host is installed. */
export function currentDefinitionCacheScope(): DefinitionCacheScope | null {
  let host: WorkbenchAuthHost;
  try {
    host = authHost();
  } catch {
    return null;
  }
  const user = host.getUserInfo();
  const key = JSON.stringify([
    host.getToken() ?? "",
    host.getApiKey() ?? "",
    user?.userId ?? "",
    user?.loginCode ?? "",
    user?.domainId ?? "",
  ]);
  return { host, key };
}

/** Ensures the cache belongs to the current auth/domain scope, clearing all entries if the scope changed. */
function ensureScope(): DefinitionCacheScope | null {
  const scope = currentDefinitionCacheScope();
  if (!sameScope(activeScope, scope)) {
    panels.clear();
    projections.clear();
    inFlightProjections.clear();
    activeScope = scope;
  }
  return scope;
}

/** Cache key for an application frame panel, isolated per application so frame access never crosses apps. */
export function framePanelCacheKey(applicationId: string, framePanelId: string): string {
  return `frame:${applicationId}:${framePanelId}`;
}

/** Clears every cached definition and in-flight lookup. */
export function clearPanelDefinitionCache(): void {
  activeScope = null;
  panels.clear();
  projections.clear();
  inFlightProjections.clear();
}

export function getCachedPanel(cacheKey: string): ProductPanel | undefined {
  if (!ensureScope()) return undefined;
  return panels.get(cacheKey)?.panel;
}

export function setCachedPanel(cacheKey: string, panel: ProductPanel, scope?: DefinitionCacheScope | null): void {
  const current = ensureScope();
  if (!current || (scope !== undefined && !sameScope(current, scope))) return;
  const existing = panels.get(cacheKey);
  if (existing && existing.revision > panel.revision) return;
  panels.set(cacheKey, { revision: panel.revision, panel });
}

export function invalidateCachedPanel(cacheKey: string, minRevision?: number): void {
  if (!ensureScope()) return;
  const existing = panels.get(cacheKey);
  if (!existing) return;
  if (minRevision === undefined || existing.revision < minRevision) panels.delete(cacheKey);
}

/** Invalidates every cached panel entry matching `panelId` (both direct content entries and any frame entries). */
export function invalidateCachedPanelById(panelId: string, minRevision?: number): void {
  if (!ensureScope()) return;
  for (const [key, entry] of panels) {
    if (entry.panel.id !== panelId) continue;
    if (minRevision === undefined || entry.revision < minRevision) panels.delete(key);
  }
}

export function getCachedProjection(projectionId: string, revision?: number): ProductProjectionRenderResponse | undefined {
  if (!ensureScope()) return undefined;
  const existing = projections.get(projectionId);
  if (!existing) return undefined;
  if (revision !== undefined && existing.revision !== revision) return undefined;
  return existing.value;
}

export function setCachedProjection(entry: ProductProjectionRenderResponse, scope?: DefinitionCacheScope | null): void {
  const current = ensureScope();
  if (!current || (scope !== undefined && !sameScope(current, scope))) return;
  const { id, revision } = entry.projection;
  const existing = projections.get(id);
  if (existing && existing.revision > revision) return;
  projections.set(id, { revision, value: entry });
}

export function invalidateCachedProjection(projectionId: string, minRevision?: number): void {
  if (!ensureScope()) return;
  const existing = projections.get(projectionId);
  if (!existing || minRevision === undefined || existing.revision < minRevision) {
    projections.delete(projectionId);
    inFlightProjections.delete(projectionId);
  }
}

/**
 * Stores ready projections from a bundled panel response in the shared cache, and returns a mount-local map of
 * unavailable (403/404) entries so they are isolated to this mount and never cached across re-entries.
 */
export function ingestBundledPanelProjections(
  bundled: Readonly<Record<string, BundledPanelProjection>> | undefined,
  scope: DefinitionCacheScope | null,
): Map<string, Extract<BundledPanelProjection, { status: "unavailable" }>> {
  const unavailable = new Map<string, Extract<BundledPanelProjection, { status: "unavailable" }>>();
  if (!bundled) return unavailable;
  for (const [projectionId, entry] of Object.entries(bundled)) {
    if (entry.status === "ready") {
      setCachedProjection({
        projection: entry.projection,
        ...(entry.domainComponent && { domainComponent: entry.domainComponent }),
      }, scope);
    } else {
      invalidateCachedProjection(projectionId);
      unavailable.set(projectionId, entry);
    }
  }
  return unavailable;
}

/**
 * Reconciles cached panel and projection definitions against a fresh server snapshot:
 * - evicts any cached panel or projection whose revision differs from the snapshot;
 * - evicts any fixed projection whose member is reported `forbidden` for the current reader.
 */
export function reconcileDefinitionCacheWithSnapshot(
  panelCacheKey: string,
  panel: ProductPanel | undefined,
  snapshot: PanelDefinitionSnapshot,
  scope?: DefinitionCacheScope | null,
): void {
  const current = ensureScope();
  if (!current || (scope !== undefined && !sameScope(current, scope))) return;
  const cachedPanel = panels.get(panelCacheKey);
  const inspectedPanel = panel ?? cachedPanel?.panel;
  if (cachedPanel && cachedPanel.revision !== snapshot.panel.revision) {
    panels.delete(panelCacheKey);
  }
  for (const { id, revision } of snapshot.projections) {
    const cached = projections.get(id);
    if (cached && cached.revision !== revision) {
      projections.delete(id);
      inFlightProjections.delete(id);
    }
  }
  if (inspectedPanel && snapshot.members) {
    for (const member of snapshot.members) {
      if (member.status !== "forbidden" || member.memberPath.length !== 1) continue;
      const declaration = inspectedPanel.manifest.members[member.memberPath[0]!.member];
      if (declaration && "projectionId" in declaration.target) {
        projections.delete(declaration.target.projectionId);
        inFlightProjections.delete(declaration.target.projectionId);
      }
    }
  }
}

/**
 * Reads a projection render payload using the mount's bundled unavailable results, the revision-checked definition
 * cache, and in-flight request deduplication (cleared immediately on settlement; errors are never cached).
 */
export async function readCachedProjection(
  projectionId: string,
  fetchProjection: () => Promise<ProductProjectionRenderResponse>,
  mountUnavailable?: Map<string, Extract<BundledPanelProjection, { status: "unavailable" }>>,
): Promise<ProductProjectionRenderResponse> {
  const denied = mountUnavailable?.get(projectionId);
  if (denied) throw new PanelMemberUnavailable(denied.httpStatus, denied.message);

  const cached = getCachedProjection(projectionId);
  if (cached) return cached;

  const scope = ensureScope();
  const inFlight = scope ? inFlightProjections.get(projectionId) : undefined;
  if (inFlight) return inFlight;

  const request = fetchProjection().then((result) => {
    setCachedProjection(result, scope);
    return result;
  }).finally(() => {
    if (inFlightProjections.get(projectionId) === request) inFlightProjections.delete(projectionId);
  });
  if (scope) inFlightProjections.set(projectionId, request);
  return request;
}
