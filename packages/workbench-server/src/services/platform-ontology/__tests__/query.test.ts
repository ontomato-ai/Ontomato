import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerFixture } from "../../scheduling/__tests__/fixtures";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import {
  platformOntologyCountsResponseSchema,
  platformOntologyNeighborsResponseSchema,
  platformOntologySchemaResponseSchema,
} from "@ontomato/contracts/platform-ontology";
import {
  ACTION,
  ADD_ROLE_MEMBERS,
  ADD_ROLE_POLICIES,
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
  REMOVE_ROLE_MEMBERS,
  REMOVE_ROLE_POLICIES,
  ROLE,
  TRIGGER,
  SDK_COMPONENT,
  USER,
  WORKFLOW,
  platformObjectTypes,
  platformRelationGroups,
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
import type { AssistantCredentials } from "../../../platform/agent-runtime/runtime";
import { countVisibleAgentDefinitions } from "../../assistant/definitions";
import { listAgentDefinitionNodes, listAgentExecutionUserRelations, listAgentSkillRelations } from "../../assistant/definition-relations";
import { assistantSkillCatalog, countAssistantSkills } from "../../assistant/skills";
import { countPublishedDefinitions, listPublishedDefinitions } from "../../business-definitions/definitions";
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
vi.mock("../../assistant/definitions", () => ({ countVisibleAgentDefinitions: vi.fn() }));
vi.mock("../../assistant/definition-relations", () => ({
  listAgentDefinitionNodes: vi.fn(), listAgentExecutionUserRelations: vi.fn(), listAgentSkillRelations: vi.fn(),
}));
vi.mock("../../assistant/skills", () => ({
  assistantSkillCatalog: vi.fn(),
  countAssistantSkills: vi.fn(),
}));
vi.mock("../../business-definitions/definitions", () => ({
  countPublishedDefinitions: vi.fn(),
  listPublishedDefinitions: vi.fn(),
}));
vi.mock("../../product-governance/authorization", async original => ({
  ...await original<typeof import("../../product-governance/authorization")>(),
  decideObjects: (requests: ObjectDecisionRequest[], viewer: AssistantCredentials) => decideProductObjects(requests, viewer),
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
function productDecisions(requests: readonly ObjectDecisionRequest[]) {
  return requests.map(request => {
    if (!("target" in request) || !["PANEL", "PROJECTION"].includes(request.target.kind))
      throw new Error("Expected product definition access");
    expect(request.target.domainId).toBe(owner.domainId);
    expect(request.ownerFacts).toEqual({
      ownerId: request.target.id.startsWith("builtin-product-") ? null : owner.userId, state: "PUBLISHED",
    });
    return request.verb === "USE" && allowedUseIds().includes(request.target.id)
      ? { allowed: true as const } : { allowed: false as const, code: "FORBIDDEN", reason: "Not admitted" };
  });
}
const decideProductObjects = vi.fn<[readonly ObjectDecisionRequest[], AssistantCredentials], Promise<ReturnType<typeof productDecisions>>>();

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
    text: JSON.stringify({ policyGrants: [], rolePolicies: [], domainPolicyId: "default", entries: [], ...data }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertManagement).mockResolvedValue(undefined);
  vi.mocked(countVisibleAgentDefinitions).mockResolvedValue(1);
  vi.mocked(countPublishedDefinitions).mockResolvedValue(1);
  vi.mocked(countAssistantSkills).mockResolvedValue(1);

  vi.mocked(getPostgresPool).mockReturnValue({
    query: async (sql: string, params?: unknown[]) => {
      const result = await pgQueryMock(sql, params);
      if (sql.startsWith('SELECT id, domain_id AS "domainId", owner_id AS "ownerId"')) {
        expect(params).toEqual([owner.domainId]);
        return { rows: result.rows.map(({ id }: { id: string }) => {
          const builtin = id.startsWith("builtin-product-");
          return { id, domainId: builtin ? null : owner.domainId, ownerId: builtin ? null : owner.userId };
        }) };
      }
      if (sql.startsWith('SELECT id, definition') && sql.includes('id=ANY($2::text[])') && Array.isArray(params?.[1])) {
        const ids = new Set(params[1]);
        return { rows: result.rows.filter(({ id }: { id: string }) => ids.has(id)) };
      }
      return result;
    },
  } as unknown as ReturnType<typeof getPostgresPool>);

  allowedUseIds.mockReturnValue([]);
  decideProductObjects.mockImplementation(async requests => productDecisions(requests));
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
    if (url.endsWith("/platform/triggers")) return {
      ...okJson(null), text: JSON.stringify({ timeZone: "UTC", tasks: [
        triggerFixture,
        { ...triggerFixture, id: "tr-2", title: "Immediate Approve", targetKind: "action", targetId: "act-1", content: { parameters: {} } },
      ] }),
    };
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

  const agent = { id: "agent-1", name: "Ops Assistant" };
  vi.mocked(countVisibleAgentDefinitions).mockResolvedValue(1);
  vi.mocked(listAgentDefinitionNodes).mockResolvedValue([{ ...agent, enabled: true }]);
  vi.mocked(listAgentSkillRelations).mockResolvedValue([{
    ...agent, skills: [{ namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" }],
  }]);
  vi.mocked(listAgentExecutionUserRelations).mockResolvedValue([{ ...agent, executionUserId: "user-1" }]);

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
        {
          roleId: "r-1", roleCode: "Approver", capabilityKind: "ACTION", capabilityId: "act-1",
          workflowId: "wf-1", stepNo: 1, activatedByWorkflowVersion: "2", scope: { kind: "all" }, inForce: true,
        },
        {
          roleId: "r-1", roleCode: "Approver", capabilityKind: "ACTION", capabilityId: "act-retired",
          workflowId: "wf-1", stepNo: 2, activatedByWorkflowVersion: "1", scope: { kind: "all" }, inForce: false,
        },
      ]);
    }
    if (url.endsWith("/authorization/policies/graph-facts")) {
      return graphFacts();
    }
    if (url.endsWith("/workflow/platform-access")) {
      return okJson([
        { roleId: "r-1", roleCode: "Approver", managementOperations: [], managementRole: false },
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
    throw new Error(`Unexpected URL: ${url}`);
  });
});

describe("platform-ontology composite query", () => {
  it("exposes all four layers, declared layered object types, and every declared relation kind directly from contracts", async () => {
    const schema = await readPlatformOntologySchema();
    const expectedTypes = Object.entries(platformObjectTypes).filter(([, decl]) => Boolean(decl.layer));
    expect(schema.layers).toEqual(["fact", "capability", "governance", "product"]);
    expect(schema.objectTypes).toHaveLength(expectedTypes.length);
    expect(schema.relationKinds).toBe(platformRelationKinds);

    expect(schema.objectTypes.map((t) => t.id)).toEqual(expectedTypes.map(([id]) => id));
    expect(schema.objectTypes.every((t) => t.labelKey.startsWith("platformOntology.types."))).toBe(true);
    expect(schema.relationKinds.every((r) => r.labelKey === `platformOntology.relations.${r.id}`)).toBe(true);
    expect(schema.relationKinds.every((r) => platformRelationGroups.includes(r.group))).toBe(true);

    const derivedIds = schema.relationKinds.filter((r) => r.derived).map((r) => r.id);
    expect(derivedIds).toEqual(["role.owns-workflow-step", "panel.provides-skill"]);

    expect(platformOntologySchemaResponseSchema.parse(schema)).toEqual(schema);

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
    expect(Object.keys(role?.reads ?? {}).sort()).toEqual([
      "contributionPolicies", "contributionWorkflowSteps", "count",
      "createForm", "form", "memberCandidates", "members", "options",
      "policies", "policyCandidates", "query", "record", "resolve",
    ]);
    expect(role?.operations?.map((op) => op.id)).toEqual([
      `${ROLE}.save`,
      DELETE_ROLE,
      ADD_ROLE_MEMBERS,
      REMOVE_ROLE_MEMBERS,
      ADD_ROLE_POLICIES,
      REMOVE_ROLE_POLICIES,
    ]);

    const definition = byId.get(DEFINITION);
    expect(definition?.reads).toBeUndefined();
    expect(definition?.operations).toBeUndefined();
  });

  it.each([2, 220, 450])("coalesces graph count reads with %i records per product kind and two range requests", async size => {
    vi.mocked(assertManagement).mockRejectedValueOnce(new HttpError(403, "Cannot read the skill library", "PERMISSION_DENIED"));
    const ids = (prefix: string) => Array.from({ length: size - 1 }, (_, i) => `${prefix}-${i}`);
    const projectionIds = ids("proj-kb");
    const panelIds = ids("panel-main");
    pgQueryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      const granted = sql.includes("product_projections") ? projectionIds : panelIds;
      expect(sql).toMatch(/^SELECT COUNT\(\*\)/);
      expect(params).toEqual([owner.domainId, granted]);
      return { rows: [{ total: granted.length }] };
    });
    vi.mocked(backendGet).mockImplementation(async (_endpoint, url) => {
      if (url.endsWith("/platform/triggers?countOnly=true")) throw new BackendResponseError(503, JSON.stringify({ error: { message: "Trigger store down" } }));
      expect(url).toContain("/platform/applications?purpose=navigation&countOnly=true");
      return okJson({ total: 1 });
    });
    vi.mocked(backendPost).mockImplementation(async (_endpoint, url, body) => {
      if (url.endsWith("/authorization/objects/read-ranges")) {
        const { kind } = body as { kind: "PANEL" | "PROJECTION" };
        return { ...okJson(null), text: JSON.stringify({ ranges: {
          USE: { fixed: true, authorId: null, all: false, objectIds: kind === "PROJECTION" ? projectionIds : panelIds },
        } }) };
      }
      expect(body).toEqual({ countOnly: true });
      if (url.endsWith("/action/queryList") || url.endsWith("/metricView/queryList")) return okJson({ total: size });
      if (url.endsWith("/admin/getMetas")) return okJson({ objectTypes: 1, attributes: 2, relationships: 3 });
      if (url.endsWith("/platform/governance/organization")) return okJson({ units: 4, positions: 5, grants: 6 });
      if (url.endsWith("/workflow/grants")) return okJson({ total: 2, outsideDirectory: 1 });
      return okJson({ total: 1 });
    });

    const { counts } = platformOntologyCountsResponseSchema.parse(
      await readPlatformOntologyCounts(owner, credentials),
    );
    const byType = new Map(counts.map((c) => [c.type, c]));

    expect(byType.get("platform:ObjectType")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Attribute")).toMatchObject({ status: "ok", count: 2 });
    expect(byType.get("platform:Relationship")).toMatchObject({ status: "ok", count: 3 });
    expect(byType.get(ORG_UNIT)).toMatchObject({ status: "ok", count: 4 });
    expect(byType.get(ROLE)).toMatchObject({ status: "ok", count: 2 });
    expect(byType.get("platform:Skill")).toMatchObject({ status: "refused" });
    expect(byType.get("platform:AgentDefinition")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Trigger")).toMatchObject({ status: "failed" });
    expect(byType.get("platform:SDKComponent")).toMatchObject({ status: "ok", count: 3 });
    expect(byType.get("platform:Action")).toMatchObject({ status: "ok", count: size });
    expect(byType.get("platform:MetricView")).toMatchObject({ status: "ok", count: size });
    expect(byType.get("platform:ProductProjection")).toMatchObject({ status: "ok", count: size - 1 });
    expect(byType.get("platform:ProductPanel")).toMatchObject({ status: "ok", count: size - 1 });
    expect(byType.get("platform:Application")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:ApplicationPanelUse")).toBeUndefined();

    const rpcCalls = [...vi.mocked(backendGet).mock.calls, ...vi.mocked(backendPost).mock.calls];
    expect(rpcCalls.filter(([, url]) => url.endsWith("/admin/getMetas"))).toHaveLength(1);
    expect(rpcCalls.filter(([, url]) => url.endsWith("/platform/governance/organization"))).toHaveLength(1);
    expect(vi.mocked(backendPost).mock.calls.filter(([, url]) => url.endsWith("/authorization/objects/read-ranges")).map(([, , payload]) => payload))
      .toEqual(expect.arrayContaining([{ kind: "PANEL", verbs: ["USE"] }, { kind: "PROJECTION", verbs: ["USE"] }]));
    expect(decideProductObjects).not.toHaveBeenCalled();
    expect(rpcCalls.length).toBeLessThanOrEqual(16);
    expect(pgQueryMock).toHaveBeenCalledTimes(2);
    expect(countVisibleAgentDefinitions).toHaveBeenCalledWith(owner, credentials);
    expect(listAgentDefinitionNodes).not.toHaveBeenCalled();
    expect(listPublishedDefinitions).not.toHaveBeenCalled();
    expect(countAssistantSkills).not.toHaveBeenCalled();
    expect(assistantSkillCatalog).not.toHaveBeenCalled();
  });

  it.each([
    [true, 3, { ok: true, data: 7 }],
    [true, null, { ok: true, data: 5 }],
    [false, 3, { ok: true, data: 3 }],
    [false, 0, { ok: false, status: "refused" }],
    [false, null, { ok: false, status: "refused" }],
  ])("keeps independent owner admission when counting roles (directory: %s, grant roles: %s)", async (directory, grants, expected) => {
    vi.mocked(backendPost).mockImplementation(async (_endpoint, url, body) => {
      expect(body).toEqual({ countOnly: true });
      if (url.endsWith("/workflow/platform-access") && directory) return okJson({ total: 5 });
      if (url.endsWith("/workflow/grants") && grants !== null) return okJson({ total: grants, outsideDirectory: 2 });
      throw new BackendResponseError(403, "Not admitted");
    });
    await expect(new PlatformOntologyOwnerReaders(owner, credentials).count(ROLE)).resolves.toMatchObject(expected);
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
      relationKinds: ["user.holds-role"],
    });
    expect(ossNeighbors.node).toMatchObject({ className: USER, primaryKey: "system" });
    expect(ossNeighbors.neighbors).toEqual([]);
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

  it("reads a textual trigger ID and links to its workflow in the capability graph", async () => {
    const node = { className: TRIGGER, primaryKey: triggerFixture.id };
    const neighbors = await readPlatformOntologyNeighbors(owner, credentials, { node });
    expect(neighbors.edges).toContainEqual(expect.objectContaining({
      from: node, to: { className: "platform:Workflow", primaryKey: triggerFixture.targetId },
      relationKind: "trigger.targets-workflow",
    }));
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
      relationKinds: ["user.holds-role"],
    }, "Alice Fallback");

    expect(neighbors.node).toMatchObject({ ...node, label: "Alice Fallback" });
    expect(neighbors.edges).toEqual([]);
    expect(neighbors.relations).toEqual([
      expect.objectContaining({ relationKind: "user.holds-role", status, edgeCount: 0 }),
    ]);
  });

  it("expands 1-hop neighbors for a User with both outgoing and incoming edges and isolates per-relation 403 refusal", async () => {
    const res = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: "platform:User", primaryKey: "user-1" },
    });

    expect(res.node).toMatchObject({ className: "platform:User", primaryKey: "user-1", label: "Alice", layer: "governance" });

    // Alice holds role r-1 (Approver) and runs the ops agent; what she created and reviewed is provenance,
    // which stays on the node's own detail instead of being drawn as an edge.
    const edgeKinds = res.edges.map((e) => `${e.relationKind}:${e.to.primaryKey}`).sort();
    expect(edgeKinds).toEqual([
      "agent.executes-as-user:user-1",
      "user.holds-role:r-1",
    ]);
    expect(res.node.detail).toBe(
      "alice · Created: Approve Order、Order Approval、Order Total · Reviewed: Approve Order、Order Total",
    );
    expect(res.neighbors).toContainEqual({
      className: ROLE,
      primaryKey: "r-1",
      label: "Approver",
      layer: "governance",
    });

    const statusByKind = new Map(res.relations.map((r) => [r.relationKind, r]));
    expect(statusByKind.get("agent.executes-as-user")).toMatchObject({ status: "ok", edgeCount: 1 });
    expect(statusByKind.get("user.member-of-org-unit")).toMatchObject({ status: "ok", edgeCount: 0 });
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

    vi.mocked(listAgentDefinitionNodes).mockRejectedValueOnce(new HttpError(403, "Grant read refused", "PRODUCT_FORBIDDEN"));
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
            tasks: { source: { type: { kind: "PlatformObjectType", id: TRIGGER } }, read: "list", params: {} },
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
          },
        ]);
      }
      if (url.endsWith("/platform/applications/app-ops")) {
        return okJson({
          id: "app-ops",
          panelUses: [
            {
              id: "use-main",
              panelId: "panel-main",
              path: "/applications/app-ops/main",
              pageKey: "main",
              names: { en: "Main" },
            },
          ],
        });
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
      to: { className: ONTOLOGY_TYPE, primaryKey: TRIGGER },
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
          { roleId: "r-1", roleCode: "Approver", managementOperations: [], managementRole: false },
          { roleId: "r-nameless", roleCode: null, managementOperations: [], managementRole: false },
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

  it("resolves a role's governed relations using roleId as primaryKey and rejects roleCode as primaryKey", async () => {
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
          relationKind: "role.owns-workflow-step",
          direction: "outgoing",
          from: { className: ROLE, primaryKey: "r-1" },
          to: { className: WORKFLOW, primaryKey: "wf-1" },
          authorization: { stepNo: 1, version: 2, scope: "all", scopeLabel: "All data" },
        }),
      ]),
    );
    expect(roleCenter.edges).toHaveLength(2);

    const workflowNeighbors = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: WORKFLOW, primaryKey: "wf-1" },
      relationKinds: ["role.owns-workflow-step"],
    });
    expect(workflowNeighbors.edges.map((e) => `${e.relationKind}:${e.from.primaryKey}`)).toEqual([
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

  it("keeps only the workflow steps in force and surfaces grant read refusal and failure", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/workflow/grants")) {
        return okJson([
          {
            roleId: "r-1", roleCode: "Approver", capabilityKind: "ACTION", capabilityId: "act-1",
            workflowId: "wf-1", stepNo: 2, activatedByWorkflowVersion: "3",
            scope: { kind: "self_organization", className: "Order", field: "orgId" }, inForce: true,
          },
          {
            roleId: "r-2", roleCode: "Operator", capabilityKind: "ACTION", capabilityId: "act-2",
            workflowId: "wf-1", stepNo: 1, activatedByWorkflowVersion: "2", scope: { kind: "all" }, inForce: false,
          },
          // A directly granted action has no workflow step and belongs to the policy's action edge instead.
          { roleId: "r-1", roleCode: "Approver", capabilityKind: "ACTION", capabilityId: "act-3", inForce: true },
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
        authorization: {
          stepNo: 2,
          version: 3,
          scope: "self_organization",
          scopeLabel: "Own organization",
          scopeField: "Order.orgId",
        },
      }),
    ]);

    // When the grant directory is refused, relationStatus reports refused instead of ok with 0 edges
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/workflow/grants")) {
        throw new BackendResponseError(403, JSON.stringify({ message: "Grants forbidden" }));
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

    // When the grant directory fails, relationStatus reports failed
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/workflow/grants")) {
        throw new BackendResponseError(500, JSON.stringify({ message: "Grants down" }));
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
  });

  it("lists organization units, positions, permission policies, and localized org grants while excluding OrgMembership", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/platform/governance/organization")) {
        if ((body as { countOnly?: boolean }).countOnly) return okJson({ units: 3, positions: 1, grants: 4 });
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
        if ((body as { countOnly?: boolean }).countOnly) return okJson({ total: 1 });
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
        return okJson({ policies: [{ id: "pol-1", name: "Order Read Policy", type: 2 }] });
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

  it("reads one policy's grants as entry, action and object edges with the verb, entry and scope on the edge", async () => {
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/authorization/policies/graph-facts")) {
        return graphFacts({
          policyGrants: [
            { policyId: "pol-1", targetKind: "ENTRY", targetKey: "app-1/use-main", verb: "ENTER", scope: null },
            {
              policyId: "pol-1", targetKind: "ACTION", targetKey: "act-1", verb: "EXECUTE",
              scope: { kind: "self_organization", className: "Order", field: "orgId" },
            },
            { policyId: "pol-1", targetKind: "PANEL", targetKey: "panel-1", verb: "USE", scope: null },
            { policyId: "pol-1", targetKind: "PROJECTION", targetKey: "proj-1", verb: "EDIT", scope: null },
            { policyId: "pol-1", targetKind: "WORKFLOW", targetKey: "wf-1", verb: "EDIT", scope: null },
            { policyId: "pol-1", targetKind: "TRIGGER", targetKey: triggerFixture.id, verb: "EDIT", scope: null },
            // A CREATE grant names no record: it is creation authority for that class, so it stays off the graph.
            { policyId: "pol-1", targetKind: "WORKFLOW", targetKey: "", verb: "CREATE", scope: null },
            { policyId: "pol-2", targetKind: "AGENT", targetKey: "agent-1", verb: "USE", scope: null },
          ],
        });
      }
      if (url.endsWith("/platform/governance/policies")) {
        return okJson({ policies: [{ id: "pol-1", name: "Order Operations Policy", type: 3 }] });
      }
      return baseImpl(endpoint, url, body, opts);
    });
    const readOwner = vi.mocked(backendGet).getMockImplementation()!;
    vi.mocked(backendGet).mockImplementation(async (endpoint, url, options) => {
      if (url.includes("/platform/applications?purpose=navigation")) {
        return okJson([
          {
            id: "app-1",
            kind: "product",
            names: { en: "Order Workspace" },
            descriptions: {},
            icon: "grid",
            rail: "apps",
            category: "business",
            sort: 1,
            entry: { path: "/applications/app-1", renderer: "panels", entryKey: "main" },
            scheduleAdapter: null,
            releaseId: null,
          },
        ]);
      }
      return readOwner(endpoint, url, options);
    });

    const policyCenter = platformOntologyNeighborsResponseSchema.parse(
      await readPlatformOntologyNeighbors(owner, credentials, {
        node: { className: PERMISSION_POLICY, primaryKey: "pol-1" },
      }),
    );

    expect(policyCenter.node.detail).toBe("Can create: Workflow");
    expect(policyCenter.edges.map((edge) => `${edge.relationKind}:${edge.to.primaryKey}`).sort()).toEqual([
      "permission-policy.can-enter-application:app-1",
      "permission-policy.can-execute-action:act-1",
      "permission-policy.can-use-object:panel-1",
      "permission-policy.can-use-object:proj-1",
      "permission-policy.can-use-object:tr-1",
      "permission-policy.can-use-object:wf-1",
    ]);
    expect(policyCenter.edges.find((edge) => edge.relationKind === "permission-policy.can-enter-application")
      ?.authorization).toEqual({ verb: "ENTER", verbLabel: "Enter", entry: "app-1/use-main", entryLabel: "use-main" });
    expect(policyCenter.edges.find((edge) => edge.relationKind === "permission-policy.can-execute-action")
      ?.authorization).toEqual({
      verb: "EXECUTE",
      verbLabel: "Execute",
      scope: "self_organization",
      scopeLabel: "Own organization",
      scopeField: "Order.orgId",
    });
    expect(policyCenter.edges.find((edge) => edge.relationKind === "permission-policy.can-use-object"
      && edge.to.primaryKey === "proj-1")?.authorization).toEqual({ verb: "EDIT", verbLabel: "Edit" });

    // The edges read the same way from their target side.
    const appIncoming = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: APPLICATION, primaryKey: "app-1" },
      relationKinds: ["permission-policy.can-enter-application"],
    });
    expect(appIncoming.edges).toEqual([
      expect.objectContaining({
        relationKind: "permission-policy.can-enter-application",
        direction: "incoming",
        from: { className: PERMISSION_POLICY, primaryKey: "pol-1" },
        to: { className: APPLICATION, primaryKey: "app-1" },
      }),
    ]);

    const actionIncoming = await readPlatformOntologyNeighbors(owner, credentials, {
      node: { className: ACTION, primaryKey: "act-1" },
      relationKinds: ["permission-policy.can-execute-action"],
    });
    expect(actionIncoming.edges.map((edge) => edge.from.primaryKey)).toEqual(["pol-1"]);
  });

  it("annotates domain-shared product details on agents, panels and projections", async () => {
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
    const baseImpl = vi.mocked(backendPost).getMockImplementation()!;
    vi.mocked(backendPost).mockImplementation(async (endpoint, url, body, opts) => {
      if (url.endsWith("/authorization/policies/graph-facts")) {
        return graphFacts({
          policyGrants: [
            { policyId: "default", targetKind: "AGENT", targetKey: "agent-1", verb: "USE" },
            { policyId: "default", targetKind: "PANEL", targetKey: "panel-1", verb: "USE" },
            { policyId: "default", targetKind: "PANEL", targetKey: "panel-bare", verb: "USE" },
          ],
        });
      }
      return baseImpl(endpoint, url, body, opts);
    });

    const panelList = await readPlatformOntologyObjects(owner, credentials, { type: PRODUCT_PANEL });
    expect(panelList.items).toEqual([
      { node: { className: PRODUCT_PANEL, primaryKey: "panel-bare" }, label: "Bare Shared Panel", detail: "全本域可用" },
      { node: { className: PRODUCT_PANEL, primaryKey: "panel-1" }, label: "Order Overview Panel", detail: "Shows live orders · 全本域可用" },
    ]);

    const agents = await readPlatformOntologyObjects(owner, credentials, { type: AGENT_DEFINITION });
    expect(agents.items).toEqual([
      { node: { className: AGENT_DEFINITION, primaryKey: "agent-1" }, label: "Ops Assistant", detail: "enabled · 全本域可用" },
    ]);
  });
});
