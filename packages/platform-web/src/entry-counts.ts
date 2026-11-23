import { reactive } from "vue";
import { productPanelReadResponseSchema } from "@ontomato/contracts/panel-host";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { nodeApiRequest } from "@ontomato/workbench-ui";

/*
 * The number a panel entry's menu row shows (panelisation lead, 2026-11-22): the entry declares it (`count: {member,
 * data}`) as one of its content panel's reads, and the platform reads that very read — the one the page itself makes,
 * for this entry, without the page's own search — so the menu and the page never count the same thing two ways. A count
 * the reader cannot be given is not shown: a read refused, failed or of another shape is "not known", never 0; only the
 * owner answering "empty" is 0. Nothing is counted for an entry that declares no count.
 */

/** What each declaring entry's read gave in this page load, by `applicationId/useId`: absent until read, null when not known. */
const values = reactive(new Map<string, number | null>());
/** The entries whose reads this page load has asked for, with what they declare. */
const asked = new Map<string, { applicationId: string; use: ApplicationPanelUse }>();
/** Limit concurrent menu count reads so the sidebar never saturates connections ahead of the open page's own reads. */
const MAX_CONCURRENT = 4;
const inFlight = new Set<string>();
const queued = new Set<string>();
const queue: string[] = [];
const pendingRefresh = new Set<string>();

const keyOf = (applicationId: string, use: ApplicationPanelUse) => `${applicationId}/${use.id}`;

async function read(applicationId: string, use: ApplicationPanelUse): Promise<number | null> {
  const { member, data } = use.count!;
  const response = await nodeApiRequest("/api/product-panels/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: { kind: "registered", applicationId, useId: use.id }, memberPath: [{ member }], dataName: data, inputs: {} }),
  });
  if (!response.ok) return null;
  const answer = productPanelReadResponseSchema.parse(await response.json());
  if (answer.status === "empty") return 0;
  if (answer.status !== "ready") return null;
  const value = answer.value as unknown;
  if (Array.isArray(value)) return value.length;
  const total = (value as { total?: unknown } | null)?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

function drain() {
  while (inFlight.size < MAX_CONCURRENT && queue.length > 0) {
    const key = queue.shift()!;
    queued.delete(key);
    const entry = asked.get(key);
    if (!entry) continue;
    inFlight.add(key);
    void read(entry.applicationId, entry.use)
      .then((count) => values.set(key, count), () => values.set(key, null))
      .finally(() => {
        inFlight.delete(key);
        if (pendingRefresh.delete(key)) schedule(key);
        drain();
      });
  }
}

function schedule(key: string) {
  if (inFlight.has(key)) {
    pendingRefresh.add(key);
    return;
  }
  if (queued.has(key)) return;
  queued.add(key);
  queue.push(key);
  drain();
}

/** The count an entry's menu row shows now, read once per page load; null while unknown or for an entry declaring none. */
export function entryCount(applicationId: string, use: ApplicationPanelUse): number | null {
  if (!use.count) return null;
  const key = keyOf(applicationId, use);
  if (!asked.has(key)) {
    asked.set(key, { applicationId, use });
    schedule(key);
  }
  return values.get(key) ?? null;
}

/** A page's write changed objects its owner names: every declared count is read again, the shown numbers kept meanwhile. */
export function entryCountsChanged() {
  for (const key of asked.keys()) schedule(key);
}
