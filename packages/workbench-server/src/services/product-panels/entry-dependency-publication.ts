import {
  affectedEntryRootsSchema, type ApplicationEntryRootsChanged, type EntryDependency, type EntryDependencyChangeRequest, type EntryRoots,
  type ReadAffectedEntryRootsRequest,
} from "@ontomato/contracts/entry-dependencies";
import { isBuiltinProductId, isDomainComponentId } from "@ontomato/contracts/product-record-id";
import type { PoolClient } from "pg";
import { z } from "zod";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import { backendPost } from "../../utils/backend-client";
import { agentDependency, mergeDependencies } from "./entry-dependency-compiler";
import {
  readPanelDependencies, sameDependencies, type DependencyMap, type EntryDependencyPublication,
} from "./entry-dependency-store";
import { listObjectDetailPanelMappings } from "./object-detail";

const affectedRootsResponse = z.object({ success: z.literal(true), data: z.object({ entries: affectedEntryRootsSchema }) });
const publicationResponse = z.object({ success: z.literal(true) });

async function request(path: string, body: ReadAffectedEntryRootsRequest | EntryDependencyChangeRequest) {
  const response = await backendPost("entry-dependencies", config.dataQuery.baseUrl + path, body, {
    headers: { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken },
    retries: 1,
  });
  return JSON.parse(response.text);
}

async function submit(change: EntryDependencyChangeRequest) {
  if (!change.entries.length) return;
  publicationResponse.parse(await request("/permissions/service/entry-dependency-changes", change));
}

export async function readAffectedEntryRoots(domainId: string, panelIds: string[]) {
  const result = affectedRootsResponse.parse(await request("/platform/applications/service/affected-entry-roots", { domainId, panelIds }));
  return result.data.entries;
}

function grantableDependency({ objectType, objectKey }: EntryDependency) {
  if (objectType === "PANEL" || objectType === "PROJECTION") return !isBuiltinProductId(objectKey);
  if (objectType === "COMPONENT") return isDomainComponentId(objectKey);
  if (objectType === "AGENT") return !objectKey.startsWith("preset:");
  return true;
}

function mergeRoots(roots: EntryRoots, panels: DependencyMap) {
  const dependencies = roots.panelIds.map(id => {
    const list = panels.get(id);
    if (!list) throw new Error(`Missing saved entry dependencies for panel '${id}'`);
    return list;
  });
  return mergeDependencies(...dependencies, roots.agentIds.map(agentDependency)).filter(grantableDependency);
}

const detailRoots = (panel: string | null): EntryRoots => ({ panelIds: panel === null ? [] : [panel], agentIds: [] });
const detailEntryId = (className: string) => `object-detail:${className}`;

async function publish(client: PoolClient, domainId: string, { source, panels, detail }: EntryDependencyPublication,
  later: EntryDependencyPublication[]) {
  const panelIds = panels.map(panel => panel.panelId);
  const roots = [];
  if (panelIds.length) {
    for (const { entryId, roots: entryRoots } of await readAffectedEntryRoots(domainId, panelIds))
      roots.push({ entryId, before: entryRoots, after: entryRoots });
    const details = new Map((await listObjectDetailPanelMappings(domainId, client)).map(({ className, panelId }) => [className, panelId]));
    for (const queued of [...later].reverse()) {
      if (!queued.detail) continue;
      if (queued.detail.before === null) details.delete(queued.source.id);
      else details.set(queued.source.id, queued.detail.before);
    }
    for (const [className, panelId] of details) {
      if (panelIds.includes(panelId)) roots.push({ entryId: detailEntryId(className), before: detailRoots(panelId), after: detailRoots(panelId) });
    }
  }
  if (detail) roots.push({ entryId: detailEntryId(source.id), before: detailRoots(detail.before), after: detailRoots(detail.after) });

  const saved = await readPanelDependencies(client, domainId, [...new Set(roots.flatMap(({ before, after }) => [...before.panelIds, ...after.panelIds]))]);
  for (const queued of [...later].reverse()) {
    for (const { panelId, before } of queued.panels) saved.set(panelId, before);
  }
  const oldLists = new Map(saved);
  const newLists = new Map(saved);
  for (const { panelId, before, after } of panels) {
    oldLists.set(panelId, before);
    newLists.set(panelId, after);
  }
  const entries = roots.map(({ entryId, before, after }) => ({
    entryId, before: mergeRoots(before, oldLists), after: mergeRoots(after, newLists),
  })).filter(({ before, after }) => !sameDependencies(before, after));
  await submit({ domainId, source, entries });
}

export async function deliverEntryDependencyPublications(domainId: string) {
  while (await transaction(async client => {
    await lockProducts(client, { domainId });
    const outbox = t("product_publication_outbox");
    const { rows } = await client.query<{ dependency_sequence: string; dependency_change: EntryDependencyPublication }>(
      `SELECT dependency_sequence,dependency_change FROM ${outbox}
       WHERE domain_id=$1 AND dependency_change IS NOT NULL ORDER BY dependency_sequence`, [domainId],
    );
    const [next, ...later] = rows;
    if (!next) return false;
    await publish(client, domainId, next.dependency_change, later.map(row => row.dependency_change));
    await client.query(`DELETE FROM ${outbox} WHERE domain_id=$1 AND dependency_sequence=$2`, [domainId, next.dependency_sequence]);
    return later.length > 0;
  })) {
    // Each successful publication is committed before handling the next one.
  }
}

export async function publishApplicationEntryRoots({ domainId, actorId, entryId, before, after }: ApplicationEntryRootsChanged) {
  await transaction(async client => {
    await lockProducts(client, { domainId });
    const panels = await readPanelDependencies(client, domainId, [...new Set([...before.panelIds, ...after.panelIds])]);
    const next = mergeRoots(after, panels);
    // An unreferenced former root can be retired before this event is consumed.
    // The permission owner reconciles waiting proposals against the complete new list.
    const previous = mergeRoots({ ...before, panelIds: before.panelIds.filter(id => panels.has(id)) }, panels);
    await submit({
      domainId, source: { kind: "application", id: entryId, actorId },
      entries: [{ entryId, before: previous, after: next }],
    });
  });
}
