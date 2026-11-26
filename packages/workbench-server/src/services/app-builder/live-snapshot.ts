import { z } from "zod";
import type { PoolClient } from "pg";
import {
  applicationPanelUsesManagementSchema, isBuiltinProductId,
  productPanelInputSchema, productProjectionInputSchema,
  type ProductPanelInput, type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { config } from "../../config/application";
import { findCurrentProducts } from "../../infrastructure/product-current";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { applicationCatalogueClient } from "../product-panels/application-catalogue";
import { HttpError } from "../../utils/errors";
import { appBuilderProjectStore, type OwnedResourceRef } from "./project-store";
import {
  applicationDirectPanelIds, panelDirectReferences,
  type ApplicationSourceManifest,
  type LivePanelApplicationSnapshot, type LivePanelResource, type LiveProjectionResource,
} from "./source-codec";

export interface ReadLiveSnapshotOptions {
  /**
   * When true, claims any currently unclaimed domain panels/projections referenced by this app
   * into `app_builder_owned_resources` so another app cannot claim or overwrite them.
   * Must be false during read-only inspection (Standard §4.3: reads never write).
   */
  claimUnclaimed?: boolean;
  ownedOnly?: boolean;
  client?: PoolClient;
}

export interface LiveSnapshotResult {
  snapshot: LivePanelApplicationSnapshot;
  /** Panels referenced by this app that belong to another application (excluded from this app's source & drift). */
  foreignPanelIds: string[];
  /** Projections referenced by this app that belong to another application (excluded from this app's source & drift). */
  foreignProjectionIds: string[];
  panelLabels: Map<string, string>;
  projectionLabels: Map<string, string>;
  applicationMeta: {
    source: "builtin" | "domain";
    canMaintain: boolean;
    canEditEntries: boolean;
    entryPath: string;
    entryHome?: string;
    renderer?: string;
  };
}

function backendOptions(credentials: AssistantCredentials) {
  return {
    headers: buildBackendHeaders(
      credentials.token,
      undefined,
      credentials.locale,
      credentials.apiKey,
      credentials.headers,
    ),
    retries: 1,
  };
}

function stripLegacyCommands(definition: unknown): unknown {
  if (
    definition &&
    typeof definition === "object" &&
    !Array.isArray(definition) &&
    "manifest" in definition &&
    definition.manifest &&
    typeof definition.manifest === "object" &&
    !Array.isArray(definition.manifest) &&
    "commands" in definition.manifest
  ) {
    const { commands: _removed, ...restManifest } = definition.manifest as Record<string, unknown>;
    return { ...definition, manifest: restManifest };
  }
  return definition;
}

/**
 * Loads the current authoritative definition of a published domain application from Java + Node,
 * strictly enforcing single-application ownership (`app_builder_owned_resources`):
 * - Built-in (`builtin-product-*`) panels/projections are never part of a domain app's source.
 * - Domain panels/projections already owned by ANOTHER application are excluded from this app's
 *   source, fingerprint, and drift detection (and this app does not walk into foreign panels'
 *   internal projections).
 */
export async function readLiveApplicationSnapshot(
  domainId: string,
  appId: string,
  credentials: AssistantCredentials,
  options: ReadLiveSnapshotOptions = {},
): Promise<LiveSnapshotResult> {
  const baseUrl = config.dataQuery.baseUrl;
  const opts = backendOptions(credentials);

  const record = await applicationCatalogueClient(credentials).record(appId);
  if (!record.canMaintain || record.source === "builtin") {
    throw new HttpError(403, "Application edit permission required", "PRODUCT_FORBIDDEN");
  }

  if (!record.canEditEntries) {
    throw new HttpError(403, "Application has no editable source", "FORBIDDEN");
  }

  const usesResp = await backendGet(
    "app-builder-panel-uses",
    `${baseUrl}/platform/applications/${encodeURIComponent(appId)}/panel-uses?purpose=management`,
    opts,
  );
  const { data: management } = z.object({
    success: z.literal(true),
    data: applicationPanelUsesManagementSchema,
  }).parse(JSON.parse(usesResp.text));
  const { applicationId: _id, entry, ...settings } = management;
  const manifest: ApplicationSourceManifest = {
    ...settings,
    entry: { ...entry, renderer: "panels" },
  };

  const visitedPanels = new Set<string>();
  const foreignPanelIds = new Set<string>();
  const ownedPanels = new Map<string, LivePanelResource>();
  const candidateProjectionIds = new Set<string>();
  const panelLabels = new Map<string, string>();
  const projectionLabels = new Map<string, string>();

  let frontier = applicationDirectPanelIds(manifest).filter(id => !isBuiltinProductId(id));

  while (frontier.length > 0) {
    const batch = frontier.filter(id => !visitedPanels.has(id));
    if (!batch.length) break;
    for (const id of batch) visitedPanels.add(id);

    const [owners, rows] = await Promise.all([
      appBuilderProjectStore.findResourceOwners(domainId, "panel", batch, options.client),
      findCurrentProducts(domainId, "panel", batch),
    ]);

    const nextPanels: string[] = [];
    for (const panelId of batch) {
      const ownerAppId = owners.get(panelId);
      if (ownerAppId && ownerAppId !== appId) {
        foreignPanelIds.add(panelId);
        continue;
      }
      if (!ownerAppId && options.ownedOnly) continue;
      const row = rows.get(panelId);
      if (!row || row.domainId === null) continue;
      const input: ProductPanelInput = productPanelInputSchema.parse(stripLegacyCommands(row.definition));
      ownedPanels.set(panelId, { id: panelId, revision: row.revision, input });
      panelLabels.set(panelId, input.name || panelId);

      const refs = panelDirectReferences(input);
      for (const childPanelId of refs.panelIds) {
        if (!isBuiltinProductId(childPanelId) && !visitedPanels.has(childPanelId)) {
          nextPanels.push(childPanelId);
        }
      }
      for (const projId of refs.projectionIds) {
        if (!isBuiltinProductId(projId)) candidateProjectionIds.add(projId);
      }
    }
    frontier = nextPanels;
  }

  for (const projId of manifest.delivery?.projections ?? []) {
    if (!isBuiltinProductId(projId)) candidateProjectionIds.add(projId);
  }

  const allCandidateProjIds = [...candidateProjectionIds].sort();
  const [projOwners, projRows] = allCandidateProjIds.length
    ? await Promise.all([
        appBuilderProjectStore.findResourceOwners(domainId, "projection", allCandidateProjIds, options.client),
        findCurrentProducts(domainId, "projection", allCandidateProjIds),
      ])
    : [new Map<string, string>(), new Map()];

  const foreignProjectionIds = new Set<string>();
  const ownedProjections = new Map<string, LiveProjectionResource>();
  for (const projId of allCandidateProjIds) {
    const ownerAppId = projOwners.get(projId);
    if (ownerAppId && ownerAppId !== appId) {
      foreignProjectionIds.add(projId);
      continue;
    }
    if (!ownerAppId && options.ownedOnly) continue;
    const row = projRows.get(projId);
    if (!row || row.domainId === null) continue;
    const input: ProductProjectionInput = productProjectionInputSchema.parse(row.definition);
    ownedProjections.set(projId, { id: projId, revision: row.revision, input });
    projectionLabels.set(projId, input.name || projId);
  }

  // On explicit materialization/sync, atomically claim unclaimed resources and filter out
  // any resource simultaneously claimed by another application.
  if (options.claimUnclaimed && (ownedPanels.size > 0 || ownedProjections.size > 0)) {
    const toClaim: OwnedResourceRef[] = [
      ...[...ownedPanels.keys()].map((resourceId): OwnedResourceRef => ({ kind: "panel", resourceId })),
      ...[...ownedProjections.keys()].map((resourceId): OwnedResourceRef => ({ kind: "projection", resourceId })),
    ];
    const effective = await appBuilderProjectStore.claimUnclaimedResources(domainId, appId, toClaim, options.client);
    for (const [panelId, ownerAppId] of effective.panels) {
      if (ownerAppId !== appId) {
        ownedPanels.delete(panelId);
        foreignPanelIds.add(panelId);
      }
    }
    for (const [projId, ownerAppId] of effective.projections) {
      if (ownerAppId !== appId) {
        ownedProjections.delete(projId);
        foreignProjectionIds.add(projId);
      }
    }
  }

  const snapshot: LivePanelApplicationSnapshot = {
    kind: "panel",
    appId,
    application: manifest,
    panels: [...ownedPanels.values()].sort((a, b) => a.id.localeCompare(b.id)),
    projections: [...ownedProjections.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };

  return {
    snapshot,
    foreignPanelIds: [...foreignPanelIds].sort(),
    foreignProjectionIds: [...foreignProjectionIds].sort(),
    panelLabels,
    projectionLabels,
    applicationMeta: {
      source: record.source,
      canMaintain: record.canMaintain,
      canEditEntries: record.canEditEntries,
      entryPath: record.entry.path,
      entryHome: record.entry.home,
      renderer: record.entry.renderer,
    },
  };
}
