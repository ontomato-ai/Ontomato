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
    overviewEdges: [], overviewEdgesTruncated: false,
  });
  const overview = panelReadResultSchemas.panelGraphOverview.parse(await graph.overview());
  expect(overview).toMatchObject({
    status: "READY", version: "v1", sampleToken: "sample", nodeCount: 20,
    groups: [{ id: from.className, label: "Orders", totalCount: 20, sampleCount: 1 }],
    nodes: [{ ...from, label: "Order" }],
  });
  expect(overview.edges).toBeUndefined();

  const { version, sampleToken } = overview;
  javaReply("connections", { version, overviewEdges: [edge], overviewEdgesTruncated: true }, { version, sampleToken });
  expect(panelReadResultSchemas.panelGraphConnections.parse(await graph.connections({ version, sampleToken }))).toMatchObject({
    version, truncated: true, edges: [{ from, to, direction: "outgoing", relationKind: "placedBy" }],
  });
});

it("keeps graph totals and real instance identities across statistics, search and neighbor reads", async () => {
  javaReply("statistics", { classes: [group] });
  expect(panelReadResultSchemas.panelGraphCounts.parse(await graph.statistics())).toEqual({
    counts: [{ type: from.className, layer: "fact", status: "ok", count: 20 }],
  });

  javaReply("search", { nodes: [order], total: 65, hasMore: true }, { term: "order", class: from.className, version: "v1" });
  expect(panelReadResultSchemas.panelRecordQuery.parse(await graph.search({ search: "order", className: from.className, version: "v1" }))).toMatchObject({
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

it("maps owner relation status codes to actionable localized reasons across neighbors and connections", async () => {
  javaReply("neighborhood", {
    nodes: [customer, order],
    edges: [edge],
    relations: [
      { relationKind: "placedBy", label: "Placed by", status: "ok", edgeCount: 1, truncated: false },
      { relationKind: "rel_r014", label: "Related task", status: "unavailable", edgeCount: 0, reasonCode: "RELATION_MISSING_JOIN_FIELDS" },
      { relationKind: "rel_graph", label: "Graph link", status: "unavailable", edgeCount: 0, reasonCode: "RELATION_GRAPH_TYPE_UNSUPPORTED" },
      { relationKind: "rel_cross", label: "Cross link", status: "unavailable", edgeCount: 0, reasonCode: "RELATION_CROSS_SOURCE_UNSUPPORTED" },
      { relationKind: "rel_secret", label: "Secret link", status: "refused", edgeCount: 0, reasonCode: "RELATION_FORBIDDEN" },
      { relationKind: "rel_broken", label: "Broken link", status: "failed", edgeCount: 0, reasonCode: "RELATION_READ_FAILED" },
    ],
    nextOffset: null,
    total: 1,
    version: "v3",
  }, { node: to });

  const neighbors = panelReadResultSchemas.panelGraphNeighbors.parse(await graph.neighbors(to, {}));
  expect(neighbors.relations).toEqual([
    { relationKind: "placedBy", label: "Placed by", status: "ok", edgeCount: 1, truncated: false },
    { relationKind: "rel_r014", label: "Related task", status: "unavailable", edgeCount: 0, reason: en["panels.objectDetail.relationMissingJoinFields"] },
    { relationKind: "rel_graph", label: "Graph link", status: "unavailable", edgeCount: 0, reason: en["panels.objectDetail.relationGraphTypeUnsupported"] },
    { relationKind: "rel_cross", label: "Cross link", status: "unavailable", edgeCount: 0, reason: en["panels.objectDetail.relationCrossSourceUnsupported"] },
    { relationKind: "rel_secret", label: "Secret link", status: "refused", edgeCount: 0, reason: en["panels.objectDetail.relationForbidden"] },
    { relationKind: "rel_broken", label: "Broken link", status: "failed", edgeCount: 0, reason: en["panels.objectDetail.relationReadFailed"] },
  ]);

  javaReply("connections", {
    version: "v3",
    overviewEdges: [edge],
    overviewEdgesTruncated: false,
    relations: [
      { relationKind: "placedBy", label: "Placed by", status: "ok", edgeCount: 1 },
      { relationKind: "rel_r014", label: "Related task", status: "unavailable", edgeCount: 0, reasonCode: "RELATION_MISSING_JOIN_FIELDS" },
    ],
  }, { version: "v3", sampleToken: "tok" });

  const connections = panelReadResultSchemas.panelGraphConnections.parse(await graph.connections({ version: "v3", sampleToken: "tok" }));
  expect(connections.relations).toEqual([
    { relationKind: "placedBy", label: "Placed by", status: "ok", edgeCount: 1 },
    { relationKind: "rel_r014", label: "Related task", status: "unavailable", edgeCount: 0, reason: en["panels.objectDetail.relationMissingJoinFields"] },
  ]);
});

it("replaces raw upstream error text with localized messages on graph failures", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({
      success: false,
      code: "INSTANCE_GRAPH_READ_FAILED",
      message: "DSL error at relationship[rel_r014]: raw technical message",
    }),
  ));
  await expect(graph.neighbors(to, {})).rejects.toMatchObject({
    status: 502,
    message: en["panels.objectDetail.graphReadFailed"],
  });

  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({
      success: false,
      code: "GRAPH_VERSION_CHANGED",
      message: "Ontology changed. Reload the overview.",
    }),
  ));
  await expect(graph.connections({ version: "old", sampleToken: "tok" })).rejects.toMatchObject({
    status: 409,
    message: en["panels.objectDetail.graphVersionChanged"],
  });
});

it("returns object type records with instanceCount for metaField pickers and empty list while generating", async () => {
  javaReply("nodes", {
    version: "v1", sampleToken: "sample", nodeCount: 20, edgeCount: 0,
    relationTypes: [], classes: [group], overviewNodes: [order],
    overviewEdges: [], overviewEdgesTruncated: false,
  });
  const rows = panelReadResultSchemas.panelRecordList.parse(await graph.classes());
  expect(rows).toEqual([
    {
      className: "platform:ObjectType",
      primaryKey: from.className,
      label: "Orders",
      fields: {
        className: from.className,
        classLabel: "Orders",
        instanceCount: 20,
        sampleCount: 1,
      },
      fieldLabels: {
        className: en["panels.objectDetail.className"],
        classLabel: en["panels.objectDetail.classLabel"],
        instanceCount: en["panels.objectDetail.instanceCount"],
        sampleCount: en["panels.objectDetail.sampleCount"],
      },
    },
  ]);

  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({ success: true, status: "GENERATING", data: null }),
  ));
  expect(await graph.classes()).toEqual([]);
});
