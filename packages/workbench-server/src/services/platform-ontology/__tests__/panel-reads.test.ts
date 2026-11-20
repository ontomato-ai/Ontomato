import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import {
  directProjectionPortsSchema,
  panelReadParameterSchemas,
  validateDirectProjection,
} from "@ontomato/contracts/panel-projection";
import {
  ACTION,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  USER,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { listAgentDefinitions } from "../../assistant/definitions";
import { assistantSkillCatalog } from "../../assistant/skills";
import { listPublishedDefinitions } from "../../business-definitions/definitions";
import { createPlatformOntologyReadAdapter } from "../panel-reads";

vi.mock("../../../config/application", () => ({
  config: {
    dataQuery: { baseUrl: "http://owner.test" },
  },
}));
vi.mock("../../assistant/definitions", () => ({
  listAgentDefinitions: vi.fn(),
}));
vi.mock("../../assistant/skills", () => ({
  assistantSkillCatalog: vi.fn(),
}));
vi.mock("../../business-definitions/definitions", () => ({
  listPublishedDefinitions: vi.fn(),
}));

const assertPermissionMock = vi.fn();
const owner = { domainId: "domain-1", userId: "user-1" };
const viewer = { token: "viewer-token-1", locale: "zh-CN" };

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubOwnerHttp(overrides: Partial<Record<string, () => Response>> = {}) {
  const seenRequests: Array<{ path: string; token: string | null }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url).pathname;
    const headers = new Headers(init?.headers);
    seenRequests.push({ path, token: headers.get("tk") });

    const override = overrides[path];
    if (override) return override();

    if (path === "/admin/getMetas") {
      return jsonResponse({
        classDef: [
          {
            className: "Order",
            showName: "Sales Order",
            classDesc: "Customer order record",
            attrs: [{ name: "id", showName: "Order ID" }],
          },
          {
            className: "Customer",
            showName: "Customer",
            classDesc: "",
            attrs: [{ name: "id", showName: "Customer ID" }],
          },
        ],
        relationship_rule: {
          PLACED_BY: { fromclass: "Order", toclass: "Customer", showName: "Placed By" },
        },
      });
    }
    if (path === "/action/queryList") {
      return jsonResponse([
        { id: "act-1", name: "Approve Order", status: "PUBLISHED", target: { className: "Order" }, createdBy: "user-1" },
        { id: "act-2", name: "Cancel Order", status: "DRAFT", target: { className: "Order" }, createdBy: "user-1" },
        { id: "act-3", name: "Archive Customer", status: "PUBLISHED", target: { className: "Customer" }, createdBy: "user-2" },
      ]);
    }
    if (path === "/workflow/subjects") {
      return jsonResponse([
        { id: "user-1", loginCode: "alice", displayName: "Alice", roleIds: ["role-1"] },
        { id: "user-2", loginCode: "bob", displayName: "Bob", roleIds: [] },
      ]);
    }
    if (path === "/workflow/grants") {
      return jsonResponse([{ roleId: "role-1", roleCode: "ops", capabilityKind: "ACTION", capabilityId: "act-1", inForce: true }]);
    }
    if (path === "/workflow/platform-access") {
      return jsonResponse([{ roleId: "role-1", roleCode: "ops", apiPermissions: ["workflow-design"], managementRole: false }]);
    }
    if (
      path === "/metricView/queryList"
      || path === "/function/queryList"
      || path === "/workflow/query"
      || path === "/trigger/queryList"
      || path === "/admin/getBussinessKnowledge"
    ) {
      return jsonResponse([]);
    }
    throw new Error(`Unexpected owner HTTP request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, seenRequests };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertPermissionMock.mockResolvedValue(undefined);
  installWorkbenchIdentity({
    assertPermission: assertPermissionMock,
  } as unknown as WorkbenchIdentity);

  vi.mocked(listPublishedDefinitions).mockResolvedValue([]);
  vi.mocked(assistantSkillCatalog).mockResolvedValue({ skills: [] });
  vi.mocked(listAgentDefinitions).mockResolvedValue({ agents: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPlatformOntologyReadAdapter", () => {
  it("serves schema, counts, start and neighbors conforming to contract result schemas", async () => {
    const { seenRequests } = stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer, "Alice");

    const schema = panelReadResultSchemas.panelGraphSchema.parse(reads.schema());
    expect(schema.layers).toEqual(["fact", "capability", "governance", "product"]);
    expect(schema.objectTypes.some((item) => item.id === ACTION)).toBe(true);

    const counts = panelReadResultSchemas.panelGraphCounts.parse(await reads.counts());
    expect(counts.counts.find((c) => c.type === OBJECT_TYPE)).toMatchObject({ status: "ok", count: 2 });
    expect(counts.counts.find((c) => c.type === ACTION)).toMatchObject({ status: "ok", count: 3 });

    const start = panelReadResultSchemas.panelGraphStart.parse(await reads.start());
    expect(start).toEqual({
      node: { className: USER, primaryKey: "user-1", label: "Alice", layer: "governance" },
    });

    const nodeParam = panelReadParameterSchemas.graphNode.parse({ className: USER, primaryKey: "user-1" });
    const relationKindsParam = panelReadParameterSchemas.relationKinds.parse(["user.holds-role", "user.created-action"]);
    const layersParam = panelReadParameterSchemas.layers.parse(["governance", "capability"]);

    const neighbors = panelReadResultSchemas.panelGraphNeighbors.parse(
      await reads.neighbors({
        node: nodeParam,
        relationKinds: relationKindsParam,
        layers: layersParam,
      }),
    );
    expect(neighbors.node).toMatchObject({ className: USER, primaryKey: "user-1", label: "Alice" });
    expect(neighbors.relations.map((r) => r.relationKind).sort()).toEqual(["user.created-action", "user.holds-role"]);
    expect(neighbors.edges.some((e) => e.relationKind === "user.holds-role" && e.to.primaryKey === "ops")).toBe(true);
    expect(neighbors.edges.some((e) => e.relationKind === "user.created-action" && e.to.primaryKey === "act-1")).toBe(true);
    expect(seenRequests.length).toBeGreaterThan(0);
    expect(seenRequests.every((req) => req.token === viewer.token)).toBe(true);
  });

  it("falls back to authenticated callerUserName for start when subject directory is refused", async () => {
    stubOwnerHttp({
      "/workflow/subjects": () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
    });
    const reads = createPlatformOntologyReadAdapter(owner, viewer, "Authenticated Admin");

    const start = panelReadResultSchemas.panelGraphStart.parse(await reads.start());
    expect(start).toEqual({
      node: {
        className: USER,
        primaryKey: "user-1",
        label: "Authenticated Admin",
        layer: "governance",
      },
    });
  });

  it("serves OntologyType.objects with search, page.{number,size} translation and per-type refusal status", async () => {
    stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer);

    const typeParam = panelReadParameterSchemas.ontologyType.parse(ACTION);
    const searchParam = panelReadParameterSchemas.keyword.parse("order");
    const pageParam = panelReadParameterSchemas.page.parse({ number: 2, size: 1 });

    const paged = panelReadResultSchemas.panelOntologyObjects.parse(
      await reads.objects({ type: typeParam, search: searchParam, page: pageParam }),
    );
    expect(paged).toMatchObject({
      type: ACTION,
      layer: "capability",
      status: "ok",
      total: 2,
      page: 2,
      pageSize: 1,
    });
    expect(paged.items).toEqual([
      {
        node: { className: ACTION, primaryKey: "act-2" },
        label: "Cancel Order",
        detail: "DRAFT",
      },
    ]);
    expect(() => reads.objects({ type: typeParam, keyword: "order" })).toThrow();

    const users = panelReadResultSchemas.panelOntologyObjects.parse(
      await reads.objects({ type: USER }),
    );
    expect(users.status).toBe("ok");
    expect(users.items.map((item) => item.node)).toEqual([
      { className: USER, primaryKey: "user-1" },
      { className: USER, primaryKey: "user-2" },
    ]);

    stubOwnerHttp({
      "/action/queryList": () => new Response(JSON.stringify({ message: "No action permission" }), { status: 403 }),
    });
    const refused = panelReadResultSchemas.panelOntologyObjects.parse(
      await createPlatformOntologyReadAdapter(owner, viewer).objects({ type: ACTION }),
    );
    expect(refused).toMatchObject({
      type: ACTION,
      status: "refused",
      items: [],
      total: 0,
    });
  });

  it("matches all five registered platform:OntologyType read declarations for graph and picker projections", () => {
    expect(Object.keys(platformObjectTypes[ONTOLOGY_TYPE]?.reads ?? {}).sort()).toEqual([
      "counts",
      "neighbors",
      "objects",
      "schema",
      "start",
    ]);

    const projectionSchema = directProjectionPortsSchema.superRefine(validateDirectProjection);
    const platformType = (id: string) => ({ kind: "PlatformObjectType" as const, id });
    const anyLayerObject: {
      kind: "object-union";
      layers: ["fact", "capability", "governance", "product"];
    } = { kind: "object-union", layers: ["fact", "capability", "governance", "product"] };

    const projections: Array<z.input<typeof directProjectionPortsSchema>> = [
      {
        componentId: "@ontomato/sdk:OntologyGraph",
        inputs: {
          mode: { kind: "scalar", type: "string" },
          start: anyLayerObject,
          selected: anyLayerObject,
          selectedType: { kind: "scalar", type: "string" },
          query: { kind: "scalar", type: "string" },
          node: anyLayerObject,
          layers: { kind: "json" },
          relationKinds: { kind: "json" },
        },
        outputs: {
          selectedNode: anyLayerObject,
          selectedType: { kind: "scalar", type: "string" },
        },
        data: {
          schema: { source: { type: platformType(ONTOLOGY_TYPE) }, read: "schema", params: {} },
          counts: { source: { type: platformType(ONTOLOGY_TYPE) }, read: "counts", params: {} },
          start: { source: { type: platformType(ONTOLOGY_TYPE) }, read: "start", params: {} },
          neighbors: {
            source: { type: platformType(ONTOLOGY_TYPE) },
            read: "neighbors",
            params: { node: { input: "node" }, layers: { input: "layers" }, relationKinds: { input: "relationKinds" } },
          },
        },
        config: { showLayerFilter: true, showLegend: true, showToolbar: true },
      },
      {
        componentId: "@ontomato/sdk:ObjectRelations",
        inputs: { selected: anyLayerObject },
        outputs: { selected: anyLayerObject },
        data: {
          neighbors: { source: { type: platformType(ONTOLOGY_TYPE) }, read: "neighbors", params: { node: { input: "selected" } } },
        },
        config: { emptyText: "capMap.relationsEmpty" },
      },
      {
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {
          type: { kind: "scalar", type: "string" },
        },
        outputs: { selected: anyLayerObject },
        data: {
          objects: {
            source: { type: platformType(ONTOLOGY_TYPE) },
            read: "objects",
            params: { type: { input: "type" } },
          },
        },
        config: {},
      },
      {
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {
          type: { kind: "scalar", type: "string" },
          search: { kind: "scalar", type: "string" },
          page: { kind: "json" },
        },
        outputs: { selected: { kind: "object", objectType: USER } },
        data: {
          objects: {
            source: { type: platformType(ONTOLOGY_TYPE) },
            read: "objects",
            params: { type: { input: "type" }, search: { input: "search" }, page: { input: "page" } },
          },
        },
        config: {},
      },
    ];

    for (const projection of projections) {
      expect(() => projectionSchema.parse(projection)).not.toThrow();
    }
  });
});
