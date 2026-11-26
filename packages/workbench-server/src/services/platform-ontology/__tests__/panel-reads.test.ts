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
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { countVisibleAgentDefinitions } from "../../assistant/definitions";
import { listAgentDefinitionNodes } from "../../assistant/definition-relations";
import { assistantSkillCatalog, countAssistantSkills } from "../../assistant/skills";
import { countPublishedDefinitions, listPublishedDefinitions } from "../../business-definitions/definitions";
import { countUsableCurrentDefinitions } from "../../product-panels/access";
import { readPanelComponentCatalogue } from "../../product-panels/component-catalogue";
import { createPlatformOntologyReadAdapter } from "../panel-reads";

vi.mock("../../../config/application", () => ({
  config: {
    dataQuery: { baseUrl: "http://owner.test" },
  },
}));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ queryServiceToken: "service-token-1" }) },
}));
vi.mock("../../assistant/definitions", () => ({ countVisibleAgentDefinitions: vi.fn() }));
vi.mock("../../assistant/definition-relations", () => ({
  listAgentDefinitionNodes: vi.fn(), listAgentExecutionUserRelations: async () => [], listAgentSkillRelations: async () => [],
}));
vi.mock("../../assistant/skills", () => ({
  assistantSkillCatalog: vi.fn(),
  countAssistantSkills: vi.fn(),
}));
vi.mock("../../business-definitions/definitions", () => ({
  countPublishedDefinitions: vi.fn(),
  listPublishedDefinitions: vi.fn(),
}));
vi.mock("../../product-panels/access", async original => ({
  ...await original<typeof import("../../product-panels/access")>(),
  countUsableCurrentDefinitions: vi.fn(),
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
    "zh-CN": {
      ...enLocaleMeta,
      messages: {
        ...en,
        "platformOntology.types.metricView": "指标视图",
        "platformOntology.types.action": "动作",
        "platformOntology.types.function": "函数",
        "platformOntology.relations.metric-view.uses-function": "使用函数",
        "platformOntology.relations.action.uses-function": "使用函数",
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
    const { pathname: path, searchParams } = new URL(url);
    const countOnly = searchParams.get("countOnly") === "true"
      || (typeof init?.body === "string" && JSON.parse(init.body).countOnly === true);
    const headers = new Headers(init?.headers);
    seenRequests.push({ path, token: headers.get("tk") });

    const override = overrides[path];
    if (override) return override();

    if (countOnly) {
      if (path === "/admin/getMetas") return jsonResponse({ objectTypes: 2, attributes: 2, relationships: 1 });
      if (path === "/platform/governance/organization") return jsonResponse({ units: 0, positions: 0, grants: 0 });
      if (path === "/workflow/grants") return jsonResponse({ total: 1, outsideDirectory: 0 });
      return jsonResponse({ total: path === "/action/queryList" ? 3 : 0 });
    }

    if (path === "/internal/workbench-management/require") return jsonResponse({});
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
    if (path === "/authorization/policies/graph-facts") {
      return new Response(JSON.stringify({
        policyGrants: [
          { policyId: "pol-1", targetKind: "ACTION", targetKey: "act-1", verb: "EXECUTE", scope: { kind: "all" } },
          { policyId: "pol-2", targetKind: "ACTION", targetKey: "act-1", verb: "EXECUTE", scope: { kind: "all" } },
        ],
        rolePolicies: [],
        domainPolicyId: "default",
        entries: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
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
  vi.mocked(listAgentDefinitionNodes).mockResolvedValue([]);
  vi.mocked(countPublishedDefinitions).mockResolvedValue(0);
  vi.mocked(countAssistantSkills).mockResolvedValue(0);
  vi.mocked(countVisibleAgentDefinitions).mockResolvedValue(0);
  vi.mocked(countUsableCurrentDefinitions).mockResolvedValue(0);
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
  it("serves counts, start and neighbors conforming to contract result schemas", async () => {
    const { seenRequests } = stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer, "Alice");

    const counts = panelReadResultSchemas.panelGraphCounts.parse(await reads.counts());
    expect(counts.counts.find((c) => c.type === OBJECT_TYPE)).toMatchObject({ status: "ok", count: 2 });
    expect(counts.counts.find((c) => c.type === ACTION)).toMatchObject({ status: "ok", count: 3 });

    const start = panelReadResultSchemas.panelGraphStart.parse(await reads.start());
    expect(start).toEqual({
      node: { className: USER, primaryKey: "user-1", label: "Alice", layer: "governance" },
    });

    const nodeParam = panelReadParameterSchemas.graphNode.parse({ className: USER, primaryKey: "user-1" });
    const relationKindsParam = panelReadParameterSchemas.relationKinds.parse(["user.holds-role"]);
    const layersParam = panelReadParameterSchemas.layers.parse(["governance", "capability"]);

    const neighbors = panelReadResultSchemas.panelGraphNeighbors.parse(
      await reads.neighbors({
        node: nodeParam,
        relationKinds: relationKindsParam,
        layers: layersParam,
      }),
    );
    expect(neighbors.node).toMatchObject({ className: USER, primaryKey: "user-1", label: "Alice" });
    expect(neighbors.relations.map((r) => r.relationKind).sort()).toEqual(["user.holds-role"]);
    expect(neighbors.edges.some((e) => e.relationKind === "user.holds-role" && e.to.primaryKey === "role-1")).toBe(true);
    expect(neighbors.neighbors).toContainEqual({
      className: ROLE,
      primaryKey: "role-1",
      label: "ops",
      layer: "governance",
    });
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

  it("keeps the graph, relations and object picker projections valid", () => {
    const projectionSchema = directProjectionPortsSchema.superRefine(validateDirectProjection);
    const platformType = (id: string) => ({ kind: "PlatformObjectType" as const, id });
    const anyLayerObject: {
      kind: "object-union";
      layers: ["fact", "capability", "governance", "product"];
    } = { kind: "object-union", layers: ["fact", "capability", "governance", "product"] };

    const projections: Array<z.input<typeof directProjectionPortsSchema>> = [
      {
        componentId: "@ontomato/sdk:InstanceGraph",
        inputs: {
          mode: { kind: "scalar", type: "string" },
          start: anyLayerObject,
          selected: anyLayerObject,
          query: { kind: "scalar", type: "string" },
          node: anyLayerObject,
          layers: { kind: "json" },
          relationKinds: { kind: "json" },
        },
        outputs: {
          selectedNode: anyLayerObject,
        },
        data: {
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
          rows: {
            source: { type: platformType(ONTOLOGY_TYPE) },
            read: "instances",
            params: { className: { input: "type" } },
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
          rows: {
            source: { type: platformType(ONTOLOGY_TYPE) },
            read: "instances",
            params: { className: { input: "type" }, search: { input: "search" }, page: { input: "page" } },
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
    const nameProp = properties.find(row => row.primaryKey === "name");
    expect(nameProp?.fields).toMatchObject({
      name: "name", type: "string", optional: false, description: expect.stringContaining("agent lists"),
    });
    expect(nameProp?.tones).toEqual({ optional: "warning" });
    const optionalProp = properties.find(row => row.fields.optional === true);
    if (optionalProp) expect(optionalProp.tones).toEqual({ optional: "info" });
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
      expect.objectContaining({
        direction: "incoming", relationKind: "permission-policy.can-execute-action", peer: PERMISSION_POLICY, derived: false,
      }),
      expect.objectContaining({ direction: "incoming", relationKind: "trigger.targets-action", peer: TRIGGER, derived: false }),
    ]));
    expect(relations.find(row => row.fields.relationKind === "action.uses-function")?.tones).toEqual({
      direction: "info",
      derived: "success",
    });
    expect(relations.find(row => row.fields.relationKind === "permission-policy.can-execute-action")?.tones).toEqual({
      direction: "default",
      derived: "success",
    });
    const kinds = panelReadResultSchemas.panelRecordList.parse(reads.relationKinds());
    expect(kinds.find(row => row.primaryKey === "projection.binds-target")).toMatchObject({
      className: ONTOLOGY_RELATION_KIND,
      fields: {
        id: "projection.binds-target", from: PRODUCT_PROJECTION, to: expect.arrayContaining([ACTION, USER]),
        derived: false, owner: "node-product-panels",
      },
    });
  });

  it("provides distinguishable owner relation labels and endpoint metadata in the relation catalogue", async () => {
    stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer);

    const kinds = panelReadResultSchemas.panelRecordList.parse(reads.relationKinds());
    const labels = kinds.map((row) => row.label);
    expect(new Set(labels).size).toBe(labels.length);

    const metricUsesFn = kinds.find((row) => row.primaryKey === "metric-view.uses-function");
    const actionUsesFn = kinds.find((row) => row.primaryKey === "action.uses-function");
    expect(metricUsesFn).toMatchObject({
      label: "Metric view uses function",
      subtitle: "Metric view → Function",
      fields: { fromLabel: "Metric view", toLabel: "Function", endpoints: "Metric view → Function" },
    });
    expect(actionUsesFn).toMatchObject({
      label: "Action uses function",
      subtitle: "Action → Function",
      fields: { fromLabel: "Action", toLabel: "Function", endpoints: "Action → Function" },
    });


    // Locales with colliding base translations are automatically disambiguated by source type label.
    const dupReads = createPlatformOntologyReadAdapter(owner, { token: "viewer-token-1", locale: "zh-CN" });
    const dupKinds = panelReadResultSchemas.panelRecordList.parse(dupReads.relationKinds());
    expect(dupKinds.find((row) => row.primaryKey === "metric-view.uses-function")).toMatchObject({
      label: "指标视图 · 使用函数",
      subtitle: "指标视图 → 函数",
    });
    expect(dupKinds.find((row) => row.primaryKey === "action.uses-function")).toMatchObject({
      label: "动作 · 使用函数",
      subtitle: "动作 → 函数",
    });
  });

  it("supports cross-type readable search via wildcard type while preserving per-owner access boundaries", async () => {
    const { seenRequests } = stubOwnerHttp({
      "/workflow/query": () => jsonResponse({ message: "Workflow forbidden" }, 403),
    });
    const reads = createPlatformOntologyReadAdapter(owner, viewer);

    // Blank cross-type search short-circuits without hitting owners.
    const empty = panelReadResultSchemas.panelRecordQuery.parse(await reads.instanceSearch({ search: "   " }));
    expect(empty.rows).toEqual([]);
    expect(empty.total).toBe(0);
    expect(seenRequests).toHaveLength(0);

    // Non-empty keyword matches across readable types by name and description, skipping refused owners.
    const byName = panelReadResultSchemas.panelRecordQuery.parse(await reads.instanceSearch({ search: "Order" }));
    expect(byName.rows.map((item) => `${item.className}:${item.primaryKey}`)).toEqual(
      expect.arrayContaining([
        `${OBJECT_TYPE}:Order`,
        `${ACTION}:act-1`,
        `${ACTION}:act-2`,
      ]),
    );
    expect(byName.rows.find((item) => item.className === ACTION && item.primaryKey === "act-1")?.fields.detail)
      .toContain("Action");

    // Description match finds Order via its classDesc ("Customer order record").
    const byDescription = panelReadResultSchemas.panelRecordQuery.parse(
      await reads.instanceSearch({ search: "Customer order record" }),
    );
    expect(byDescription.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: OBJECT_TYPE, primaryKey: "Order",
          label: "Sales Order",
        }),
      ]),
    );
  });

  it("keeps counts and graph labels distinct for readable, refused, failed and unavailable owners", async () => {
    stubOwnerHttp({
      "/action/queryList": () => jsonResponse({}, 403),
      "/workflow/subjects": () => jsonResponse({}, 500),
    });
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    const classes = panelReadResultSchemas.panelRecordList.parse(await reads.instanceGraphClasses());
    const nodes = panelReadResultSchemas.panelRecordList.parse(await reads.graphNodes());
    for (const rows of [classes, nodes]) {
      const row = (type: string) => rows.find(entry => entry.primaryKey === type)!;
      expect(row(OBJECT_TYPE).fields).toMatchObject({ countDisplay: "2", countStatus: "ok", layerId: "fact" });
      expect(row(FUNCTION).fields).toMatchObject({ countDisplay: "0", countStatus: "ok" });
      for (const [type, status] of [[ACTION, "refused"], [USER, "failed"], [SCHEDULED_TASK, "unavailable"]]) {
        expect(row(type).fields.countStatus).toBe(status);
        expect(row(type).fields).not.toHaveProperty("count");
        expect(row(type).fields.countDisplay).toMatch(/^\D+$/);
      }
    }
    for (const node of nodes) expect(node.label).toContain(node.fields.countDisplay);
  });

  it("uses the same edge identities in the canvas, incident relations and record reads", () => {
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    const multi = "permission-policy.can-use-object";
    const single = "action.uses-function";
    const edges = panelReadResultSchemas.panelRecordList.parse(reads.graphEdges());
    expect(edges.find(row => row.primaryKey === single)?.fields).toMatchObject({
      fromclass: ACTION, toclass: FUNCTION, relationKind: single,
    });
    const boundEdges = edges.filter(row => row.fields.relationKind === multi);
    expect(boundEdges.map(row => row.fields.toclass).sort()).toEqual(
      [PRODUCT_PANEL, PRODUCT_PROJECTION, SDK_COMPONENT, AGENT_DEFINITION, "platform:MetricView", FUNCTION, "platform:Workflow"]
        .sort(),
    );
    // A kind declared to collapse on the type graph draws no type edges at all
    expect(edges.some(row => row.fields.relationKind === "projection.binds-target")).toBe(false);
    const kind = panelReadResultSchemas.panelRecord.parse(reads.relationRecord(multi));
    expect(kind.fields.targetObjects).toEqual(boundEdges.map(row => expect.objectContaining({ primaryKey: row.fields.toclass })));
    expect(kind.fields).not.toHaveProperty("toObject");
    const key = `${multi}::${FUNCTION}`;
    expect(boundEdges.find(row => row.primaryKey === key)?.fields.toclass).toBe(FUNCTION);
    expect(reads.typeRelations(FUNCTION).find(row => row.primaryKey === key)?.fields).toMatchObject({
      direction: "incoming", fromclass: PERMISSION_POLICY, toclass: FUNCTION,
    });
    expect(reads.relationRecord(key).fields).toMatchObject({
      fromObject: { primaryKey: PERMISSION_POLICY }, toObject: { primaryKey: FUNCTION },
    });
    expect(reads.relationRecord(single).fields.toObject).toMatchObject({ primaryKey: FUNCTION });
    expect(() => reads.relationRecord(`${multi}::unknown`)).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("declares only parameters that the live instance reads consume", () => {
    const { reads } = platformObjectTypes[ONTOLOGY_TYPE];
    expect(reads?.instanceSearch).toMatchObject({
      params: { className: "className", search: "keyword", page: "page" },
    });
    expect((reads?.instanceSearch as { params: object }).params).not.toHaveProperty("version");
    for (const param of ["version", "filters", "sort"]) {
      expect((reads?.instances as { params: object }).params).not.toHaveProperty(param);
    }
  });

  it("distinguishes owner refusal from an empty single-type result and a missing object", async () => {
    stubOwnerHttp({
      "/workflow/query": () => jsonResponse({}, 403),
      "/workflow/subjects": () => jsonResponse({}, 500),
    });
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    await expect(reads.instanceSearch({ className: "platform:Workflow" })).rejects.toMatchObject({ status: 403 });
    await expect(reads.instances({ className: "platform:Workflow" })).rejects.toMatchObject({ status: 403 });
    await expect(reads.instanceSearch({ className: FUNCTION })).resolves.toMatchObject({ rows: [], total: 0 });
    await expect(reads.instanceRecord({ object: { className: FUNCTION, primaryKey: "missing" } }))
      .rejects.toMatchObject({ status: 404 });
    await expect(reads.instanceRecord({ object: { className: USER, primaryKey: owner.userId } }))
      .rejects.toMatchObject({ status: 502 });
    await expect(reads.instanceRecord({ object: { className: SCHEDULED_TASK, primaryKey: "timer" } }))
      .rejects.toMatchObject({ status: 503 });
  });

  it("preserves real instance targets, owner fields and detail navigation through pagination", async () => {
    const { seenRequests } = stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    expect(await reads.instanceSearch({ search: "  " })).toMatchObject({ rows: [], total: 0 });
    expect(seenRequests).toHaveLength(0);
    const page = panelReadResultSchemas.panelRecordQuery.parse(await reads.instances({
      className: ACTION, search: "Order", page: { number: 2, size: 1 },
    }));
    expect(page).toMatchObject({
      rows: [{
        className: ACTION, primaryKey: "act-2", fields: { status: "DRAFT" },
        outputs: { detailPath: "/ontology/assets/actions/detail?selected=act-2" },
      }],
      total: 2,
      hasMore: false,
    });
    const detail = panelReadResultSchemas.panelRecord.parse(await reads.instanceRecord({
      object: { className: ACTION, primaryKey: "act-2" },
    }));
    expect(detail.outputs).toMatchObject(page.rows[0].outputs!);
    const hits = await reads.instanceSearch({ className: ACTION, search: "Cancel Order" });
    expect(hits.rows).toMatchObject([{ className: ACTION, primaryKey: "act-2" }]);
  });

  it("filters edges and returns only the neighbors reached by the requested page", async () => {
    stubOwnerHttp();
    const reads = createPlatformOntologyReadAdapter(owner, viewer);
    const params = {
      node: { className: ACTION, primaryKey: "act-1" },
      relationKinds: ["permission-policy.can-execute-action"],
      direction: "incoming" as const, targetClass: PERMISSION_POLICY, limit: 1,
    };
    const first = panelReadResultSchemas.panelGraphNeighbors.parse(await reads.neighbors(params));
    const second = panelReadResultSchemas.panelGraphNeighbors.parse(await reads.neighbors({ ...params, offset: first.nextOffset! }));
    expect(first.nextOffset).toBe(1);
    expect(second.nextOffset).toBeNull();
    expect(second.total).toBe(2);
    expect([...first.neighbors, ...second.neighbors].map(node => node.primaryKey).sort()).toEqual(["pol-1", "pol-2"]);
    await expect(reads.neighbors({ ...params, direction: "outgoing" })).resolves.toMatchObject({ edges: [], total: 0 });
    await expect(reads.neighbors({ ...params, targetClass: FUNCTION })).resolves.toMatchObject({ edges: [], total: 0 });
  });
});
