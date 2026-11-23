import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";

/*
 * A panel entry's menu count (panelisation lead, 2026-11-22): the read the entry declares, made as its page makes it, for
 * this entry and without a search. An owner's "empty" is 0; a refusal, a failure or an answer of another shape is not
 * known and shows nothing — never 0; an entry declaring nothing is not read.
 */

const request = vi.hoisted(() => vi.fn());
vi.mock("@ontomato/workbench-ui", () => ({ nodeApiRequest: request }));

let entryCount: typeof import("../entry-counts").entryCount;
let entryCountsChanged: typeof import("../entry-counts").entryCountsChanged;
beforeEach(async () => {
  vi.resetModules();
  ({ entryCount, entryCountsChanged } = await import("../entry-counts"));
});
afterEach(() => {
  request.mockReset();
});

const use = (id: string, count?: ApplicationPanelUse["count"]): ApplicationPanelUse => ({
  id, pageKey: id, panelId: `panel-${id}`, path: `/ontology/${id}`, access: { kind: "domain-member" }, ...count ? { count } : {},
});
const settle = () => new Promise((resolve) => setTimeout(resolve));

it("reads the declared member's datum for the entry, as its page does, and shows its total", async () => {
  request.mockResolvedValue(Response.json({ status: "ready", value: { rows: [], total: 63 } }));
  const functions = use("functions", { member: "list", data: "rows" });
  expect(entryCount("ontology", functions)).toBeNull();
  await settle();
  expect(entryCount("ontology", functions)).toBe(63);
  expect(request).toHaveBeenCalledTimes(1);
  const [path, init] = request.mock.calls[0]!;
  expect(path).toBe("/api/product-panels/read");
  expect(JSON.parse(init.body)).toEqual({
    source: { kind: "registered", applicationId: "ontology", useId: "functions" }, memberPath: [{ member: "list" }], dataName: "rows", inputs: {},
  });
});

it("counts a list answer's rows, and the owner's empty as 0", async () => {
  request.mockResolvedValueOnce(Response.json({ status: "ready", value: [{}, {}, {}] }));
  request.mockResolvedValueOnce(Response.json({ status: "empty" }));
  const catalog = use("relations", { member: "catalogue", data: "rows" });
  const none = use("empty", { member: "list", data: "rows" });
  entryCount("ontology", catalog);
  entryCount("ontology", none);
  await settle();
  expect(entryCount("ontology", catalog)).toBe(3);
  expect(entryCount("ontology", none)).toBe(0);
});

it("shows nothing — never 0 — for a refusal, an error, a failed read or an answer without a number", async () => {
  request.mockResolvedValueOnce(Response.json({ status: "forbidden" }));
  request.mockResolvedValueOnce(Response.json({ status: "error", message: "owner down" }));
  request.mockResolvedValueOnce(Response.json({ error: { message: "nope" } }, { status: 500 }));
  request.mockResolvedValueOnce(Response.json({ status: "ready", value: { rows: [] } }));
  const entries = ["a", "b", "c", "d"].map((id) => use(id, { member: "list", data: "rows" }));
  entries.forEach((entry) => entryCount("app", entry));
  await settle();
  expect(entries.map((entry) => entryCount("app", entry))).toEqual([null, null, null, null]);
});

it("reads nothing for an entry that declares no count, and reads the declared ones again after a write", async () => {
  request.mockResolvedValue(Response.json({ status: "ready", value: { rows: [], total: 18 } }));
  expect(entryCount("ontology", use("graph"))).toBeNull();
  const objects = use("objects", { member: "catalog", data: "rows" });
  entryCount("ontology", objects);
  await settle();
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValue(Response.json({ status: "ready", value: { rows: [], total: 19 } }));
  entryCountsChanged();
  // The number shown stays until the new one is read.
  expect(entryCount("ontology", objects)).toBe(18);
  await settle();
  expect(entryCount("ontology", objects)).toBe(19);
  expect(request).toHaveBeenCalledTimes(2);
});

it("limits concurrent count reads and coalesces refreshes while a read is in flight", async () => {
  const pending: Array<() => void> = [];
  let maxConcurrent = 0;
  let active = 0;
  request.mockImplementation(() => {
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    return new Promise<Response>((resolve) => {
      pending.push(() => {
        active -= 1;
        resolve(Response.json({ status: "ready", value: { items: [], total: 5 } }));
      });
    });
  });
  const entries = ["a", "b", "c", "d", "e", "f"].map((id) => use(id, { member: "list", data: "rows" }));
  entries.forEach((entry) => entryCount("ontology", entry));
  expect(request).toHaveBeenCalledTimes(4);
  expect(maxConcurrent).toBe(4);
  // Triggering a refresh while reads are still in flight queues one follow-up per in-flight entry and coalesces queued ones.
  entryCountsChanged();
  while (pending.length) {
    pending.shift()!();
    await settle();
  }
  expect(maxConcurrent).toBe(4);
  expect(entries.map((entry) => entryCount("ontology", entry))).toEqual([5, 5, 5, 5, 5, 5]);
  // 6 initial reads + 4 coalesced follow-ups for the 4 entries that were already in flight.
  expect(request).toHaveBeenCalledTimes(10);
});
