import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import {
  platformOntologyCountsResponseSchema,
  platformOntologyNeighborsResponseSchema,
  platformOntologySchemaResponseSchema,
} from "@ontomato/contracts/platform-ontology";
import {
  ACTION,
  AGENT_DEFINITION,
  APPLICATION,
  APPROVE_KNOWLEDGE,
  BUSINESS_KNOWLEDGE,
  DASHBOARD_CARD,
  DEFINITION,
  DELETE_AGENT,
  DELETE_KNOWLEDGE,
  DELETE_ROLE,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  ORG_GRANT,
  ORG_MEMBERSHIP,
  ORG_POSITION,
  ORG_UNIT,
  PERMISSION_POLICY,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  ROLE,
  SCHEDULED_TASK,
  SDK_COMPONENT,
  USER,
  WORKFLOW,
  platformObjectTypes,
  platformRelationKinds,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeDetails } from "@ontomato/contracts/platform-type-details";
import { METRIC_CHART_COMPONENT } from "@ontomato/contracts/product-panels";
import { protectedSkillRef } from "../../../core/skills/providers";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { assertManagement } from "../../../identity/management";
import { getPostgresPool } from "../../../infrastructure/postgres";
import { AuthFailedError, BackendResponseError, backendGet, backendPost } from "../../../utils/backend-client";
import { HttpError } from "../../../utils/errors";
import { listAgentDefinitions } from "../../assistant/definitions";
import { assistantSkillCatalog } from "../../assistant/skills";
import { listPublishedDefinitions } from "../../business-definitions/definitions";
import type { ObjectDecisionRequest } from "../../product-governance/authorization";
import { readPanelComponentCatalogue } from "../../product-panels/component-catalogue";
import { listObjectDetailPanelMappings } from "../../product-panels/object-detail";
import { PlatformOntologyOwnerReaders } from "../owners";
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
vi.mock("../../product-governance/authorization", async original => ({
  ...await original<typeof import("../../product-governance/authorization")>(),
  decideObjects: (requests: ObjectDecisionRequest[]) => decideProductObjects(requests),
}));
vi.mock("../../product-governance/grants", async original => ({
  ...await original<typeof import("../../product-governance/grants")>(),
  productDefinitionOwnerHeaders: vi.fn(() => ({})),
}));
vi.mock("../../product-panels/component-catalogue", () => ({
  readPanelComponentCatalogue: vi.fn(),
}));
vi.mock("../../product-panels/object-detail", () => ({
  listObjectDetailPanelMappings: vi.fn(),
}));

vi.mock("../../../identity/management", () => ({ assertManagement: vi.fn() }));
const pgQueryMock = vi.fn();
const allowedUseIds = vi.fn<[], string[]>();
const decideProductObjects = vi.fn(async (requests: ObjectDecisionRequest[]) => requests.map(request => {
  if (!("target" in request) || !["PANEL", "PROJECTION"].includes(request.target.kind))
    throw new Error("Expected product definition access");
  expect(request.target.domainId).toBe(owner.domainId);
  expect(request.ownerFacts).toEqual({
    ownerId: request.target.id.startsWith("builtin-product-") ? null : owner.userId, state: "PUBLISHED",
  });
  return request.verb === "USE" && allowedUseIds().includes(request.target.id)
    ? { allowed: true } : { allowed: false, code: "FORBIDDEN", reason: "Not admitted" };
}));

