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
  AGENT_DEFINITION,
  APPLICATION,
  FUNCTION,
  OBJECT_TYPE,
  ONTOLOGY_RELATION_KIND,
  ONTOLOGY_TYPE,
  ORG_GRANT,
  ORG_POSITION,
  ORG_UNIT,
  PERMISSION_POLICY,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  ROLE,
  SCHEDULED_TASK,
  SDK_COMPONENT,
  TRIGGER,
  USER,
} from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { listAgentDefinitions } from "../../assistant/definitions";
import { assistantSkillCatalog } from "../../assistant/skills";
import { listPublishedDefinitions } from "../../business-definitions/definitions";
import { readPanelComponentCatalogue } from "../../product-panels/component-catalogue";
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
vi.mock("../../product-panels/component-catalogue", () => ({
  readPanelComponentCatalogue: vi.fn(),
}));

const assertPermissionMock = vi.fn();
const owner = { domainId: "domain-1", userId: "user-1" };
const viewer = { token: "viewer-token-1", locale: "en" };

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: {
    en: { ...enLocaleMeta, messages: en },
    fr: {
      ...enLocaleMeta,
      messages: {
        "platformOntology.types.application": "Localized application type",
        "platformOntology.layers.product": "Localized product layer",
        "panels.platformOntology.dirApplications": "Localized application directory",
      },
    },
  },
});

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
    if (path === "/product-governance/resources") {
      return new Response(JSON.stringify({ ids: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (path === "/platform/governance/organization") {
      return jsonResponse({ units: [], positions: [], memberships: [], positionAssignments: [], grants: [] });
    }
    if (path === "/platform/governance/policies") {
      return jsonResponse({ policies: [] });
    }
    if (path === "/platform/governance/role-policies") {
      return jsonResponse({ rolePolicies: [] });
    }
    if (path === "/platform/governance/policy-data-permissions") {
      return jsonResponse({ policyDataPermissions: [] });
    }
    if (path === "/product-governance/domain-grants") {
      return new Response(JSON.stringify({ grants: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (
      path === "/metricView/queryList"
      || path === "/function/queryList"
      || path === "/workflow/query"
      || path === "/trigger/queryList"
      || path === "/admin/getBussinessKnowledge"
      || path === "/platform/applications"
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
  vi.mocked(readPanelComponentCatalogue).mockResolvedValue({
    version: "1.0.0",
    digest: "sha256:test",
    components: new Map(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPlatformOntologyReadAdapter", () => {
  it("serves schema, counts, start and neighbors conforming to contract result schemas", async () => {
    const { seenRequests } = stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer, "Alice");

    const schema = panelReadResultSchemas.panelGraphSchema.parse(await reads.schema());
    expect(schema.layers).toEqual(["fact", "capability", "governance", "product"]);
    expect(schema.objectTypes.some((item) => item.id === ACTION)).toBe(true);
    const agent = schema.objectTypes.find((item) => item.id === "platform:AgentDefinition");
    expect(agent?.definition).toBeTruthy();
    expect(agent?.properties?.length).toBeGreaterThan(0);
    expect(agent?.rules).toBeTruthy();
    expect(agent?.reads?.list?.result).toBe("panelRecordList");
    expect(agent?.operations?.some((op) => op.id === "platform:AgentDefinition.save")).toBe(true);

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
    expect(neighbors.edges.some((e) => e.relationKind === "user.holds-role" && e.to.primaryKey === "role-1")).toBe(true);
    expect(neighbors.neighbors).toContainEqual({
      className: ROLE,
      primaryKey: "role-1",
      label: "ops",
      layer: "governance",
    });
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

    const roles = panelReadResultSchemas.panelOntologyObjects.parse(
      await reads.objects({ type: ROLE }),
    );
    expect(roles.status).toBe("ok");
    expect(roles.items).toEqual([
      { node: { className: ROLE, primaryKey: "role-1" }, label: "ops" },
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

  it("keeps the graph, relations and object picker projections valid", () => {
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

describe("platform ontology catalogue reads", () => {
  it("lists declared four-layer types synchronously without fetching counts and serves distinct count statuses in countRows", async () => {
    const { seenRequests } = stubOwnerHttp({
      "/action/queryList": () => Response.json({ message: "No action permission" }, { status: 403 }),
      "/workflow/subjects": () => Response.json({ message: "Subjects unavailable" }, { status: 500 }),
    });
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    const rows = panelReadResultSchemas.panelRecordList.parse(reads.list());
    expect(seenRequests).toHaveLength(0);
    const row = (type: string) => rows.find(entry => entry.primaryKey === type)!;
    expect([...new Set(rows.map(entry => entry.fields.layerId))]).toEqual(["fact", "capability", "governance", "product"]);
    expect(row(OBJECT_TYPE)).toMatchObject({
      className: ONTOLOGY_TYPE, label: "Object type",
      fields: { typeId: OBJECT_TYPE, layer: "Fact", layerId: "fact" },
      fieldLabels: { typeId: "Type ID", layer: "Layer" },
    });
    expect(row(OBJECT_TYPE).fields).not.toHaveProperty("count");
    expect(row(OBJECT_TYPE).fields).not.toHaveProperty("countDisplay");
    expect(row(OBJECT_TYPE).fields).not.toHaveProperty("countStatus");

    const countRows = panelReadResultSchemas.panelRecordList.parse(await reads.countRows());
    expect(seenRequests.length).toBeGreaterThan(0);
    expect(countRows.map(entry => entry.primaryKey)).toEqual(rows.map(entry => entry.primaryKey));
    const countRow = (type: string) => countRows.find(entry => entry.primaryKey === type)!;
    expect(countRow(OBJECT_TYPE)).toMatchObject({
      className: ONTOLOGY_TYPE, label: "Object type",
      fields: { count: 2, countStatus: "ok", countDisplay: "2" },
      tones: { countStatus: "success", countStatusLabel: "success", countDisplay: "success" },
    });
    expect(countRow(FUNCTION).fields).toMatchObject({ count: 0, countStatus: "ok", countDisplay: "0" });
    for (const [type, status, tone] of [
      [ACTION, "refused", "warning"], [USER, "failed", "danger"], [SCHEDULED_TASK, "unavailable", "info"],
    ]) {
      const record = panelReadResultSchemas.panelRecord.parse(await reads.record(type));
      for (const fields of [countRow(type).fields, record.fields]) {
        expect(fields.countStatus).toBe(status);
        expect(fields.countDisplay).toBe(fields.countStatusLabel);
        expect(fields.countReason).toEqual(expect.any(String));
        expect(fields).not.toHaveProperty("count");
      }
      expect(record.tones?.countDisplay).toBe(tone);
      expect(countRow(type).tones?.countDisplay).toBe(tone);
    }
    expect(countRow(ACTION).fields.countStatusLabel).toBe("No permission");
  });

  it.each([
    [ORG_UNIT, "fact", "/permissions/organization", "Organization"],
    [ORG_POSITION, "fact", "/permissions/organization", "Organization"],
    [PERMISSION_POLICY, "governance", "/permissions/policies", "Permission policies"],
    [ORG_GRANT, "governance", "/permissions/organization", "Organization"],
    [SDK_COMPONENT, "product", "/ontology/components", "Components"],
    [PRODUCT_PROJECTION, "product", "/ontology/projections", "Projections"],
    [PRODUCT_PANEL, "product", "/ontology/panels", "Panels"],
    [APPLICATION, "product", "/ontology/applications", "Applications"],
    [AGENT_DEFINITION, "product", "/ontology/agents", "Agents"],
  ])("publishes scalar instance-directory outputs for %s", async (type, layerId, directoryPath, directoryName) => {
    stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    const record = panelReadResultSchemas.panelRecord.parse(await reads.record(type));
    expect(record).toMatchObject({
      primaryKey: type, className: ONTOLOGY_TYPE, outputs: { directoryPath, directoryName },
      fields: { typeId: type, layerId, directoryPath, directoryName },
    });
  });

  it("uses the reader's server locale for records and directory outputs", async () => {
    stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, { ...viewer, locale: "fr" });
    expect(await reads.record(APPLICATION)).toMatchObject({
      label: "Localized application type",
      fields: { layer: "Localized product layer", directoryName: "Localized application directory" },
      outputs: { directoryName: "Localized application directory" },
    });
  });

  it("returns detail from the type owner and signals a missing record", async () => {
    stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    const action = panelReadResultSchemas.panelRecord.parse(await reads.record(ACTION));
    expect(action).toMatchObject({ label: "Action", fields: { count: 3, countStatus: "ok" } });
    expect(action).not.toHaveProperty("outputs");
    const agent = panelReadResultSchemas.panelRecord.parse(await reads.record(AGENT_DEFINITION));
    expect(agent.fields).toMatchObject({
      definition: en["platformOntology.typeDetails.agentDefinition.definition"],
      rules: en["platformOntology.typeDetails.agentDefinition.rules"],
    });
    await expect(reads.record("platform:Unknown")).rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
  });

  it("explains when a type registers no definition or creation and use rules", async () => {
    stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    const component = panelReadResultSchemas.panelRecord.parse(await reads.record(SDK_COMPONENT));
    expect(component.fields).toMatchObject({
      definition: "This type registers no one-line definition.",
      rules: "This type declares no creation or use rule.",
    });
  });

  it("returns typed rows for public properties and registered read and operation signatures", async () => {
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    const properties = panelReadResultSchemas.panelRecordList.parse(reads.properties(AGENT_DEFINITION));
    expect(properties.find(row => row.primaryKey === "name")?.fields).toMatchObject({
      name: "name", type: "string", optional: false, description: expect.stringContaining("agent lists"),
    });
    const signatures = panelReadResultSchemas.panelRecordList.parse(await reads.reads(TRIGGER));
    expect(signatures.find(row => row.primaryKey === "query")?.fields).toMatchObject({
      name: "query", parameters: expect.arrayContaining(["search"]), result: "panelRecordQuery", source: "type",
    });
    const operations = panelReadResultSchemas.panelRecordList.parse(await reads.operations(AGENT_DEFINITION));
    const id = `${AGENT_DEFINITION}.save`;
    expect(operations.find(row => row.primaryKey === id)?.fields).toMatchObject({
      id, kind: "form.save", effect: "write", inputs: expect.arrayContaining(["values"]), batch: false,
    });
  });

  it("expands incoming and outgoing declarations and retains relation-kind identities and target unions", () => {
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    const relations = panelReadResultSchemas.panelRecordList.parse(reads.typeRelations(ACTION));
    expect(relations.map(row => row.fields)).toEqual(expect.arrayContaining([
      expect.objectContaining({ direction: "outgoing", relationKind: "action.uses-function", peer: FUNCTION, derived: false }),
      expect.objectContaining({ direction: "incoming", relationKind: "user.created-action", peer: USER, derived: false }),
      expect.objectContaining({ direction: "incoming", relationKind: "projection.binds-target", peer: PRODUCT_PROJECTION }),
    ]));
    const kinds = panelReadResultSchemas.panelRecordList.parse(reads.relationKinds());
    expect(kinds.find(row => row.primaryKey === "projection.binds-target")).toMatchObject({
      className: ONTOLOGY_RELATION_KIND,
      fields: {
        id: "projection.binds-target", from: PRODUCT_PROJECTION, to: expect.arrayContaining([ACTION, USER]),
        derived: false, owner: "node-product-panels",
      },
    });
  });
});
