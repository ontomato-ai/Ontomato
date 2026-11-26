import { isDeepStrictEqual } from "node:util";
import {
  affectedEntryRootsSchema, type ApplicationEntryRootsChanged, type BoundPanelRoot, type EntryDependency, type EntryDependencyChangeRequest, type EntryRoots,
  type ReadAffectedEntryRootsRequest,
} from "@ontomato/contracts/entry-dependencies";
import { isBuiltinProductId, isDomainComponentId } from "@ontomato/contracts/product-record-id";
import type { PoolClient } from "pg";
import { z } from "zod";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { getPostgresPool, qualifiedTable as t } from "../../infrastructure/postgres";
import { transaction } from "../../infrastructure/postgres-transaction";
import { lockProducts } from "../../infrastructure/product-write-lock";
import { backendPost } from "../../utils/backend-client";
import { agentDependency, entryDependencyCompiler, mergeDependencies } from "./entry-dependency-compiler";
import {
  deleteBoundEntryDependencies, readBoundEntryDependencies, readPanelDependencies, sameDependencies,
  saveBoundEntryDependencies, type DependencyMap, type EntryDependencyPublication,
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

function unboundPanelIds({ panelIds, boundPanelRoot }: EntryRoots): string[] {
  if (!boundPanelRoot || boundPanelRoot.alsoUnbound) return panelIds;
  return panelIds.filter(id => id !== boundPanelRoot.panelId);
}

function sameBinding(root: BoundPanelRoot, stored: Pick<BoundPanelRoot, "panelId" | "inputs"> | undefined): boolean {
  return stored !== undefined && root.panelId === stored.panelId && isDeepStrictEqual(root.inputs, stored.inputs);
}

function mergeRoots(roots: EntryRoots, panels: DependencyMap, bound: EntryDependency[]) {
  const dependencies = unboundPanelIds(roots).map(id => {
    const list = panels.get(id);
    if (!list) throw new Error(`Missing saved entry dependencies for panel '${id}'`);
    return list;
  });
  return mergeDependencies(...dependencies, bound, roots.agentIds.map(agentDependency)).filter(grantableDependency);
}

const detailRoots = (panel: string | null): EntryRoots => ({ panelIds: panel === null ? [] : [panel], agentIds: [] });
const detailEntryId = (className: string) => `object-detail:${className}`;

async function publish(client: PoolClient, domainId: string, { source, panels, boundPanels = [], detail }: EntryDependencyPublication,
  sequence: string, later: EntryDependencyPublication[]) {
  const panelIds = panels.map(panel => panel.panelId);
  const affectedPanelIds = [...new Set([...panelIds, ...boundPanels.map(panel => panel.panelId)])];
  const roots = [];
  if (affectedPanelIds.length) {
    for (const { entryId, roots: entryRoots } of await readAffectedEntryRoots(domainId, affectedPanelIds))
      roots.push({ entryId, before: entryRoots, after: entryRoots });
  }
  if (panelIds.length) {
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

  const saved = await readPanelDependencies(client, domainId,
    [...new Set(roots.flatMap(({ before, after }) => [...unboundPanelIds(before), ...unboundPanelIds(after)]))]);
  for (const queued of [...later].reverse()) {
    for (const { panelId, before } of queued.panels) saved.set(panelId, before);
  }
  const oldLists = new Map(saved);
  const newLists = new Map(saved);
  for (const { panelId, before, after } of panels) {
    oldLists.set(panelId, before);
    newLists.set(panelId, after);
  }
  const bound = await readBoundEntryDependencies(client, domainId,
    roots.filter(({ after }) => after.boundPanelRoot).map(({ entryId }) => entryId));
  const compile = entryDependencyCompiler(client, domainId);
  const entries = [];
  for (const { entryId, before, after } of roots) {
    const root = after.boundPanelRoot;
    let oldBound: EntryDependency[] = [];
    let newBound: EntryDependency[] = [];
    if (root) {
      const current = bound.get(entryId);
      oldBound = current && sameBinding(root, current) ? current.dependencies : await compile(root.panelId, root.inputs);
      for (const queued of [...later].reverse()) {
        const change = queued.boundPanels?.find(item => item.entryId === entryId && sameBinding(root, item));
        if (change) oldBound = change.before;
      }
      const change = boundPanels.find(item => item.entryId === entryId && sameBinding(root, item));
      newBound = change ? change.after : oldBound;
      if (change) oldBound = change.before;
    }
    const previous = mergeRoots(before, oldLists, oldBound);
    const next = mergeRoots(after, newLists, newBound);
    if (!sameDependencies(previous, next)) entries.push({ entryId, before: previous, after: next });
  }
  await submit({ domainId, source: { kind: source.kind, actorId: source.actorId, sequence }, entries });
}

export async function deliverPendingEntryDependencyPublications() {
  const { rows } = await getPostgresPool().query<{ domain_id: string }>(
    `SELECT DISTINCT domain_id FROM ${t("product_publication_outbox")} WHERE dependency_change IS NOT NULL ORDER BY domain_id`,
  );
  const results = await Promise.allSettled(rows.map(({ domain_id }) => deliverEntryDependencyPublications(domain_id)));
  const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
  if (failures.length) throw new AggregateError(failures, "Could not deliver all entry dependency publications");
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
    await publish(client, domainId, next.dependency_change, next.dependency_sequence, later.map(row => row.dependency_change));
    await client.query(`DELETE FROM ${outbox} WHERE domain_id=$1 AND dependency_sequence=$2`, [domainId, next.dependency_sequence]);
    return later.length > 0;
  })) {
    // Each successful publication is committed before handling the next one.
  }
}

export async function publishApplicationEntryRoots({ domainId, actorId, entryId, sequence, before, after }: ApplicationEntryRootsChanged) {
  await transaction(async client => {
    await lockProducts(client, { domainId });
    const panels = await readPanelDependencies(client, domainId, [...new Set([...before.panelIds, ...after.panelIds])]);
    const compile = entryDependencyCompiler(client, domainId);
    const afterBound = after.boundPanelRoot;
    const beforeBound = before.boundPanelRoot;
    const nextBound = afterBound ? await compile(afterBound.panelId, afterBound.inputs) : [];
    const previousRead = beforeBound ? (await readBoundEntryDependencies(client, domainId, [entryId])).get(entryId) : undefined;
    // An unreferenced former root can be retired before this event is consumed.
    // The permission owner reconciles waiting proposals against the complete new list.
    let previousBound: EntryDependency[] = [];
    if (beforeBound) {
      if (previousRead && sameBinding(beforeBound, previousRead)) previousBound = previousRead.dependencies;
      else if (panels.has(beforeBound.panelId)) previousBound = await compile(beforeBound.panelId, beforeBound.inputs);
    }
    const previous = mergeRoots({ ...before, panelIds: before.panelIds.filter(id => panels.has(id)) }, panels, previousBound);
    const next = mergeRoots(after, panels, nextBound);
    if (afterBound) await saveBoundEntryDependencies(client, domainId, entryId, afterBound, nextBound);
    else if (beforeBound) await deleteBoundEntryDependencies(client, domainId, entryId);
    await submit({
      domainId, source: { kind: "application", sequence, actorId },
      entries: [{ entryId, before: previous, after: next }],
    });
  });
}