const owner = { domainId: "domain-1", userId: "user-1" };
const credentials = { token: "tok-1", locale: "zh-CN" };
const panelMainSkillRef = protectedSkillRef("product-panels", owner.domainId, "panel-main");
const panelMainSkillKey = runtimeSkillKey(panelMainSkillRef);

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: {
    en: { ...enLocaleMeta, messages: en },
    "zh-CN": {
      ...enLocaleMeta,
      messages: {
        ...en,
        "platformOntology.domainShared": "全本域可用",
        "platformOntology.orgGrantScope.organization": "组织",
        "platformOntology.orgGrantScope.subtree": "组织含下级",
        "platformOntology.orgGrantScope.position": "岗位",
      },
    },
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

function okJson(data: unknown) {
  return {
    text: JSON.stringify({ success: true, data }),
    headers: new Headers(),
    status: 200,
    statusText: "OK",
  };
}

function graphFacts(data: Record<string, unknown> = {}) {
  return {
    ...okJson(null),
    text: JSON.stringify({ policyGrants: [], roleActionGrants: [], roleWorkflowAuthoring: [], ...data }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertManagement).mockResolvedValue(undefined);

  vi.mocked(getPostgresPool).mockReturnValue({
    query: async (sql: string, params?: unknown[]) => {
      const result = await pgQueryMock(sql, params);
      if (sql.startsWith('SELECT id,domain_id AS "domainId",owner_id AS "ownerId"')) {
        expect(params).toEqual([owner.domainId]);
        return { rows: result.rows.map(({ id }: { id: string }) => {
          const builtin = id.startsWith("builtin-product-");
          return { id, domainId: builtin ? null : owner.domainId, ownerId: builtin ? null : owner.userId };
        }) };
      }
      if (sql.includes('AS definitions') && sql.includes('id=ANY($2::text[])') && Array.isArray(params?.[1])) {
        const ids = new Set(params[1]);
        return { rows: result.rows.filter(({ id }: { id: string }) => ids.has(id)) };
      }
      return result;
    },
  } as unknown as ReturnType<typeof getPostgresPool>);

  allowedUseIds.mockReturnValue([]);
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
        engine: "pi",
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
    if (url.endsWith("/authorization/policies/graph-facts")) {
      return graphFacts({ roleWorkflowAuthoring: [{ roleId: "r-1", workflowId: "wf-1", policyId: "p-1", verb: "EDIT" }] });
    }
    if (url.endsWith("/workflow/platform-access")) {
      return okJson([
        { roleId: "r-1", roleCode: "Approver", apiPermissions: ["/workflow/save"], managementRole: false },
      ]);
    }
    if (url.endsWith("/platform/governance/organization")) {
      return okJson({ units: [], positions: [], memberships: [], positionAssignments: [], grants: [] });
    }
    if (url.endsWith("/platform/governance/policies")) {
      return okJson({ policies: [] });
    }
    if (url.endsWith("/platform/governance/role-policies")) {
      return okJson({ rolePolicies: [] });
    }
    if (url.endsWith("/platform/governance/policy-data-permissions")) {
      return okJson({ policyDataPermissions: [] });
    }
    if (url.endsWith("/product-governance/domain-grants")) {
      return okJson({ grants: [] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
});

describe("platform-ontology composite query", () => {
  it("exposes all four layers, declared layered object types, and 44 relation kinds directly from contracts", async () => {
    const schema = await readPlatformOntologySchema();
    const expectedTypes = Object.entries(platformObjectTypes).filter(([, decl]) => Boolean(decl.layer));
    expect(schema.layers).toEqual(["fact", "capability", "governance", "product"]);
    expect(schema.objectTypes).toHaveLength(expectedTypes.length);
    expect(schema.relationKinds).toBe(platformRelationKinds);
    expect(schema.relationKinds).toHaveLength(44);

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
    expect(Object.keys(agent?.reads ?? {})).toEqual(expect.arrayContaining(["createForm", "form", "list", "record"]));
    expect(agent?.operations?.map((op) => op.id)).toEqual(expect.arrayContaining([
      `${AGENT_DEFINITION}.save`, DELETE_AGENT, "agents.grant", "agents.revoke", "agents.share",
    ]));

    const application = byId.get(APPLICATION);
    expect(application?.definition).toBe(platformTypeDetails[APPLICATION]?.definition);
    expect(application?.reads).toMatchObject({
      available: { source: "type" },
      count: { source: "type" },
      query: { source: "type" },
      record: { source: "object" },
      usedPanels: { source: "object" },
      builderProjects: { source: "type" },
      builderProject: { source: "object" },
    });
    expect(application?.operations?.map((op) => op.id)).toContain(`${APPLICATION}.save`);

    const projection = byId.get(PRODUCT_PROJECTION);
    expect(projection?.definition).toBe(platformTypeDetails[PRODUCT_PROJECTION]?.definition);
    expect(Object.keys(projection?.reads ?? {}).sort()).toEqual([
      "componentOptions", "configRows", "createForm", "dataRows", "form", "grantRows", "grants",
      "inputRows", "objectTypeOptions", "operationRows", "outputRows", "query", "record",
      "referenceGraph", "usedBy", "usedByRows",
    ]);
    expect(projection?.operations?.map((op) => op.id)).toContain(`${PRODUCT_PROJECTION}.save`);

    const panel = byId.get(PRODUCT_PANEL);
    expect(panel?.definition).toBe(platformTypeDetails[PRODUCT_PANEL]?.definition);
    expect(panel?.reads?.unavailable).toMatchObject({
      source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList",
    });
    expect(panel?.operations?.map((op) => op.id)).toContain(`${PRODUCT_PANEL}.save`);

    const sdkComponent = byId.get(SDK_COMPONENT);
    expect(Object.keys(sdkComponent?.reads ?? {})).toEqual(expect.arrayContaining([
      "catalogue", "configRows", "dataRows", "definition", "inputRows", "operationRows", "outputRows", "record",
    ]));
    expect(sdkComponent?.operations).toBeUndefined();

    const action = byId.get("platform:Action");
    expect(Object.keys(action?.reads ?? {})).toEqual(expect.arrayContaining([
      "annotatedExplanation", "createForm", "definition", "derivedConditions", "derivedEffects",
      "derivedParameters", "derivedSummary", "explanation", "form", "list", "record",
    ]));

    const role = byId.get(ROLE);
    expect(Object.keys(role?.reads ?? {}).sort()).toEqual(["createForm", "form", "options", "query", "record", "resolve"]);
    expect(role?.operations?.map((op) => op.id)).toEqual([`${ROLE}.save`, DELETE_ROLE]);

    const definition = byId.get(DEFINITION);
    expect(definition?.reads).toBeUndefined();
    expect(definition?.operations).toBeUndefined();
  });

  it("coalesces shared owners in counts and separates ok, refused, and failed statuses across all four layers", async () => {
    vi.mocked(assertManagement).mockRejectedValueOnce(new HttpError(403, "Cannot read the skill library", "PERMISSION_DENIED"));
    allowedUseIds.mockReturnValue(["proj-kb", "panel-main"]);
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
            entry: { path: "/applications/app-kb", renderer: "panels", entryKey: "kb" },
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
    expect(byType.get("platform:AgentDefinition")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Trigger")).toMatchObject({ status: "failed" });
    expect(byType.get("platform:SDKComponent")).toMatchObject({ status: "ok", count: 3 });
    expect(byType.get("platform:ProductProjection")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:ProductPanel")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Application")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:ApplicationPanelUse")).toBeUndefined();

    // /admin/getMetas must be called only once across ObjectType + Attribute + Relationship
    const metaCalls = vi.mocked(backendPost).mock.calls.filter(([, url]) => String(url).endsWith("/admin/getMetas"));
    expect(metaCalls).toHaveLength(1);
    // The shared owner reads one facts batch per product kind across both counts.
    expect(decideProductObjects.mock.calls.map(([requests]) => requests.map(request => "target" in request && request.target.kind)))
      .toEqual(expect.arrayContaining([["PANEL"], ["PROJECTION"]]));
    expect(decideProductObjects).toHaveBeenCalledTimes(2);
    expect(listAgentDefinitions).toHaveBeenCalledWith(owner, credentials);
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

  it.each([
    { className: USER, primaryKey: "missing" },
    { className: ONTOLOGY_TYPE, primaryKey: "platform:Nope" },
  ])("rejects an unknown center $className~$primaryKey", async (node) => {
    await expect(readPlatformOntologyNeighbors(owner, credentials, { node }))
      .rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
  });

  it.each([
    { upstreamStatus: 403, status: 403, code: "FORBIDDEN" },
    { upstreamStatus: 500, status: 502, code: "UPSTREAM_FAILED" },
  ])("rejects an unreadable center with $status $code", async ({ upstreamStatus, status, code }) => {
    vi.mocked(backendPost).mockRejectedValueOnce(new BackendResponseError(
      upstreamStatus, JSON.stringify({ message: "Cannot read subjects" }),
    ));

    await expect(readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: USER, primaryKey: "other-user" },
    })).rejects.toMatchObject({ status, code });
  });

  it("rejects a center whose type has no owner adapter", async () => {
    await expect(readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: SCHEDULED_TASK, primaryKey: "task-1" },
    })).rejects.toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
  });

  it.each(["refused", "unavailable"] as const)("keeps the caller's start and relations when subjects are %s", async (status) => {
    if (status === "refused") {
      vi.mocked(backendPost).mockRejectedValueOnce(new BackendResponseError(
        403, JSON.stringify({ message: "Cannot read subjects" }),
      ));
    } else {
      const readers: {
        subjects(): Promise<
          Awaited<ReturnType<PlatformOntologyOwnerReaders["subjects"]>> |
          { ok: false; status: "unavailable"; reason: string }
        >;
      } = PlatformOntologyOwnerReaders.prototype;
      vi.spyOn(readers, "subjects").mockResolvedValue({ ok: false, status, reason: "Subjects unavailable" });
    }

    const node = { className: USER, primaryKey: owner.userId };
    const neighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node,
      relationKinds: ["user.created-action"],
    }, "Alice Fallback");

    expect(neighbors.node).toMatchObject({ ...node, label: "Alice Fallback" });
    expect(neighbors.edges).toContainEqual(expect.objectContaining({
      relationKind: "user.created-action",
      from: node,
      to: { className: ACTION, primaryKey: "act-1" },
    }));
  });

  it("expands 1-hop neighbors for a User with both outgoing and incoming edges and isolates per-relation 403 refusal", async () => {
    const res = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:User", primaryKey: "user-1" },
    });

    expect(res.node).toMatchObject({ className: "platform:User", primaryKey: "user-1", label: "Alice", layer: "governance" });

    // Alice created & published act-1 (two distinct edges), created wf-1, created & published metric-1, holds role r-1 (Approver)
    const edgeKinds = res.edges.map((e) => `${e.relationKind}:${e.to.primaryKey}`).sort();
    expect(edgeKinds).toEqual([
      "agent.executes-as-user:user-1",
      "user.created-action:act-1",
      "user.created-metric-view:metric-1",
      "user.created-workflow:wf-1",
      "user.holds-role:r-1",
      "user.published-action:act-1",
      "user.published-metric-view:metric-1",
    ]);
    expect(res.neighbors).toContainEqual({
      className: ROLE,
      primaryKey: "r-1",
      label: "Approver",
      layer: "governance",
    });

    const statusByKind = new Map(res.relations.map((r) => [r.relationKind, r]));
    expect(statusByKind.get("agent.executes-as-user")).toMatchObject({ status: "ok", edgeCount: 1 });
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

    vi.mocked(listAgentDefinitions).mockRejectedValueOnce(new HttpError(403, "Grant read refused", "PRODUCT_FORBIDDEN"));
    const refusedRes = await readPlatformOntologyObjects(owner, credentials, {
      type: "platform:AgentDefinition",
    });
    expect(refusedRes.status).toBe("refused");
    expect(refusedRes.items).toEqual([]);
  });

  it("resolves real product-layer relations including merged projection bindings, panel containment, skills, and applications", async () => {
    allowedUseIds.mockReturnValue([
      "proj-kb-list",
      "proj-kb-form",
      "proj-kb-approve-only",
      "proj-order-actions",
      "proj-chart",
      "proj-tasks",
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
        id: "proj-tasks",
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
          manifest: { state: {}, members: {} },
        },
      },
      {
        id: "panel-tab-candidate",
        definition: {
          name: "Tab Candidate",
          description: "",
          visibility: "domain",
          content: { html: "<div></div>", module: "export default {};" },
          manifest: { state: {}, members: {} },
        },
      },
      {
        id: "panel-placement-candidate",
        definition: {
          name: "Placement Candidate",
          description: "",
          visibility: "domain",
          content: { html: "<div></div>", module: "export default {};" },
          manifest: { state: {}, members: {} },
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
            entry: { path: "/applications/app-ops", renderer: "panels", entryKey: "main" },
            scheduleAdapter: null,
            releaseId: null,
            panelUses: [
              {
                id: "use-main",
                panelId: "panel-main",
                path: "/applications/app-ops/main",
                pageKey: "main",
                names: { en: "Main" },
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

    // 5. MetricChart skips the unlayered DashboardCard, and Task List binds its declared capability type.
    const chartNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "proj-chart" },
      relationKinds: ["projection.binds-target"],
    });
    expect(chartNeighbors.edges).toHaveLength(1);
    expect(chartNeighbors.edges[0]).toMatchObject({
      to: { className: "platform:MetricView", primaryKey: "metric-1" },
    });
    const taskNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "proj-tasks" },
      relationKinds: ["projection.binds-target"],
    });
    expect(taskNeighbors.edges).toHaveLength(1);
    expect(taskNeighbors.edges[0]).toMatchObject({
      to: { className: ONTOLOGY_TYPE, primaryKey: SCHEDULED_TASK },
      binding: { reads: ["list"] },
    });

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

    // 9. A refused skill library read isolates panel.provides-skill.
    vi.mocked(assertManagement).mockRejectedValueOnce(new HttpError(403, "Cannot read the skill library", "PERMISSION_DENIED"));
    const refusedSkillPanel = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductPanel", primaryKey: "panel-main" },
      relationKinds: ["panel.provides-skill"],
    });
    expect(refusedSkillPanel.relations).toEqual([
      expect.objectContaining({ relationKind: "panel.provides-skill", status: "refused", edgeCount: 0 }),
    ]);
  });

  it("retains builtin projection and child panel edges admitted by product USE", async () => {
    const builtinProjRow = {
      id: "builtin-product-map-graph",
      definition: {
        name: "Capability Map Graph",
        description: "",
        visibility: "platform",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: {},
        data: {
          rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} },
        },
        config: {},
      },
    };
    const builtinChildPanelRow = {
      id: "builtin-product-child-panel",
      definition: {
        name: "Builtin Child Panel",
        description: "",
        visibility: "platform",
        content: { html: "<div></div>", module: "export default {};" },
        manifest: { state: {}, members: {} },
      },
    };
    const builtinParentPanelRow = {
      id: "builtin-product-parent-panel",
      definition: {
        name: "Builtin Parent Panel",
        description: "",
        visibility: "platform",
        content: { html: "<section></section>", module: "export default {};" },
        manifest: {
          state: {},
          members: {
            graph: { target: { projectionId: "builtin-product-map-graph" } },
            child: { target: { panelId: "builtin-product-child-panel" } },
          },
        },
      },
    };
    const domainPanelUsingBuiltinRow = {
      id: "panel-domain-using-builtin",
      definition: {
        name: "Domain Panel Using Builtin",
        description: "",
        visibility: "domain",
        content: { html: "<section></section>", module: "export default {};" },
        manifest: {
          state: {},
          members: {
            builtinGraph: { target: { projectionId: "builtin-product-map-graph" } },
            builtinChild: { target: { panelId: "builtin-product-child-panel" } },
            ungrantedDomainProj: { target: { projectionId: "proj-not-granted" } },
            ungrantedDomainPanel: { target: { panelId: "panel-not-granted" } },
          },
        },
      },
    };

    allowedUseIds.mockReturnValue(["panel-domain-using-builtin", builtinProjRow.id, builtinParentPanelRow.id, builtinChildPanelRow.id]);
    pgQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("product_projections")) return { rows: [builtinProjRow] };
      if (sql.includes("product_panels")) {
        return { rows: [builtinParentPanelRow, builtinChildPanelRow, domainPanelUsingBuiltinRow] };
      }
      return { rows: [] };
    });

    const parentNeighbors = platformOntologyNeighborsResponseSchema.parse(
      await readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: "platform:ProductPanel", primaryKey: "builtin-product-parent-panel" },
        relationKinds: ["panel.contains-projection", "panel.contains-panel"],
      }),
    );

    expect(parentNeighbors.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationKind: "panel.contains-projection",
          direction: "outgoing",
          from: { className: "platform:ProductPanel", primaryKey: "builtin-product-parent-panel" },
          to: { className: "platform:ProductProjection", primaryKey: "builtin-product-map-graph" },
        }),
        expect.objectContaining({
          relationKind: "panel.contains-panel",
          direction: "outgoing",
          from: { className: "platform:ProductPanel", primaryKey: "builtin-product-parent-panel" },
          to: { className: "platform:ProductPanel", primaryKey: "builtin-product-child-panel" },
        }),
      ]),
    );
    expect(parentNeighbors.edges).toHaveLength(2);

    const domainPanelNeighbors = platformOntologyNeighborsResponseSchema.parse(
      await readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: "platform:ProductPanel", primaryKey: "panel-domain-using-builtin" },
        relationKinds: ["panel.contains-projection", "panel.contains-panel"],
      }),
    );
    expect(domainPanelNeighbors.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationKind: "panel.contains-projection",
          direction: "outgoing",
          from: { className: "platform:ProductPanel", primaryKey: "panel-domain-using-builtin" },
          to: { className: "platform:ProductProjection", primaryKey: "builtin-product-map-graph" },
        }),
        expect.objectContaining({
          relationKind: "panel.contains-panel",
          direction: "outgoing",
          from: { className: "platform:ProductPanel", primaryKey: "panel-domain-using-builtin" },
          to: { className: "platform:ProductPanel", primaryKey: "builtin-product-child-panel" },
        }),
      ]),
    );
    expect(domainPanelNeighbors.edges).toHaveLength(2);

    const incomingFromProjection = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductProjection", primaryKey: "builtin-product-map-graph" },
      relationKinds: ["panel.contains-projection"],
    });
    expect(incomingFromProjection.edges.map((e) => e.from.primaryKey).sort()).toEqual([
      "builtin-product-parent-panel",
      "panel-domain-using-builtin",
    ]);

    const incomingFromChild = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:ProductPanel", primaryKey: "builtin-product-child-panel" },
      relationKinds: ["panel.contains-panel"],
    });
    expect(incomingFromChild.edges.map((e) => e.from.primaryKey).sort()).toEqual([
      "builtin-product-parent-panel",
      "panel-domain-using-builtin",
    ]);
  });

  it("lists platform:Role objects keyed by roleId with roleCode labels and does not synthesize roles from workflow steps", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/workflow/platform-access")) {
        return okJson([
          { roleId: "r-1", roleCode: "Approver", apiPermissions: ["/workflow/save"], managementRole: false },
          { roleId: "r-nameless", roleCode: null, apiPermissions: [], managementRole: false },
        ]);
      }
      if (url.endsWith("/workflow/grants")) {
        return okJson([
          { roleId: "r-2", roleCode: "Operator", capabilityKind: "ACTION", capabilityId: "act-1", inForce: true },
          { roleId: null, roleCode: "LegacyNoId", capabilityKind: "ACTION", capabilityId: "act-1", inForce: true },
        ]);
      }
      if (url.endsWith("/workflow/query")) {
        return okJson([
          {
            id: "wf-1",
            name: "Order Approval",
            version: 2,
            steps: [
              { actionId: "act-1", roleCode: "Approver" },
              { actionId: "act-1", roleCode: "GhostStepRole" },
            ],
            createdBy: "user-1",
            reviewedBy: "user-2",
          },
        ]);
      }
      return baseImpl(endpoint, url, body, opts);
    });

    const rolesRes = await readPlatformOntologyObjects(owner, credentials, { type: ROLE });
    expect(rolesRes.status).toBe("ok");
    expect(rolesRes.items).toEqual([
      { node: { className: ROLE, primaryKey: "r-1" }, label: "Approver" },
      { node: { className: ROLE, primaryKey: "r-2" }, label: "Operator" },
      { node: { className: ROLE, primaryKey: "r-nameless" }, label: "r-nameless" },
    ]);
  });

  it("resolves all four role relations bidirectionally using roleId as primaryKey and rejects roleCode as primaryKey", async () => {
    const roleCenter = platformOntologyNeighborsResponseSchema.parse(
      await readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: ROLE, primaryKey: "r-1" },
      }),
    );

    expect(roleCenter.node).toEqual({
      className: ROLE,
      primaryKey: "r-1",
      label: "Approver",
      layer: "governance",
    });

    expect(roleCenter.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationKind: "user.holds-role",
          direction: "incoming",
          from: { className: USER, primaryKey: "user-1" },
          to: { className: ROLE, primaryKey: "r-1" },
        }),
        expect.objectContaining({
          relationKind: "role.can-execute-action",
          direction: "outgoing",
          from: { className: ROLE, primaryKey: "r-1" },
          to: { className: ACTION, primaryKey: "act-1" },
        }),
        expect.objectContaining({
          relationKind: "role.can-author-workflow",
          direction: "outgoing",
          from: { className: ROLE, primaryKey: "r-1" },
          to: { className: WORKFLOW, primaryKey: "wf-1" },
        }),
        expect.objectContaining({
          relationKind: "role.owns-workflow-step",
          direction: "outgoing",
          from: { className: ROLE, primaryKey: "r-1" },
          to: { className: WORKFLOW, primaryKey: "wf-1" },
        }),
      ]),
    );
    expect(roleCenter.edges).toHaveLength(4);

    // Reverse direction from Action and Workflow also emits roleId as primaryKey with roleCode label
    const actionNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ACTION, primaryKey: "act-1" },
      relationKinds: ["role.can-execute-action"],
    });
    expect(actionNeighbors.edges).toEqual([
      expect.objectContaining({
        relationKind: "role.can-execute-action",
        direction: "incoming",
        from: { className: ROLE, primaryKey: "r-1" },
        to: { className: ACTION, primaryKey: "act-1" },
      }),
    ]);
    expect(actionNeighbors.neighbors).toEqual([
      { className: ROLE, primaryKey: "r-1", label: "Approver", layer: "governance" },
    ]);

    const workflowNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: WORKFLOW, primaryKey: "wf-1" },
      relationKinds: ["role.can-author-workflow", "role.owns-workflow-step"],
    });
    expect(workflowNeighbors.edges.map((e) => `${e.relationKind}:${e.from.primaryKey}`).sort()).toEqual([
      "role.can-author-workflow:r-1",
      "role.owns-workflow-step:r-1",
    ]);
    expect(workflowNeighbors.neighbors).toEqual([
      { className: ROLE, primaryKey: "r-1", label: "Approver", layer: "governance" },
    ]);

    // Legacy roleCode primaryKey is no longer accepted
    await expect(
      readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: ROLE, primaryKey: "Approver" },
      }),
    ).rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
  });

  it("uses workflow authoring facts even when legacy platform access would allow another role", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/authorization/policies/graph-facts")) {
        return graphFacts({ roleWorkflowAuthoring: [{ roleId: "r-author", workflowId: "wf-1", policyId: "p-1", verb: "EDIT" }] });
      }
      if (url.endsWith("/workflow/platform-access")) {
        return okJson([{ roleId: "r-1", roleCode: "Approver", apiPermissions: ["/workflow/save"], managementRole: true }]);
      }
      return baseImpl(endpoint, url, body, opts);
    });
    const result = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: WORKFLOW, primaryKey: "wf-1" },
      relationKinds: ["role.can-author-workflow"],
    });
    expect(result.edges.map(edge => edge.from.primaryKey)).toEqual(["r-author"]);
  });

  it("shows independent action grants and deduplicates roles with step authorization", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/authorization/policies/graph-facts")) {
        return graphFacts({ roleActionGrants: [
          { roleId: "r-1", actionId: "act-1", policyId: "p-1" },
          { roleId: "r-standalone", actionId: "act-1", policyId: "p-2", scopeKind: "all" },
        ] });
      }
      return baseImpl(endpoint, url, body, opts);
    });
    const result = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ACTION, primaryKey: "act-1" },
      relationKinds: ["role.can-execute-action"],
    });
    expect(result.edges.map(edge => edge.from.primaryKey).sort()).toEqual(["r-1", "r-standalone"]);
  });

  it("keeps user.holds-role edges keyed by roleId even when /workflow/platform-access is refused", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/workflow/platform-access") || url.endsWith("/workflow/grants")) {
        throw new BackendResponseError(403, JSON.stringify({ message: "Role directory forbidden" }));
      }
      return baseImpl(endpoint, url, body, opts);
    });

    const res = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: USER, primaryKey: "user-1" },
      relationKinds: ["user.holds-role"],
    });

    expect(res.relations).toEqual([{ relationKind: "user.holds-role", status: "ok", edgeCount: 1 }]);
    expect(res.edges).toEqual([
      expect.objectContaining({
        relationKind: "user.holds-role",
        direction: "outgoing",
        from: { className: USER, primaryKey: "user-1" },
        to: { className: ROLE, primaryKey: "r-1" },
      }),
    ]);
    expect(res.neighbors).toEqual([
      { className: ROLE, primaryKey: "r-1", label: "r-1", layer: "governance" },
    ]);
  });

  it("maps workflow step roleCode to roleId, skips unknown step names, and surfaces role directory refusal/failure", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/workflow/query")) {
        return okJson([
          {
            id: "wf-1",
            name: "Order Approval",
            version: 2,
            steps: [
              { actionId: "act-1", roleCode: "Approver" },
              { actionId: "act-1", roleCode: "UnmatchedStepRole" },
            ],
            createdBy: "user-1",
            reviewedBy: "user-2",
          },
        ]);
      }
      return baseImpl(endpoint, url, body, opts);
    });

    const okRes = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: WORKFLOW, primaryKey: "wf-1" },
      relationKinds: ["role.owns-workflow-step"],
    });
    expect(okRes.relations).toEqual([{ relationKind: "role.owns-workflow-step", status: "ok", edgeCount: 1 }]);
    expect(okRes.edges).toEqual([
      expect.objectContaining({
        relationKind: "role.owns-workflow-step",
        from: { className: ROLE, primaryKey: "r-1" },
        to: { className: WORKFLOW, primaryKey: "wf-1" },
      }),
    ]);
    expect(okRes.neighbors).toEqual([
      { className: ROLE, primaryKey: "r-1", label: "Approver", layer: "governance" },
    ]);

    // When role directory is refused, relationStatus reports refused instead of ok with 0 edges
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/workflow/platform-access") || url.endsWith("/workflow/grants")) {
        throw new BackendResponseError(403, JSON.stringify({ message: "Role directory forbidden" }));
      }
      return baseImpl(endpoint, url, body, opts);
    });
    const refusedRes = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: WORKFLOW, primaryKey: "wf-1" },
      relationKinds: ["role.owns-workflow-step"],
    });
    expect(refusedRes.edges).toEqual([]);
    expect(refusedRes.relations).toEqual([
      expect.objectContaining({ relationKind: "role.owns-workflow-step", status: "refused", edgeCount: 0 }),
    ]);

    // When role directory fails, relationStatus reports failed
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/workflow/platform-access") || url.endsWith("/workflow/grants")) {
        throw new BackendResponseError(500, JSON.stringify({ message: "Role directory down" }));
      }
      return baseImpl(endpoint, url, body, opts);
    });
    const failedRes = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: WORKFLOW, primaryKey: "wf-1" },
      relationKinds: ["role.owns-workflow-step"],
    });
    expect(failedRes.edges).toEqual([]);
    expect(failedRes.relations).toEqual([
      expect.objectContaining({ relationKind: "role.owns-workflow-step", status: "failed", edgeCount: 0 }),
    ]);

    // When role directory is unavailable, relationStatus reports unavailable
    const readers: {
      roles(): Promise<
        Awaited<ReturnType<PlatformOntologyOwnerReaders["roles"]>> |
        { ok: false; status: "unavailable"; reason: string }
      >;
    } = PlatformOntologyOwnerReaders.prototype;
    vi.spyOn(readers, "roles").mockResolvedValueOnce({
      ok: false,
      status: "unavailable",
      reason: "Roles unavailable",
    });
    const unavailableRes = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: WORKFLOW, primaryKey: "wf-1" },
      relationKinds: ["role.owns-workflow-step"],
    });
    expect(unavailableRes.edges).toEqual([]);
    expect(unavailableRes.relations).toEqual([
      { relationKind: "role.owns-workflow-step", status: "unavailable", edgeCount: 0, reason: "Roles unavailable" },
    ]);
  });

  it("lists organization units, positions, permission policies, and localized org grants while excluding OrgMembership", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/platform/governance/organization")) {
        return okJson({
          units: [
            { id: "org-root", name: "Headquarters", code: "HQ", parentId: "0" },
            { id: "org-rd", name: "R&D", code: "RD", parentId: "org-root" },
            { id: "org-orphan", name: "Orphan", parentId: "missing-parent" },
          ],
          positions: [
            { id: "pos-arch", name: "Architect", orgId: "org-rd" },
          ],
          memberships: [
            { userId: "user-1", orgId: "org-rd" },
          ],
          positionAssignments: [
            { userId: "user-1", positionId: "pos-arch" },
          ],
          grants: [
            { id: "organization:org-rd", grantType: "organization", sourceId: "org-rd", roleIds: ["r-1"] },
            { id: "subtree:org-root", grantType: "subtree", sourceId: "org-root", roleIds: ["r-1"] },
            { id: "position:pos-arch", grantType: "position", sourceId: "pos-arch", roleIds: ["r-1"] },
            { id: "organization:deleted-org", grantType: "organization", sourceId: "deleted-org", roleIds: [] },
          ],
        });
      }
      if (url.endsWith("/platform/governance/policies")) {
        return okJson({
          policies: [
            { id: "pol-1", name: "Order Read Policy", type: 2, fullData: false, parentId: "0" },
          ],
        });
      }
      return baseImpl(endpoint, url, body, opts);
    });

    const { counts } = await readPlatformOntologyCounts(owner, credentials);
    const byType = new Map(counts.map((c) => [c.type, c]));
    expect(byType.get(ORG_UNIT)).toMatchObject({ layer: "fact", status: "ok", count: 3 });
    expect(byType.get(ORG_POSITION)).toMatchObject({ layer: "fact", status: "ok", count: 1 });
    expect(byType.get(PERMISSION_POLICY)).toMatchObject({ layer: "governance", status: "ok", count: 1 });
    expect(byType.get(ORG_GRANT)).toMatchObject({ layer: "governance", status: "ok", count: 4 });
    expect(byType.get(ORG_MEMBERSHIP)).toBeUndefined();
    expect(
      vi.mocked(backendPost).mock.calls.filter(([, url]) => String(url).endsWith("/product-governance/domain-grants")),
    ).toHaveLength(0);

    const units = await readPlatformOntologyObjects(owner, credentials, { type: ORG_UNIT });
    expect(units.items).toEqual([
      { node: { className: ORG_UNIT, primaryKey: "org-root" }, label: "Headquarters", detail: "HQ" },
      { node: { className: ORG_UNIT, primaryKey: "org-orphan" }, label: "Orphan" },
      { node: { className: ORG_UNIT, primaryKey: "org-rd" }, label: "R&D", detail: "RD" },
    ]);

    const positions = await readPlatformOntologyObjects(owner, credentials, { type: ORG_POSITION });
    expect(positions.items).toEqual([
      { node: { className: ORG_POSITION, primaryKey: "pos-arch" }, label: "Architect", detail: "R&D" },
    ]);

    const policies = await readPlatformOntologyObjects(owner, credentials, { type: PERMISSION_POLICY });
    expect(policies.items).toEqual([
      { node: { className: PERMISSION_POLICY, primaryKey: "pol-1" }, label: "Order Read Policy" },
    ]);

    const zhGrants = await readPlatformOntologyObjects(owner, credentials, { type: ORG_GRANT });
    expect(zhGrants.items.map((i) => ({ id: i.node.primaryKey, label: i.label }))).toEqual([
      { id: "position:pos-arch", label: "岗位 · Architect" },
      { id: "organization:deleted-org", label: "组织 · deleted-org" },
      { id: "organization:org-rd", label: "组织 · R&D" },
      { id: "subtree:org-root", label: "组织含下级 · Headquarters" },
    ]);

    const enGrants = await readPlatformOntologyObjects(owner, { ...credentials, locale: "en" }, { type: ORG_GRANT });
    expect(enGrants.items.map((i) => ({ id: i.node.primaryKey, label: i.label }))).toEqual([
      { id: "organization:deleted-org", label: "Organization · deleted-org" },
      { id: "organization:org-rd", label: "Organization · R&D" },
      { id: "subtree:org-root", label: "Organization & sub-units · Headquarters" },
      { id: "position:pos-arch", label: "Position · Architect" },
    ]);
  });

  it("evaluates all 7 organization relations bidirectionally without self-loops or root-0 edges", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/platform/governance/organization")) {
        return okJson({
          units: [
            { id: "org-root", name: "HQ", parentId: "0" },
            { id: "org-rd", name: "R&D", parentId: "org-root" },
            { id: "org-self", name: "Self", parentId: "org-self" },
            { id: "org-dangling", name: "Dangling", parentId: "non-existent" },
          ],
          positions: [{ id: "pos-arch", name: "Architect", orgId: "org-rd" }],
          memberships: [{ userId: "user-1", orgId: "org-rd" }],
          positionAssignments: [{ userId: "user-1", positionId: "pos-arch" }],
          grants: [
            { id: "organization:org-rd", grantType: "organization", sourceId: "org-rd", roleIds: ["r-1"] },
            { id: "subtree:org-root", grantType: "subtree", sourceId: "org-root", roleIds: ["r-1"] },
            { id: "position:pos-arch", grantType: "position", sourceId: "pos-arch", roleIds: ["r-1"] },
          ],
        });
      }
      return baseImpl(endpoint, url, body, opts);
    });

    const rdNeighbors = platformOntologyNeighborsResponseSchema.parse(
      await readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: ORG_UNIT, primaryKey: "org-rd" },
      }),
    );
    expect(rdNeighbors.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationKind: "org-unit.has-child",
          direction: "incoming",
          from: { className: ORG_UNIT, primaryKey: "org-root" },
          to: { className: ORG_UNIT, primaryKey: "org-rd" },
        }),
        expect.objectContaining({
          relationKind: "org-unit.has-position",
          direction: "outgoing",
          from: { className: ORG_UNIT, primaryKey: "org-rd" },
          to: { className: ORG_POSITION, primaryKey: "pos-arch" },
        }),
        expect.objectContaining({
          relationKind: "user.member-of-org-unit",
          direction: "incoming",
          from: { className: USER, primaryKey: "user-1" },
          to: { className: ORG_UNIT, primaryKey: "org-rd" },
        }),
        expect.objectContaining({
          relationKind: "org-grant.applies-to-org-unit",
          direction: "incoming",
          from: { className: ORG_GRANT, primaryKey: "organization:org-rd" },
          to: { className: ORG_UNIT, primaryKey: "org-rd" },
        }),
      ]),
    );
    expect(rdNeighbors.edges).toHaveLength(4);

    // Self-loop and dangling parent produce no org-unit.has-child edges
    const selfNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ORG_UNIT, primaryKey: "org-self" },
      relationKinds: ["org-unit.has-child"],
    });
    expect(selfNeighbors.edges).toEqual([]);

    const danglingNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ORG_UNIT, primaryKey: "org-dangling" },
      relationKinds: ["org-unit.has-child"],
    });
    expect(danglingNeighbors.edges).toEqual([]);

    // Root outgoing child + subtree grant incoming
    const rootNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ORG_UNIT, primaryKey: "org-root" },
      relationKinds: ["org-unit.has-child", "org-grant.applies-to-org-unit"],
    });
    expect(rootNeighbors.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationKind: "org-unit.has-child",
          direction: "outgoing",
          from: { className: ORG_UNIT, primaryKey: "org-root" },
          to: { className: ORG_UNIT, primaryKey: "org-rd" },
        }),
        expect.objectContaining({
          relationKind: "org-grant.applies-to-org-unit",
          direction: "incoming",
          from: { className: ORG_GRANT, primaryKey: "subtree:org-root" },
          to: { className: ORG_UNIT, primaryKey: "org-root" },
        }),
      ]),
    );

    // Position incoming from unit, user, and position org-grant
    const posNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ORG_POSITION, primaryKey: "pos-arch" },
    });
    expect(posNeighbors.edges.map((e) => `${e.relationKind}:${e.direction}:${e.from.primaryKey}`).sort()).toEqual([
      "org-grant.applies-to-org-position:incoming:position:pos-arch",
      "org-unit.has-position:incoming:org-rd",
      "user.holds-org-position:incoming:user-1",
    ]);

    // OrgGrant outgoing to position & role, and reverse from Role
    const grantNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ORG_GRANT, primaryKey: "position:pos-arch" },
    });
    expect(grantNeighbors.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationKind: "org-grant.applies-to-org-position",
          direction: "outgoing",
          to: { className: ORG_POSITION, primaryKey: "pos-arch" },
        }),
        expect.objectContaining({
          relationKind: "org-grant.grants-role",
          direction: "outgoing",
          to: { className: ROLE, primaryKey: "r-1" },
        }),
      ]),
    );
    expect(grantNeighbors.neighbors).toContainEqual({
      className: ROLE,
      primaryKey: "r-1",
      label: "Approver",
      layer: "governance",
    });

    const roleGrantIncoming = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ROLE, primaryKey: "r-1" },
      relationKinds: ["org-grant.grants-role"],
    });
    expect(roleGrantIncoming.edges.map((e) => e.from.primaryKey).sort()).toEqual([
      "organization:org-rd",
      "position:pos-arch",
      "subtree:org-root",
    ]);

    // User outgoing to org unit and position
    const userOrgNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: USER, primaryKey: "user-1" },
      relationKinds: ["user.member-of-org-unit", "user.holds-org-position"],
    });
    expect(userOrgNeighbors.edges.map((e) => `${e.relationKind}:${e.to.primaryKey}`).sort()).toEqual([
      "user.holds-org-position:pos-arch",
      "user.member-of-org-unit:org-rd",
    ]);
  });

  it("evaluates permission policy relations bidirectionally with per-endpoint authorization isolation", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/platform/governance/policies")) {
        throw new BackendResponseError(403, JSON.stringify({ message: "Policies forbidden" }));
      }
      if (url.endsWith("/platform/governance/role-policies")) {
        return okJson({ rolePolicies: [{ roleId: "r-1", policyId: "pol-1" }] });
      }
      if (url.endsWith("/platform/governance/policy-data-permissions")) {
        throw new BackendResponseError(403, JSON.stringify({ message: "Data perms forbidden" }));
      }
      return baseImpl(endpoint, url, body, opts);
    });

    // role.uses-permission-policy succeeds even when /policies and /policy-data-permissions are 403
    const rolePolicyRes = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ROLE, primaryKey: "r-1" },
      relationKinds: ["role.uses-permission-policy"],
    });
    expect(rolePolicyRes.relations).toEqual([
      { relationKind: "role.uses-permission-policy", status: "ok", edgeCount: 1 },
    ]);
    expect(rolePolicyRes.edges).toEqual([
      expect.objectContaining({
        relationKind: "role.uses-permission-policy",
        direction: "outgoing",
        from: { className: ROLE, primaryKey: "r-1" },
        to: { className: PERMISSION_POLICY, primaryKey: "pol-1" },
      }),
    ]);
    expect(rolePolicyRes.neighbors).toEqual([
      { className: PERMISSION_POLICY, primaryKey: "pol-1", label: "pol-1", layer: "governance" },
    ]);

    // permission-policy.governs-object-type from ObjectType succeeds even when /policies and /role-policies are 403
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/platform/governance/policies") || url.endsWith("/platform/governance/role-policies")) {
        throw new BackendResponseError(403, JSON.stringify({ message: "Forbidden" }));
      }
      if (url.endsWith("/platform/governance/policy-data-permissions")) {
        return okJson({ policyDataPermissions: [{ policyId: "pol-1", className: "Order" }] });
      }
      return baseImpl(endpoint, url, body, opts);
    });

    const objectTypePolicyRes = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: OBJECT_TYPE, primaryKey: "Order" },
      relationKinds: ["permission-policy.governs-object-type"],
    });
    expect(objectTypePolicyRes.relations).toEqual([
      { relationKind: "permission-policy.governs-object-type", status: "ok", edgeCount: 1 },
    ]);
    expect(objectTypePolicyRes.edges).toEqual([
      expect.objectContaining({
        relationKind: "permission-policy.governs-object-type",
        direction: "incoming",
        from: { className: PERMISSION_POLICY, primaryKey: "pol-1" },
        to: { className: OBJECT_TYPE, primaryKey: "Order" },
      }),
    ]);

    // When /policies is readable, expanding from PermissionPolicy traverses both incoming role and outgoing object type
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/platform/governance/policies")) {
        return okJson({ policies: [{ id: "pol-1", name: "Order Read Policy" }] });
      }
      if (url.endsWith("/platform/governance/role-policies")) {
        return okJson({ rolePolicies: [{ roleId: "r-1", policyId: "pol-1" }] });
      }
      if (url.endsWith("/platform/governance/policy-data-permissions")) {
        return okJson({ policyDataPermissions: [{ policyId: "pol-1", className: "Order" }] });
      }
      return baseImpl(endpoint, url, body, opts);
    });

    const policyCenterRes = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: PERMISSION_POLICY, primaryKey: "pol-1" },
    });
    expect(policyCenterRes.node).toEqual({
      className: PERMISSION_POLICY,
      primaryKey: "pol-1",
      label: "Order Read Policy",
      layer: "governance",
    });
    expect(policyCenterRes.edges.map((e) => `${e.relationKind}:${e.direction}`).sort()).toEqual([
      "permission-policy.governs-object-type:outgoing",
      "role.uses-permission-policy:incoming",
    ]);
  });

  it("evaluates all 6 product grant relations bidirectionally, skips domain:*:use and projections, and annotates domain-shared details", async () => {
    const panelRow = {
      id: "panel-1",
      definition: {
        name: "Order Overview Panel",
        description: "Shows live orders",
        visibility: "domain",
        content: { html: "<section></section>", module: "export default {};" },
        manifest: { state: {}, members: {} },
      },
    };
    const barePanelRow = {
      id: "panel-bare",
      definition: {
        name: "Bare Shared Panel",
        description: "",
        visibility: "domain",
        content: { html: "<section></section>", module: "export default {};" },
        manifest: { state: {}, members: {} },
      },
    };
    const projRow = {
      id: "proj-1",
      definition: {
        name: "Order Table Projection",
        description: "",
        componentId: "@ontomato/sdk:ObjectList",
        visibility: "domain",
        data: {},
        config: {},
      },
    };

    allowedUseIds.mockReturnValue(["panel-1", "panel-bare", "proj-1"]);
    pgQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("product_panels")) return { rows: [panelRow, barePanelRow] };
      if (sql.includes("product_projections")) return { rows: [projRow] };
      return { rows: [] };
    });
    vi.mocked(backendGet).mockImplementation(async (_endpoint, url) => {
      if (url.includes("/platform/applications?purpose=navigation")) {
        return okJson([
          {
            id: "app-1",
            kind: "product",
            names: { en: "Order Workspace", "zh-CN": "订单工作台" },
            descriptions: {},
            icon: "grid",
            rail: "apps",
            category: "business",
            sort: 1,
            entry: { path: "/applications/app-1", renderer: "panels", entryKey: "main" },
            scheduleAdapter: null,
            releaseId: null,
            panelUses: [],
          },
        ]);
      }
      throw new Error(`Unexpected GET URL: ${url}`);
    });

    const domainGrants = [
      { resourceId: "agent-1", principalKind: "domain", principalId: "*", verb: "use" },
      { resourceId: "panel-1", principalKind: "domain", principalId: "*", verb: "use" },
      { resourceId: "panel-bare", principalKind: "domain", principalId: "*", verb: "use" },
      { resourceId: "app-1", principalKind: "domain", principalId: "*", verb: "use" },
      { resourceId: "agent-1", principalKind: "role", principalId: "r-1", principalName: "Approver", verb: "use" },
      { resourceId: "agent-1", principalKind: "role", principalId: "r-1", principalName: "Approver", verb: "view" },
      { resourceId: "agent-1", principalKind: "role", principalId: "r-1", principalName: "Approver", verb: "edit" },
      { resourceId: "panel-1", principalKind: "role", principalId: "r-1", principalName: "Approver", verb: "use" },
      { resourceId: "panel-1", principalKind: "role", principalId: "r-1", principalName: "Approver", verb: "view" },
      { resourceId: "app-1", principalKind: "role", principalId: "r-1", principalName: "Approver", verb: "edit" },
      { resourceId: "proj-1", principalKind: "role", principalId: "r-1", principalName: "Approver", verb: "use" },
      { resourceId: "agent-1", principalKind: "principal", principalId: "user-1", principalName: "Alice Display", verb: "use" },
      { resourceId: "agent-1", principalKind: "principal", principalId: "user-1", principalName: "Alice Display", verb: "view" },
      { resourceId: "panel-1", principalKind: "principal", principalId: "user-1", principalName: "Alice Display", verb: "edit" },
      { resourceId: "proj-1", principalKind: "principal", principalId: "user-1", principalName: "Alice Display", verb: "edit" },
    ];

    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/product-governance/domain-grants")) {
        return okJson({ grants: domainGrants });
      }
      return baseImpl(endpoint, url, body, opts);
    });

    // 1. Role outgoing product grant edges
    const roleProductEdges = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ROLE, primaryKey: "r-1" },
      relationKinds: ["role.can-use-product", "role.can-view-product", "role.can-edit-product"],
    });
    expect(
      roleProductEdges.edges.map((e) => `${e.relationKind}:${e.to.className}:${e.to.primaryKey}`).sort(),
    ).toEqual([
      "role.can-edit-product:platform:AgentDefinition:agent-1",
      "role.can-edit-product:platform:Application:app-1",
      "role.can-use-product:platform:AgentDefinition:agent-1",
      "role.can-use-product:platform:ProductPanel:panel-1",
      "role.can-view-product:platform:AgentDefinition:agent-1",
    ]);
    // Domain-shared details appear on neighbor product nodes
    expect(roleProductEdges.neighbors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: AGENT_DEFINITION,
          primaryKey: "agent-1",
          detail: "enabled · 全本域可用",
        }),
        expect.objectContaining({
          className: PRODUCT_PANEL,
          primaryKey: "panel-1",
          detail: "Shows live orders · 全本域可用",
        }),
        expect.objectContaining({
          className: APPLICATION,
          primaryKey: "app-1",
          detail: "product · 全本域可用",
        }),
      ]),
    );

    // 2. User outgoing product grant edges (proj-1 skipped, domain:*:use never expanded)
    const userProductEdges = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: USER, primaryKey: "user-1" },
      relationKinds: ["user.can-use-product", "user.can-view-product", "user.can-edit-product"],
    });
    expect(
      userProductEdges.edges.map((e) => `${e.relationKind}:${e.to.className}:${e.to.primaryKey}`).sort(),
    ).toEqual([
      "user.can-edit-product:platform:ProductPanel:panel-1",
      "user.can-use-product:platform:AgentDefinition:agent-1",
      "user.can-view-product:platform:AgentDefinition:agent-1",
    ]);

    // 3. Object list carries domain-shared detail for Agent, Panel (with & without base description), and Application
    const panelList = await readPlatformOntologyObjects(owner, credentials, { type: PRODUCT_PANEL });
    expect(panelList.items).toEqual([
      { node: { className: PRODUCT_PANEL, primaryKey: "panel-bare" }, label: "Bare Shared Panel", detail: "全本域可用" },
      { node: { className: PRODUCT_PANEL, primaryKey: "panel-1" }, label: "Order Overview Panel", detail: "Shows live orders · 全本域可用" },
    ]);

    // 4. Reverse direction from Agent uses principalName when subjects/roles directories are refused
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/product-governance/domain-grants")) {
        return okJson({ grants: domainGrants });
      }
      if (url.endsWith("/workflow/subjects") || url.endsWith("/workflow/platform-access") || url.endsWith("/workflow/grants")) {
        throw new BackendResponseError(403, JSON.stringify({ message: "Identity directory forbidden" }));
      }
      return baseImpl(endpoint, url, body, opts);
    });

    const agentIncoming = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: AGENT_DEFINITION, primaryKey: "agent-1" },
      relationKinds: [
        "role.can-use-product", "role.can-view-product", "role.can-edit-product",
        "user.can-use-product", "user.can-view-product", "user.can-edit-product",
      ],
    });
    expect(agentIncoming.node.detail).toBe("enabled · 全本域可用");
    expect(agentIncoming.edges.map((e) => `${e.relationKind}:${e.from.primaryKey}`).sort()).toEqual([
      "role.can-edit-product:r-1",
      "role.can-use-product:r-1",
      "role.can-view-product:r-1",
      "user.can-use-product:user-1",
      "user.can-view-product:user-1",
    ]);
    expect(agentIncoming.neighbors).toEqual(
      expect.arrayContaining([
        { className: ROLE, primaryKey: "r-1", label: "Approver", layer: "governance" },
        { className: USER, primaryKey: "user-1", label: "Alice Display", layer: "governance" },
      ]),
    );

    // 5. From ProductPanel, can-view-product is not applicable; only use/edit emit edges
    const panelIncoming = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: PRODUCT_PANEL, primaryKey: "panel-1" },
      relationKinds: [
        "role.can-use-product", "role.can-view-product", "role.can-edit-product",
        "user.can-use-product", "user.can-view-product", "user.can-edit-product",
      ],
    });
    expect(panelIncoming.edges.map((e) => `${e.relationKind}:${e.from.primaryKey}`).sort()).toEqual([
      "role.can-use-product:r-1",
      "user.can-edit-product:user-1",
    ]);

    // 6. When one product catalog (AgentDefinition) is refused, Role still gets edges to readable panels & apps
    vi.mocked(listAgentDefinitions).mockRejectedValueOnce(new HttpError(403, "Grant read refused", "PRODUCT_FORBIDDEN"));
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/product-governance/domain-grants")) {
        return okJson({ grants: domainGrants });
      }
      return baseImpl(endpoint, url, body, opts);
    });
    const partialCatalogRes = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ROLE, primaryKey: "r-1" },
      relationKinds: ["role.can-use-product", "role.can-edit-product"],
    });
    expect(partialCatalogRes.edges.map((e) => `${e.relationKind}:${e.to.primaryKey}`).sort()).toEqual([
      "role.can-edit-product:app-1",
      "role.can-use-product:panel-1",
    ]);

    // 7. When /product-governance/domain-grants returns 403, product grant relations report refused and product nodes render without shared tag
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/product-governance/domain-grants")) {
        throw new BackendResponseError(403, JSON.stringify({ message: "Domain grants forbidden" }));
      }
      return baseImpl(endpoint, url, body, opts);
    });
    const refusedGrants = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ROLE, primaryKey: "r-1" },
      relationKinds: ["role.can-use-product", "role.can-view-product"],
    });
    expect(refusedGrants.relations).toEqual([
      expect.objectContaining({ relationKind: "role.can-use-product", status: "refused", edgeCount: 0 }),
      expect.objectContaining({ relationKind: "role.can-view-product", status: "refused", edgeCount: 0 }),
    ]);

    const agentsWithoutGrants = await readPlatformOntologyObjects(owner, credentials, { type: AGENT_DEFINITION });
    expect(agentsWithoutGrants.status).toBe("ok");
    expect(agentsWithoutGrants.items).toEqual([
      { node: { className: AGENT_DEFINITION, primaryKey: "agent-1" }, label: "Ops Assistant", detail: "enabled" },
    ]);
  });
});
