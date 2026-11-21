import { beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import {
  platformOntologyCountsResponseSchema,
  platformOntologyNeighborsResponseSchema,
  platformOntologySchemaResponseSchema,
} from "@ontomato/contracts/platform-ontology";
import {
  AGENT_DEFINITION,
  APPLICATION,
  APPROVE_KNOWLEDGE,
  BUSINESS_KNOWLEDGE,
  DASHBOARD_CARD,
  DELETE_AGENT,
  DELETE_KNOWLEDGE,
  ONTOLOGY_TYPE,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  ROLE,
  SCHEDULED_TASK,
  SDK_COMPONENT,
  platformObjectTypes,
  platformRelationKinds,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeDetails } from "@ontomato/contracts/platform-type-details";
import { METRIC_CHART_COMPONENT } from "@ontomato/contracts/product-panels";
import { protectedSkillRef } from "../../../core/skills/providers";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { getPostgresPool } from "../../../infrastructure/postgres";
import { AuthFailedError, BackendResponseError, backendGet, backendPost } from "../../../utils/backend-client";
import { HttpError } from "../../../utils/errors";
import { listAgentDefinitions } from "../../assistant/definitions";
import { assistantSkillCatalog } from "../../assistant/skills";
import { listPublishedDefinitions } from "../../business-definitions/definitions";
import { grantedProductIds } from "../../product-governance/grants";
import { readPanelComponentCatalogue } from "../../product-panels/component-catalogue";
import { listObjectDetailPanelMappings } from "../../product-panels/object-detail";
import {
  readPlatformOntologyCounts,
  readPlatformOntologyNeighbors,
  readPlatformOntologyObjects,
  readPlatformOntologySchema,
  readPlatformOntologyStart,
} from "../query";

vi.mock("../../../utils/backend-client", async (original) => ({
  ...(await original<typeof import("../../../utils/backend-client")>()),
  backendGet: vi.fn(),
  backendPost: vi.fn(),
}));
vi.mock("../../../infrastructure/postgres", async (original) => ({
  ...(await original<typeof import("../../../infrastructure/postgres")>()),
  getPostgresPool: vi.fn(),
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
vi.mock("../../product-governance/grants", () => ({
  grantedProductIds: vi.fn(),
}));
vi.mock("../../product-panels/component-catalogue", () => ({
  readPanelComponentCatalogue: vi.fn(),
}));
vi.mock("../../product-panels/object-detail", () => ({
  listObjectDetailPanelMappings: vi.fn(),
}));

const assertPermissionMock = vi.fn();
const pgQueryMock = vi.fn();

const owner = { domainId: "domain-1", userId: "user-1" };
const credentials = { token: "tok-1", locale: "zh-CN" };
const panelMainSkillRef = protectedSkillRef("product-panels", owner.domainId, "panel-main");
const panelMainSkillKey = runtimeSkillKey(panelMainSkillRef);

function okJson(data: unknown) {
  return {
    text: JSON.stringify({ success: true, data }),
    headers: new Headers(),
    status: 200,
    statusText: "OK",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertPermissionMock.mockResolvedValue(undefined);
  installWorkbenchIdentity({
    assertPermission: assertPermissionMock,
  } as unknown as WorkbenchIdentity);

  vi.mocked(getPostgresPool).mockReturnValue({
    query: pgQueryMock,
  } as unknown as ReturnType<typeof getPostgresPool>);

  vi.mocked(grantedProductIds).mockResolvedValue([]);
  vi.mocked(readPanelComponentCatalogue).mockResolvedValue({
    version: "1.0.0",
    digest: "sha256:test",
    components: new Map([
      [
        "@ontomato/sdk:ObjectList",
        {
          componentId: "ObjectList",
          module: "@ontomato/sdk/base",
          exportName: "ObjectList",
          role: "presentation",
          meaning: "List objects",
          config: [],
          inputs: {},
          ports: { props: [], events: [], slots: [] },
        },
      ],
      [
        "@ontomato/sdk:ObjectForm",
        {
          componentId: "ObjectForm",
          module: "@ontomato/sdk/base",
          exportName: "ObjectForm",
          role: "presentation",
          meaning: "Edit object",
          config: [],
          inputs: {},
          ports: { props: [], events: [], slots: [] },
        },
      ],
      [
        METRIC_CHART_COMPONENT,
        {
          componentId: "MetricChart",
          module: "@ontomato/sdk/base",
          exportName: "MetricChart",
          role: "presentation",
          meaning: "Metric chart",
          config: [],
          inputs: {},
          ports: { props: [], events: [], slots: [] },
        },
      ],
    ]),
  } as Awaited<ReturnType<typeof readPanelComponentCatalogue>>);
  vi.mocked(listObjectDetailPanelMappings).mockResolvedValue([]);
  pgQueryMock.mockResolvedValue({ rows: [] });
  vi.mocked(backendGet).mockImplementation(async (_endpoint, url) => {
    if (url.includes("/platform/applications?purpose=navigation")) {
      return okJson([]);
    }
    throw new Error(`Unexpected GET URL: ${url}`);
  });

  vi.mocked(listPublishedDefinitions).mockResolvedValue([
    { id: "def-orders", name: "Active Orders", objectType: "Order", revision: 1, status: "PUBLISHED", parameters: [] },
    { id: "def-apps", name: "Apps", objectType: "platform:Application", revision: 1, status: "PUBLISHED", parameters: [] },
  ] as Awaited<ReturnType<typeof listPublishedDefinitions>>);

  vi.mocked(assistantSkillCatalog).mockResolvedValue({
    skills: [
      {
        skill: { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" },
        title: "Analyst Assistant",
        description: "Query ontology",
      },
    ],
  });

  vi.mocked(listAgentDefinitions).mockResolvedValue({
    agents: [
      {
        id: "agent-1",
        name: "Ops Assistant",
        description: "",
        icon: null,
        enabled: true,
        modelSelection: { modelId: null },
        skills: [{ namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" }],
        classNames: [],
        enabledMcpServiceIds: [],
        sortOrder: 0,
        systemPrompt: "",
        executionUserId: "user-1",
      },
    ],
  });

  vi.mocked(backendPost).mockImplementation(async (_endpoint, url) => {
    if (url.endsWith("/admin/getMetas")) {
      return okJson({
        classDef: [
          { className: "Order", showName: "Order", attrs: [{ name: "id", showName: "Order ID" }, { name: "amount", showName: "Amount" }] },
          { className: "Customer", showName: "Customer", attrs: [{ name: "id", showName: "Customer ID" }] },
        ],
        relationship_rule: {
          PLACED_BY: { fromclass: "Order", toclass: "Customer", showName: "Placed By" },
        },
      });
    }
    if (url.endsWith("/metricView/queryList")) {
      return okJson([
        { id: "metric-1", name: "Order Total", status: "PUBLISHED", function: { id: "fn-1" }, createdBy: "user-1", reviewedBy: "user-1" },
      ]);
    }
    if (url.endsWith("/function/queryList")) {
      return okJson([
        { id: "fn-1", name: "Sum Orders", operation: "OPERATION_READ", returnDef: { classNames: ["Order"] }, parameters: [{ classNames: ["Customer"] }] },
      ]);
    }
    if (url.endsWith("/action/queryList")) {
      return okJson([
        {
          id: "act-1",
          name: "Approve Order",
          status: "PUBLISHED",
          function: { id: "fn-1" },
          target: { className: "Order" },
          createdBy: "user-1",
          reviewedBy: "user-1",
        },
      ]);
    }
    if (url.endsWith("/workflow/query")) {
      return okJson([
        {
          id: "wf-1",
          name: "Order Approval",
          version: 2,
          steps: [{ actionId: "act-1", roleCode: "Approver" }],
          createdBy: "user-1",
          reviewedBy: "user-2",
        },
      ]);
    }
    if (url.endsWith("/trigger/queryList")) {
      return okJson([
        { id: "tr-1", name: "Daily Order Check", effectKind: "workflow", effect: { workflowId: "wf-1" }, enabled: true },
        { id: "tr-2", name: "Immediate Approve", effectKind: "action", effect: { actionId: "act-1" }, enabled: true },
      ]);
    }
    if (url.endsWith("/admin/getBussinessKnowledge")) {
      return okJson({
        k1: { knowledgeID: "k1", knowledgeTitle: "Order Policy", status: 1 },
      });
    }
    if (url.endsWith("/workflow/subjects")) {
      return okJson([
        { id: "user-1", loginCode: "alice", displayName: "Alice", roleIds: ["r-1"] },
        { id: "user-2", loginCode: "bob", displayName: "Bob", roleIds: [] },
      ]);
    }
    if (url.endsWith("/workflow/grants")) {
      return okJson([
        { roleId: "r-1", roleCode: "Approver", capabilityKind: "ACTION", capabilityId: "act-1", inForce: true },
        { roleId: "r-1", roleCode: "Approver", capabilityKind: "ACTION", capabilityId: "act-retired", inForce: false },
      ]);
    }
    if (url.endsWith("/workflow/platform-access")) {
      return okJson([
        { roleId: "r-1", roleCode: "Approver", apiPermissions: ["/workflow/save"], managementRole: false },
      ]);
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
});

describe("platform-ontology composite query", () => {
  it("exposes all four layers, declared layered object types, and 29 relation kinds directly from contracts", async () => {
    const schema = await readPlatformOntologySchema();
    const expectedTypes = Object.entries(platformObjectTypes).filter(([, decl]) => Boolean(decl.layer));
    expect(schema.layers).toEqual(["fact", "capability", "governance", "product"]);
    expect(schema.objectTypes).toHaveLength(expectedTypes.length);
    expect(schema.relationKinds).toBe(platformRelationKinds);
    expect(schema.relationKinds).toHaveLength(29);

    expect(schema.objectTypes.map((t) => t.id)).toEqual(expectedTypes.map(([id]) => id));
    expect(schema.objectTypes.every((t) => t.labelKey.startsWith("platformOntology.types."))).toBe(true);
    expect(schema.relationKinds.every((r) => r.labelKey === `platformOntology.relations.${r.id}`)).toBe(true);

    const publishedRelations = schema.relationKinds.filter((r) => r.id.startsWith("user.published-"));
    expect(publishedRelations).toHaveLength(3);
    expect(publishedRelations.every((r) => r.derived === false)).toBe(true);

    const derivedIds = schema.relationKinds.filter((r) => r.derived).map((r) => r.id);
    expect(derivedIds).toEqual(["role.can-author-workflow", "role.owns-workflow-step", "panel.provides-skill"]);

    expect(platformOntologySchemaResponseSchema.parse(schema)).toEqual(schema);
    expect(panelReadResultSchemas.panelGraphSchema.parse(schema)).toEqual(schema);

    const byId = new Map(schema.objectTypes.map((t) => [t.id, t]));
    for (const [id, detail] of Object.entries(platformTypeDetails)) {
      const entry = byId.get(id);
      expect(entry, id).toBeDefined();
      expect(entry?.definition).toBe(detail?.definition);
      expect(entry?.properties).toEqual(detail?.properties);
      expect(entry?.rules).toBe(detail?.rules);
    }

    const agent = byId.get(AGENT_DEFINITION);
    expect(agent?.definition).toBe(platformTypeDetails[AGENT_DEFINITION]?.definition);
    expect(Object.keys(agent?.reads ?? {}).sort()).toEqual(["createForm", "form", "list", "record"]);
    expect(agent?.operations?.map((op) => op.id)).toEqual([`${AGENT_DEFINITION}.save`, DELETE_AGENT]);

    const application = byId.get(APPLICATION);
    expect(application?.definition).toBe(platformTypeDetails[APPLICATION]?.definition);
    expect(Object.keys(application?.reads ?? {}).sort()).toEqual(["createForm", "entries", "form", "query", "record"]);
    expect(application?.operations?.map((op) => op.id)).toContain(`${APPLICATION}.save`);

    const projection = byId.get(PRODUCT_PROJECTION);
    expect(projection?.definition).toBe(platformTypeDetails[PRODUCT_PROJECTION]?.definition);
    expect(Object.keys(projection?.reads ?? {}).sort()).toEqual(["createForm", "form", "query", "record", "usedBy"]);
    expect(projection?.operations?.map((op) => op.id)).toContain(`${PRODUCT_PROJECTION}.save`);

    const panel = byId.get(PRODUCT_PANEL);
    expect(panel?.definition).toBe(platformTypeDetails[PRODUCT_PANEL]?.definition);
    expect(Object.keys(panel?.reads ?? {}).sort()).toEqual(["createForm", "form", "members", "query", "record", "usedBy"]);
    expect(panel?.operations?.map((op) => op.id)).toContain(`${PRODUCT_PANEL}.save`);

    const sdkComponent = byId.get(SDK_COMPONENT);
    expect(Object.keys(sdkComponent?.reads ?? {}).sort()).toEqual(["catalogue", "definition"]);
    expect(sdkComponent?.operations).toBeUndefined();

    const role = byId.get(ROLE);
    expect(role?.reads).toBeUndefined();
    expect(role?.operations).toBeUndefined();
  });

  it("coalesces shared owners in counts and separates ok, refused, and failed statuses across all four layers", async () => {
    assertPermissionMock.mockRejectedValueOnce(new HttpError(403, "Missing analysis-agent permission", "PERMISSION_DENIED"));
    vi.mocked(grantedProductIds).mockResolvedValue(["proj-kb", "panel-main"]);
    pgQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("product_projections")) {
        return {
          rows: [
            {
              id: "proj-kb",
              definition: {
                name: "Knowledge List",
                description: "",
                visibility: "domain",
                componentId: "@ontomato/sdk:ObjectList",
                inputs: {},
                outputs: {},
                data: {
                  items: {
                    source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
                    read: "query",
                    params: {},
                  },
                },
                config: {},
              },
            },
          ],
        };
      }
      if (sql.includes("product_panels")) {
        return {
          rows: [
            {
              id: "panel-main",
              definition: {
                name: "Knowledge Panel",
                description: "Main panel",
                visibility: "domain",
                content: { html: "<section></section>", module: "export default {};" },
                manifest: {
                  state: {},
                  members: {
                    list: { target: { projectionId: "proj-kb" } },
                  },
                  events: {},
                },
              },
            },
          ],
        };
      }
      return { rows: [] };
    });
    vi.mocked(backendGet).mockImplementation(async (_endpoint, url) => {
      if (url.includes("/platform/applications?purpose=navigation")) {
        return okJson([
          {
            id: "app-kb",
            kind: "product",
            names: { "zh-CN": "知识库", en: "Knowledge Base" },
            descriptions: {},
            icon: "book",
            rail: "apps",
            category: "business",
            sort: 1,
            entry: { path: "/applications/app-kb", renderer: "panels" },
            entryAccess: ["app-kb:enter"],
            scheduleAdapter: null,
            releaseId: null,
            panelUses: [],
          },
        ]);
      }
      throw new Error(`Unexpected GET URL: ${url}`);
    });
    vi.mocked(backendPost).mockImplementation(async (_endpoint, url) => {
      if (url.endsWith("/trigger/queryList")) {
        return { text: JSON.stringify({ success: false, message: "Trigger store down" }), headers: new Headers(), status: 200, statusText: "OK" };
      }
      if (url.endsWith("/admin/getMetas")) {
        return okJson({
          classDef: [{ className: "Order", showName: "Order", attrs: [{ name: "id" }] }],
          relationship_rule: { R1: { fromclass: "Order", toclass: "Order" } },
        });
      }
      return okJson([]);
    });

    const { counts } = platformOntologyCountsResponseSchema.parse(
      await readPlatformOntologyCounts(owner, credentials),
    );
    const byType = new Map(counts.map((c) => [c.type, c]));

    expect(byType.get("platform:ObjectType")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Attribute")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Relationship")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Skill")).toMatchObject({ status: "refused" });
    expect(byType.get("platform:AgentDefinition")).toMatchObject({ status: "refused" });
    expect(byType.get("platform:Trigger")).toMatchObject({ status: "failed" });
    expect(byType.get("platform:SDKComponent")).toMatchObject({ status: "ok", count: 3 });
    expect(byType.get("platform:ProductProjection")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:ProductPanel")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Application")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:ApplicationPanelUse")).toBeUndefined();

    // /admin/getMetas must be called only once across ObjectType + Attribute + Relationship
    const metaCalls = vi.mocked(backendPost).mock.calls.filter(([, url]) => String(url).endsWith("/admin/getMetas"));
    expect(metaCalls).toHaveLength(1);
    // grantedProductIds must be called only once across ProductProjection + ProductPanel
    expect(grantedProductIds).toHaveBeenCalledTimes(1);
    // analysis-agent permission must be checked only once across Skill + AgentDefinition
    expect(assertPermissionMock).toHaveBeenCalledTimes(1);
    expect(listAgentDefinitions).not.toHaveBeenCalled();
    expect(assistantSkillCatalog).not.toHaveBeenCalled();
  });

  it("resolves default start node from subjects, keeps real userId on 403, and aligns OSS hostOwner", async () => {
    const enterpriseStart = await readPlatformOntologyStart(owner, credentials, "Alice Fallback");
    expect(enterpriseStart).toEqual({
      className: "platform:User",
      primaryKey: "user-1",
      label: "Alice",
      layer: "governance",
    });

    vi.mocked(backendPost).mockRejectedValueOnce(new BackendResponseError(403, JSON.stringify({ message: "Denied" })));
    const refusedStart = await readPlatformOntologyStart(owner, credentials, "Alice Fallback");
    expect(refusedStart).toEqual({
      className: "platform:User",
      primaryKey: "user-1",
      label: "Alice Fallback",
      layer: "governance",
    });

    // OSS: subjects returns empty, actions have createdBy: "admin", aligned to "system"
    vi.mocked(backendPost).mockImplementation(async (_endpoint, url) => {
      if (url.endsWith("/workflow/subjects")) return okJson([]);
      if (url.endsWith("/action/queryList")) {
        return okJson([{ id: "act-oss", name: "OSS Action", createdBy: "admin", reviewedBy: "admin" }]);
      }
      return okJson([]);
    });
    const ossOwner = { domainId: "1", userId: "system" };
    const ossStart = await readPlatformOntologyStart(ossOwner, { locale: "en" }, "system");
    expect(ossStart).toMatchObject({ className: "platform:User", primaryKey: "system" });

    const ossNeighbors = await readPlatformOntologyNeighbors(ossOwner, { locale: "en" }, {
      node: { className: ossStart.className, primaryKey: ossStart.primaryKey },
      relationKinds: ["user.created-action", "user.published-action"],
    });
    expect(ossNeighbors.edges).toHaveLength(2);
    expect(ossNeighbors.edges.map((e) => e.relationKind).sort()).toEqual([
      "user.created-action",
      "user.published-action",
    ]);
    expect(ossNeighbors.edges.every((e) => e.derived === false)).toBe(true);
  });

  it("expands 1-hop neighbors for a User with both outgoing and incoming edges and isolates per-relation 403 refusal", async () => {
    assertPermissionMock.mockRejectedValueOnce(new HttpError(403, "No agent admin menu", "PERMISSION_DENIED"));

    const res = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:User", primaryKey: "user-1" },
    });

    expect(res.node).toMatchObject({ className: "platform:User", primaryKey: "user-1", label: "Alice", layer: "governance" });

    // Alice created & published act-1 (two distinct edges), created wf-1, created & published metric-1, holds role Approver
    const edgeKinds = res.edges.map((e) => `${e.relationKind}:${e.to.primaryKey}`).sort();
    expect(edgeKinds).toEqual([
      "user.created-action:act-1",
      "user.created-metric-view:metric-1",
      "user.created-workflow:wf-1",
      "user.holds-role:Approver",
      "user.published-action:act-1",
      "user.published-metric-view:metric-1",
    ]);

    const statusByKind = new Map(res.relations.map((r) => [r.relationKind, r]));
    expect(statusByKind.get("agent.executes-as-user")).toMatchObject({ status: "refused", edgeCount: 0 });
    expect(statusByKind.get("user.published-workflow")).toMatchObject({ status: "ok", edgeCount: 0 });
    expect(statusByKind.get("user.created-action")).toMatchObject({ status: "ok", edgeCount: 1 });
  });

  it("computes cross-layer neighbors for ObjectType including Definition (excluding platform:* definitions)", async () => {
    const res = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ObjectType", primaryKey: "Order" },
    });

    const kinds = res.edges.map((e) => e.relationKind).sort();
    expect(kinds).toEqual([
      "action.targets-object-type",
      "definition.based-on-object-type",
      "function.reads-object-type",
      "object-type.has-attribute",
      "object-type.has-attribute",
      "relationship.from-object-type",
    ]);
    // Both attributes of Order use SDK's JSON tuple primaryKey convention
    const attrKeys = res.edges
      .filter((e) => e.relationKind === "object-type.has-attribute")
      .map((e) => e.to.primaryKey)
      .sort();
    expect(attrKeys).toEqual(['["Order","amount"]', '["Order","id"]']);
  });

  it("propagates HTTP 401 AuthFailedError for the whole request instead of per-relation refusal", async () => {
    vi.mocked(backendPost).mockRejectedValue(new AuthFailedError("Session expired", 401));
    await expect(
      readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: "platform:Action", primaryKey: "act-1" },
      }),
    ).rejects.toBeInstanceOf(AuthFailedError);
  });

  it("filters and paginates objects of a type and reports refused status cleanly", async () => {
    const okRes = await readPlatformOntologyObjects(owner, credentials, {
      type: "platform:ObjectType",
      keyword: "ord",
      page: 1,
      pageSize: 10,
    });
    expect(okRes.status).toBe("ok");
    expect(okRes.total).toBe(1);
    expect(okRes.items[0]).toMatchObject({ node: { className: "platform:ObjectType", primaryKey: "Order" }, label: "Order" });

    assertPermissionMock.mockRejectedValueOnce(new HttpError(403, "No permission"));
    const refusedRes = await readPlatformOntologyObjects(owner, credentials, {
      type: "platform:AgentDefinition",
    });
    expect(refusedRes.status).toBe("refused");
    expect(refusedRes.items).toEqual([]);
  });

  it("resolves real product-layer relations including merged projection bindings, panel containment, skills, and applications", async () => {
    vi.mocked(grantedProductIds).mockResolvedValue([
      "proj-kb-list",
      "proj-kb-form",
      "proj-kb-approve-only",
      "proj-order-actions",
      "proj-chart",
      "proj-unlayered",
      "panel-main",
      "panel-child",
      "panel-order-detail",
      "panel-tab-candidate",
      "panel-placement-candidate",
    ]);

    const projectionRows = [
      {
        id: "proj-kb-list",
        definition: {
          name: "Knowledge List",
          description: "Browse knowledge",
          visibility: "domain",
          componentId: "@ontomato/sdk:ObjectList",
          inputs: {
            row: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
          },
          outputs: {},
          data: {
            items: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} },
            stats: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "counts", params: {} },
          },
          operations: {
            approve: { operation: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE }, target: { input: "row" } },
            remove: { operation: { kind: "PlatformOperation", id: DELETE_KNOWLEDGE }, target: { input: "row" } },
            // Undeclared in platformObjectTypes[*].operations: must not be guessed by prefix
            undeclaredOp: { operation: { kind: "PlatformOperation", id: "agents.undeclaredOperation" } },
          },
          config: {},
        },
      },
      {
        id: "proj-kb-form",
        definition: {
          name: "Knowledge Form",
          description: "",
          visibility: "domain",
          componentId: "@ontomato/sdk:ObjectForm",
          inputs: {
            selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
          },
          outputs: {},
          data: {
            form: { source: { object: { input: "selected" } }, read: "form", params: {} },
          },
          operations: {
            save: { operation: { kind: "PlatformOperation", id: `${BUSINESS_KNOWLEDGE}.save` }, target: { input: "selected" } },
          },
          config: {},
        },
      },
      {
        id: "proj-kb-approve-only",
        definition: {
          name: "Approve Button",
          description: "",
          visibility: "domain",
          componentId: "@ontomato/sdk:ObjectForm",
          inputs: {
            selected: { kind: "object", objectType: BUSINESS_KNOWLEDGE },
          },
          outputs: {},
          data: {},
          operations: {
            approve: { operation: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE }, target: { input: "selected" } },
          },
          config: {},
        },
      },
      {
        id: "proj-order-actions",
        definition: {
          name: "Order Actions",
          description: "",
          visibility: "domain",
          componentId: "@ontomato/sdk:ObjectList",
          inputs: {
            order: { kind: "object", objectType: "Order" },
          },
          outputs: {},
          data: {
            orders: { source: { type: { kind: "ObjectType", id: "Order" } }, read: "query", params: {} },
          },
          operations: {
            approveOrder: { operation: { kind: "Action", id: "act-1" }, target: { input: "order" } },
          },
          config: {},
        },
      },
      {
        id: "proj-chart",
        definition: {
          name: "Order Revenue Chart",
          description: "",
          visibility: "domain",
          componentId: METRIC_CHART_COMPONENT,
          metricId: "metric-1",
          inputs: {},
          outputs: {},
          data: {
            template: {
              source: { object: { literal: { className: DASHBOARD_CARD, primaryKey: "card-1" } } },
              read: "chartTemplate",
              params: {},
            },
          },
          config: {},
        },
      },
      {
        id: "proj-unlayered",
        definition: {
          name: "Task List",
          description: "",
          visibility: "domain",
          componentId: "@ontomato/sdk:ObjectList",
          inputs: {},
          outputs: {},
          data: {
            tasks: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} },
          },
          config: {},
        },
      },
    ];

    const panelRows = [
      {
        id: "panel-main",
        definition: {
          name: "Main Workspace",
          description: "Top panel",
          visibility: "domain",
          content: { html: "<section></section>", module: "export default {};" },
          manifest: {
            state: {
              selectedOrder: { type: { kind: "object", objectType: "Order" } },
              activeTab: { type: { kind: "object", objectType: PRODUCT_PANEL } },
              customSlot: {
                type: { kind: "placement", candidates: { rule: "usable" } },
                default: { id: "slot-1", target: { projectionId: "proj-order-actions" } },
              },
              panelPickerSlot: {
                type: { kind: "placement", candidates: { panelIds: ["panel-placement-candidate"] } },
              },
            },
            members: {
              list: { target: { projectionId: "proj-kb-list" } },
              hiddenProj: { target: { projectionId: "proj-not-granted" } },
              child: { target: { panelId: "panel-child" } },
              hiddenPanel: { target: { panelId: "panel-not-granted" } },
              tabPanel: { target: { fromState: "activeTab", candidates: { panelIds: ["panel-tab-candidate"] } } },
              detail: { target: { fromState: "selectedOrder", candidates: { rule: "objectDetail" } } },
            },
            events: {},
          },
        },
      },
      {
        id: "panel-child",
        definition: {
          name: "Child Panel",
          description: "",
          visibility: "domain",
          content: { html: "<div></div>", module: "export default {};" },
          manifest: {
            state: {},
            members: {
              form: { target: { projectionId: "proj-kb-form" } },
            },
            events: {},
          },
        },
      },
      {
        id: "panel-order-detail",
        definition: {
          name: "Order Detail",
          description: "",
          visibility: "domain",
          content: { html: "<div></div>", module: "export default {};" },
          manifest: { state: {}, members: {}, events: {} },
        },
      },
      {
        id: "panel-tab-candidate",
        definition: {
          name: "Tab Candidate",
          description: "",
          visibility: "domain",
          content: { html: "<div></div>", module: "export default {};" },
          manifest: { state: {}, members: {}, events: {} },
        },
      },
      {
        id: "panel-placement-candidate",
        definition: {
          name: "Placement Candidate",
          description: "",
          visibility: "domain",
          content: { html: "<div></div>", module: "export default {};" },
          manifest: { state: {}, members: {}, events: {} },
        },
      },
    ];

    pgQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("product_projections")) return { rows: projectionRows };
      if (sql.includes("product_panels")) return { rows: panelRows };
      return { rows: [] };
    });
    vi.mocked(listObjectDetailPanelMappings).mockResolvedValue([
      { className: "Order", panelId: "panel-order-detail" },
      { className: "Customer", panelId: "panel-not-granted" },
    ]);
    vi.mocked(assistantSkillCatalog).mockResolvedValue({
      skills: [
        {
          skill: panelMainSkillRef,
          title: "Main Workspace Skill",
          description: "Read and act on Main Workspace",
        },
      ],
    });
    vi.mocked(backendGet).mockImplementation(async (_endpoint, url) => {
      if (url.includes("/platform/applications?purpose=navigation")) {
        return okJson([
          {
            id: "app-ops",
            kind: "product",
            names: { "zh-CN": "运营台", en: "Ops Console" },
            descriptions: {},
            icon: "grid",
            rail: "apps",
            category: "business",
            sort: 1,
            entry: { path: "/applications/app-ops", renderer: "panels" },
            entryAccess: ["app-ops:enter"],
            scheduleAdapter: null,
            releaseId: null,
            panelUses: [
              {
                id: "use-main",
                panelId: "panel-main",
                path: "/applications/app-ops/main",
                pageKey: "main",
                names: { en: "Main" },
                access: { kind: "domain-member" },
              },
            ],
          },
        ]);
      }
      throw new Error(`Unexpected GET URL: ${url}`);
    });

    // 1. Merged reads + platform operations on one edge to platform:OntologyType(platform:BusinessKnowledge)
    const kbListNeighbors = platformOntologyNeighborsResponseSchema.parse(
      await readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: "platform:ProductProjection", primaryKey: "proj-kb-list" },
      }),
    );
    expect(kbListNeighbors.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationKind: "projection.uses-component",
          direction: "outgoing",
          to: { className: "platform:SDKComponent", primaryKey: "@ontomato/sdk:ObjectList" },
        }),
        expect.objectContaining({
          relationKind: "projection.binds-target",
          direction: "outgoing",
          to: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE },
          binding: {
            reads: ["counts", "query"],
            operations: [APPROVE_KNOWLEDGE, DELETE_KNOWLEDGE],
          },
        }),
        expect.objectContaining({
          relationKind: "panel.contains-projection",
          direction: "incoming",
          from: { className: "platform:ProductPanel", primaryKey: "panel-main" },
        }),
      ]),
    );
    // Must not guess platform:AgentDefinition from an undeclared agents.* prefix
    expect(kbListNeighbors.edges.filter((e) => e.relationKind === "projection.binds-target")).toHaveLength(1);
    expect(kbListNeighbors.neighbors).toContainEqual({
      className: ONTOLOGY_TYPE,
      primaryKey: BUSINESS_KNOWLEDGE,
      label: BUSINESS_KNOWLEDGE,
      layer: "capability",
    });

    // 2. Input-constrained read + save operation sets viaInput: true
    const kbFormNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "proj-kb-form" },
      relationKinds: ["projection.binds-target"],
    });
    expect(kbFormNeighbors.edges).toHaveLength(1);
    expect(kbFormNeighbors.edges[0]).toMatchObject({
      to: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE },
      binding: {
        reads: ["form"],
        operations: [`${BUSINESS_KNOWLEDGE}.save`],
        viaInput: true,
      },
    });

    // 3. Operation-only projection still draws one projection.binds-target edge with operations only
    const approveOnlyNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "proj-kb-approve-only" },
      relationKinds: ["projection.binds-target"],
    });
    expect(approveOnlyNeighbors.edges).toHaveLength(1);
    expect(approveOnlyNeighbors.edges[0]).toMatchObject({
      to: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE },
      binding: {
        operations: [APPROVE_KNOWLEDGE],
        viaInput: true,
      },
    });

    // 4. Customer ObjectType + customer Action produce distinct target nodes
    const orderProjNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "proj-order-actions" },
      relationKinds: ["projection.binds-target"],
    });
    expect(orderProjNeighbors.edges).toHaveLength(2);
    expect(orderProjNeighbors.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: { className: "platform:ObjectType", primaryKey: "Order" },
          binding: { reads: ["query"] },
        }),
        expect.objectContaining({
          to: { className: "platform:Action", primaryKey: "act-1" },
          binding: { operations: ["act-1"] },
        }),
      ]),
    );

    // 5. MetricChart points to MetricView and skips unlayered DashboardCard; ScheduledTask projection skips unlayered type
    const chartNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "proj-chart" },
      relationKinds: ["projection.binds-target"],
    });
    expect(chartNeighbors.edges).toHaveLength(1);
    expect(chartNeighbors.edges[0]).toMatchObject({
      to: { className: "platform:MetricView", primaryKey: "metric-1" },
    });
    const unlayeredNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "proj-unlayered" },
      relationKinds: ["projection.binds-target"],
    });
    expect(unlayeredNeighbors.edges).toHaveLength(0);

    // 6. Expanding incoming from platform:OntologyType(platform:BusinessKnowledge) works with declared layer
    const incomingFromType = platformOntologyNeighborsResponseSchema.parse(
      await readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: ONTOLOGY_TYPE, primaryKey: BUSINESS_KNOWLEDGE },
      }),
    );
    expect(incomingFromType.node).toEqual({
      className: ONTOLOGY_TYPE,
      primaryKey: BUSINESS_KNOWLEDGE,
      label: BUSINESS_KNOWLEDGE,
      layer: "capability",
    });
    expect(incomingFromType.edges.map((e) => e.from.primaryKey).sort()).toEqual([
      "proj-kb-approve-only",
      "proj-kb-form",
      "proj-kb-list",
    ]);
    expect(incomingFromType.edges.every((e) => e.direction === "incoming")).toBe(true);

    // Layer filter respects the referenced platform type's declared layer
    const capabilityOnlyFromProj = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "proj-kb-list" },
      layers: ["capability"],
    });
    expect(capabilityOnlyFromProj.edges.map((e) => e.relationKind)).toEqual(["projection.binds-target"]);
    const factOnlyFromProj = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "proj-kb-list" },
      layers: ["fact"],
    });
    expect(factOnlyFromProj.edges).toEqual([]);

    // 7. Panel expands projections (fixed + placement default), child panels (fixed + fromState + placement + objectDetail), derived skill, and application uses
    const panelNeighbors = platformOntologyNeighborsResponseSchema.parse(
      await readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: "platform:ProductPanel", primaryKey: "panel-main" },
      }),
    );
    expect(panelNeighbors.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationKind: "panel.contains-projection",
          direction: "outgoing",
          to: { className: "platform:ProductProjection", primaryKey: "proj-kb-list" },
        }),
        expect.objectContaining({
          relationKind: "panel.contains-projection",
          direction: "outgoing",
          to: { className: "platform:ProductProjection", primaryKey: "proj-order-actions" },
        }),
        expect.objectContaining({
          relationKind: "panel.contains-panel",
          direction: "outgoing",
          to: { className: "platform:ProductPanel", primaryKey: "panel-child" },
        }),
        expect.objectContaining({
          relationKind: "panel.contains-panel",
          direction: "outgoing",
          to: { className: "platform:ProductPanel", primaryKey: "panel-tab-candidate" },
        }),
        expect.objectContaining({
          relationKind: "panel.contains-panel",
          direction: "outgoing",
          to: { className: "platform:ProductPanel", primaryKey: "panel-placement-candidate" },
        }),
        expect.objectContaining({
          relationKind: "panel.contains-panel",
          direction: "outgoing",
          to: { className: "platform:ProductPanel", primaryKey: "panel-order-detail" },
        }),
        expect.objectContaining({
          relationKind: "panel.provides-skill",
          direction: "outgoing",
          derived: true,
          to: { className: "platform:Skill", primaryKey: panelMainSkillKey },
        }),
        expect.objectContaining({
          relationKind: "application.uses-panel",
          direction: "incoming",
          from: { className: "platform:Application", primaryKey: "app-ops" },
        }),
      ]),
    );
    // Ungranted projection & panel must be filtered out
    expect(panelNeighbors.edges.some((e) => e.to.primaryKey === "proj-not-granted")).toBe(false);
    expect(panelNeighbors.edges.some((e) => e.to.primaryKey === "panel-not-granted")).toBe(false);

    // 8. Child panel sees incoming panel.contains-panel; application sees outgoing application.uses-panel; skill sees incoming panel.provides-skill
    const childPanelNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductPanel", primaryKey: "panel-child" },
      relationKinds: ["panel.contains-panel"],
    });
    expect(childPanelNeighbors.edges).toHaveLength(1);
    expect(childPanelNeighbors.edges[0]).toMatchObject({
      direction: "incoming",
      from: { className: "platform:ProductPanel", primaryKey: "panel-main" },
      to: { className: "platform:ProductPanel", primaryKey: "panel-child" },
    });

    const appNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:Application", primaryKey: "app-ops" },
    });
    expect(appNeighbors.edges).toHaveLength(1);
    expect(appNeighbors.edges[0]).toMatchObject({
      relationKind: "application.uses-panel",
      direction: "outgoing",
      to: { className: "platform:ProductPanel", primaryKey: "panel-main" },
    });
    expect(appNeighbors.node).toMatchObject({ label: "运营台", layer: "product" });

    const skillNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:Skill", primaryKey: panelMainSkillKey },
      relationKinds: ["panel.provides-skill"],
    });
    expect(skillNeighbors.edges).toHaveLength(1);
    expect(skillNeighbors.edges[0]).toMatchObject({
      relationKind: "panel.provides-skill",
      direction: "incoming",
      derived: true,
      from: { className: "platform:ProductPanel", primaryKey: "panel-main" },
    });

    // 9. Refused analysis-agent permission isolates panel.provides-skill cleanly
    assertPermissionMock.mockRejectedValueOnce(new HttpError(403, "No analysis-agent permission", "PERMISSION_DENIED"));
    const refusedSkillPanel = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductPanel", primaryKey: "panel-main" },
      relationKinds: ["panel.provides-skill"],
    });
    expect(refusedSkillPanel.relations).toEqual([
      expect.objectContaining({ relationKind: "panel.provides-skill", status: "refused", edgeCount: 0 }),
    ]);
  });
});
