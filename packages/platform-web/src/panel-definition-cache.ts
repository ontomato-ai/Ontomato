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

export type MountProjectionBundle = Map<string, BundledPanelProjection>;

/** Ingests definition payloads while keeping the response's access decisions local to this mount. */
export function ingestBundledPanelProjections(
  bundled: Readonly<Record<string, BundledPanelProjection>> | undefined,
  scope: DefinitionCacheScope | null,
): MountProjectionBundle {
  const mountBundle = new Map(Object.entries(bundled ?? {}));
  for (const [projectionId, entry] of mountBundle) {
    if (entry.status === "ready") {
      setCachedProjection({
        projection: entry.projection,
        ...(entry.domainComponent && { domainComponent: entry.domainComponent }),
      }, scope);
    } else {
      invalidateCachedProjection(projectionId);
    }
  }
  return mountBundle;
}

/**
 * Reconciles cached panel and projection definitions against a fresh server snapshot:
 * - evicts any cached panel or projection whose revision differs from the snapshot;
 * - evicts any fixed projection whose member is reported `forbidden` for the current reader;
 * - returns a mount-local map of forbidden fixed projections (403) so re-mounted cached panels
 *   immediately report them unavailable without flashing cached definitions.
 */
export function reconcileDefinitionCacheWithSnapshot(
  panelCacheKey: string,
  panel: Pick<ProductPanel, "manifest"> | undefined,
  snapshot: PanelDefinitionSnapshot,
  scope?: DefinitionCacheScope | null,
): Map<string, Extract<BundledPanelProjection, { status: "unavailable" }>> {
  const forbidden = new Map<string, Extract<BundledPanelProjection, { status: "unavailable" }>>();
  const current = ensureScope();
  if (!current || (scope !== undefined && !sameScope(current, scope))) return forbidden;
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
  for (const [id, entry] of Object.entries(snapshot.unavailableProjections ?? {})) {
    invalidateCachedProjection(id);
    forbidden.set(id, entry);
  }
  if (inspectedPanel && snapshot.members) {
    for (const member of snapshot.members) {
      if (member.status !== "forbidden" || member.memberPath.length !== 1) continue;
      const declaration = inspectedPanel.manifest.members[member.memberPath[0]!.member];
      if (declaration && "projectionId" in declaration.target) {
        const projectionId = declaration.target.projectionId;
        projections.delete(projectionId);
        inFlightProjections.delete(projectionId);
        forbidden.set(projectionId, {
          status: "unavailable",
          httpStatus: 403,
          message: "Product use Grant required",
        });
      }
    }
  }
  return forbidden;
}

/** Refreshes the existing mount's access results against the latest snapshot. */
export function reconcileMountProjectionBundle(
  bundle: MountProjectionBundle | undefined,
  snapshot: PanelDefinitionSnapshot,
  unavailable: ReadonlyMap<string, Extract<BundledPanelProjection, { status: "unavailable" }>>,
): void {
  if (!bundle) return;
  for (const { id, revision } of snapshot.projections) {
    const entry = bundle.get(id);
    if (entry && (entry.status === "unavailable" || entry.projection.revision !== revision)) bundle.delete(id);
  }
  for (const [id, entry] of unavailable) bundle.set(id, entry);
}

export interface ReadCachedProjectionOptions {
  readonly mountBundle?: MountProjectionBundle;
  /** Require a grant from this mount or verify reader access with the server. */
  readonly verifyAccess?: boolean;
}

/**
 * Reads a projection render payload using the mount's bundled unavailable results, the revision-checked definition
 * cache, and in-flight request deduplication (cleared immediately on settlement; errors are never cached, and
 * `PanelMemberUnavailable` evicts any stale cached entry for the same auth/domain scope).
 */
export async function readCachedProjection(
  projectionId: string,
  fetchProjection: () => Promise<ProductProjectionRenderResponse>,
  options?: ReadCachedProjectionOptions,
): Promise<ProductProjectionRenderResponse> {
  const bundled = options?.mountBundle?.get(projectionId);
  if (bundled?.status === "unavailable") throw new PanelMemberUnavailable(bundled.httpStatus, bundled.message);

  if (!options?.verifyAccess || bundled?.status === "ready") {
    const cached = getCachedProjection(projectionId, options?.verifyAccess ? bundled?.projection.revision : undefined);
    if (cached) return cached;
  }

  const scope = ensureScope();
  const inFlight = scope ? inFlightProjections.get(projectionId) : undefined;
  if (inFlight) return inFlight;

  const request = fetchProjection().then(
    (result) => {
      setCachedProjection(result, scope);
      return result;
    },
    (error: unknown) => {
      if (error instanceof PanelMemberUnavailable && sameScope(ensureScope(), scope)) {
        projections.delete(projectionId);
      }
      throw error;
    },
  ).finally(() => {
    if (inFlightProjections.get(projectionId) === request) inFlightProjections.delete(projectionId);
  });
  if (scope) inFlightProjections.set(projectionId, request);
  return request;
}
