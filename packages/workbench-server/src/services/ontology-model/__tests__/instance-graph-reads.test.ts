import { afterEach, expect, it, vi } from "vitest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { createInstanceGraphReadAdapter } from "../instance-graph-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } },
});
afterEach(() => { vi.unstubAllGlobals(); });

const viewer = { token: "viewer", locale: "en" };
const graph = createInstanceGraphReadAdapter(viewer);
const from = { className: "sales:Order", primaryKey: "a:1" };
const to = { className: "sales:Customer", primaryKey: "c1" };
const edge = { from, to, type: "placedBy" };
const order = { class: from.className, primaryKey: from.primaryKey, name: "Order", classLabel: "Orders" };
const customer = { class: to.className, primaryKey: to.primaryKey, name: "Customer", classLabel: "Customers" };
const group = { class: from.className, classLabel: "Orders", instanceCount: 20, sampleCount: 1 };

function javaReply(operation: string, data: unknown, request?: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: globalThis.RequestInit) => {
    expect(new URL(url).pathname).toBe(`/data/instanceGraph/${operation}`);
    expect(new Headers(init.headers).get("tk")).toBe(viewer.token);
    expect(init.body ? JSON.parse(String(init.body)) : undefined).toEqual(request);
    return Response.json({ success: true, status: "READY", data });
  }));
}

it("returns a sampled overview and joins the connections using the owner's version and sample", async () => {
  javaReply("nodes", {
    version: "v1", sampleToken: "sample", nodeCount: 20, edgeCount: null,
    relationTypes: ["placedBy"], classes: [group], overviewNodes: [order],
  });
  const overview = panelReadResultSchemas.panelGraphOverview.parse(await graph.overview());
  expect(overview).toMatchObject({
    status: "READY", version: "v1", sampleToken: "sample", nodeCount: 20,
    groups: [{ id: from.className, label: "Orders", totalCount: 20, sampleCount: 1 }],
    nodes: [{ ...from, label: "Order" }],
  });

  const { version, sampleToken } = overview;
  javaReply("connections", { version, overviewEdges: [edge], overviewEdgesTruncated: true }, { version, sampleToken });
  expect(panelReadResultSchemas.panelGraphConnections.parse(await graph.connections(version!, sampleToken))).toMatchObject({
    version, truncated: true, edges: [{ from, to, direction: "outgoing", relationKind: "placedBy" }],
  });
});

it("keeps graph totals and real instance identities across statistics, search and neighbor reads", async () => {
  javaReply("statistics", { classes: [group] });
  expect(panelReadResultSchemas.panelGraphCounts.parse(await graph.statistics())).toEqual({
    counts: [{ type: from.className, layer: "fact", status: "ok", count: 20 }],
  });

  javaReply("search", { nodes: [order], total: 65, hasMore: true }, { term: "order", class: from.className, version: "v1" });
  expect(panelReadResultSchemas.panelRecordQuery.parse(await graph.search("order", from.className, "v1"))).toMatchObject({
    total: 65, hasMore: true, rows: [{ ...from, label: "Order", fields: { ...from, classLabel: "Orders" } }],
  });

  javaReply("neighborhood", { nodes: [customer, order], edges: [edge], nextOffset: 4, total: null, version: "v2" }, {
    node: to, neighborClass: from.className, relationKinds: ["placedBy"], direction: "incoming", limit: 2, offset: 2,
  });
  const neighbors = await graph.neighbors(to, {
    targetClass: from.className, relationKinds: ["placedBy"], direction: "incoming", limit: 2, offset: 2,
  });
  expect(panelReadResultSchemas.panelGraphNeighbors.parse(neighbors)).toMatchObject({
    node: to, neighbors: [from], edges: [{ from, to, direction: "incoming" }],
    relations: [{ relationKind: "placedBy", edgeCount: 1 }], nextOffset: 4, total: null, version: "v2",
  });
});
