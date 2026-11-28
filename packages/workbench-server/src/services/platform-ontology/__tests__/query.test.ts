import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerFixture } from "../../scheduling/__tests__/fixtures";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
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
  ATTRIBUTE,
  BUSINESS_KNOWLEDGE,
  DASHBOARD_CARD,
  DEFINITION,
  DELETE_AGENT,
  DELETE_KNOWLEDGE,
  DELETE_ROLE,
  FUNCTION,
  METRIC_VIEW,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  ORG_GRANT,
  ORG_MEMBERSHIP,
  ORG_POSITION,
  ORG_UNIT,
  PERMISSION_POLICY,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  RELATIONSHIP,
  REMOVE_ROLE_MEMBERS,
  REMOVE_ROLE_POLICIES,
  ROLE,
  TRIGGER,
  SDK_COMPONENT,
  SKILL,
  USER,
  WORKFLOW,
  platformObjectTypes,
  platformRelationGroups,
  platformRelationKinds,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeDetails } from "@ontomato/contracts/platform-type-details";
import { METRIC_CHART_COMPONENT } from "@ontomato/contracts/product-panels";
import { installContentLayout } from "../../../content/layout";
import { configureI18n, tForLocale } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { assertManagement } from "../../../identity/management";
import { getPostgresPool } from "../../../infrastructure/postgres";
import { AuthFailedError, BackendResponseError, backendGet, backendPost } from "../../../utils/backend-client";
import { HttpError } from "../../../utils/errors";
import type { AssistantCredentials } from "../../../platform/agent-runtime/runtime";
import { countVisibleAgentDefinitions } from "../../assistant/definitions";
import { PAGE_OPERATOR_SKILL } from "../../assistant/page-operator";
import { listAgentDefinitionNodes, listAgentExecutionUserRelations, listAgentSkillRelations } from "../../assistant/definition-relations";
import { assistantSkillCatalog, countAssistantSkills } from "../../assistant/skills";
import { countPublishedDefinitions, listPublishedDefinitions } from "../../business-definitions/definitions";
import type { ObjectDecisionRequest } from "../../product-governance/authorization";
import { readPanelComponentCatalogue } from "../../product-panels/component-catalogue";
import type { JavaPanelReadResult } from "../../product-panels/java-panel-reads";
import { listObjectDetailPanelMappings } from "../../product-panels/object-detail";
import { PlatformOntologyOwnerReaders } from "../owners";
import { prepareRegisteredOntologyRead } from "../registered-reads";
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
vi.mock("../../product-governance/service-authentication", async original => ({
  ...await original<typeof import("../../product-governance/service-authentication")>(),
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

const skillFixtureRoot = await mkdtemp(join(tmpdir(), "ontology-query-skills-"));
installContentLayout({ runtimeRoot: skillFixtureRoot, publicSkillsRoot: skillFixtureRoot, prompts: [], knowledgeRoot: skillFixtureRoot, runtimeResources: [] });
afterAll(() => rm(skillFixtureRoot, { recursive: true, force: true }));
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
    expect(derivedIds).toEqual(["role.owns-workflow-step"]);

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
      "createForm", "effectiveAccess", "effectiveAccessCounts",
      "form", "memberCandidates", "members", "options",
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

  it("presents registered graph counts from independent same-batch facts and Node-owned scopes", async () => {
    const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "counts" }, owner, credentials, {}))!;
    const range = { fixed: true, all: false, authorId: null, objectIds: ["permitted-panel"] };
    pgQueryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      expect(sql).toContain("COUNT(*)");
      expect(sql).toContain("builtin_product_panels");
      expect(params).toEqual([owner.domainId, ["permitted-panel"]]);
      return { rows: [{ total: 2 }] };
    });
    vi.mocked(countAssistantSkills).mockResolvedValue(4);
    const facts = plan.facts.map(({ call, visibleKinds }): JavaPanelReadResult => {
      if (call?.type === SKILL) return { status: "ready", payload: true };
      switch (call?.name) {
        case "metadataCounts": return { status: "ready", payload: { objectTypes: 2, attributes: 3, relationships: 4 } };
        case "organizationCounts": return { status: "forbidden", error: "Organization directory refused" };
        case "roleDirectoryCount": return { status: "ready", payload: { total: 5 } };
        case "grantRoleCounts": return { status: "ready", payload: { total: 4, outsideDirectory: 2 } };
        case "navigationCount": return { status: "error", error: "Application owner unavailable" };
      }
      if (call?.type === ACTION) return { status: "ready", payload: { total: "invalid" } };
      const scope = visibleKinds?.[0];
      if (scope?.kind === "PANEL" || scope?.kind === "AGENT")
        return { status: "ready", visibility: { [scope.kind]: { [scope.verbs[0]]: range } } };
      return { status: "ready", payload: { total: 1 } };
    });
    const { counts } = platformOntologyCountsResponseSchema.parse(await plan.present(owner, facts));
    const cells = new Map(counts.map(cell => [cell.type, cell]));
    expect(cells.get(OBJECT_TYPE)).toMatchObject({ status: "ok", count: 2 });
    expect(cells.get(ROLE)).toMatchObject({ status: "ok", count: 7 });
    expect(cells.get(ORG_UNIT)).toMatchObject({ status: "refused", reason: "Organization directory refused" });
    expect(cells.get(APPLICATION)).toMatchObject({ status: "failed", reason: "Application owner unavailable" });
    expect(cells.get(ACTION)).toMatchObject({ status: "failed" });
    expect(cells.get(PRODUCT_PANEL)).toMatchObject({ status: "ok", count: 2 });
    expect(cells.get(PRODUCT_PROJECTION)).toMatchObject({ status: "failed", reason: "Missing PROJECTION/USE visibility fact" });
    expect(cells.get(SKILL), cells.get(SKILL)?.reason).toMatchObject({ status: "ok", count: 4 });
    expect(countAssistantSkills).toHaveBeenCalledOnce();
    expect(plan.facts.filter(({ call }) => call?.name === "metadataCounts")).toHaveLength(1);
    expect(countVisibleAgentDefinitions).toHaveBeenCalledWith(owner, credentials, range);
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
    expect(decideProductObjects).not.toHaveBeenCalled();
    const denied = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "counts" },
      owner, credentials, {}))!;
    const deniedFacts = facts.map((fact, index): JavaPanelReadResult =>
      denied.facts[index].call?.type === SKILL ? { status: "forbidden", error: "Skill library refused" } : fact);
    const deniedCounts = platformOntologyCountsResponseSchema.parse(await denied.present(owner, deniedFacts));
    expect(deniedCounts.counts.find(cell => cell.type === SKILL)).toMatchObject({ status: "refused", reason: "Skill library refused" });

    const declarations = JSON.parse(readFileSync(new URL(
      "../../../../../ontology-manager/resources/builtin-panels/ontology-graph/projections.json", import.meta.url,
    ), "utf8")) as { input: { data: Record<string, { read: string; source: { type?: { id: string } } }> } }[];
    const reads = declarations.flatMap(({ input }) => Object.values(input.data));
    for (const method of ["countRows", "graphNodes"]) {
      const declaration = reads.find(({ read }) => read === method)!;
      const typeId = declaration.source.type!.id;
      const alias = (await prepareRegisteredOntologyRead({ kind: "platform", typeId, method: declaration.read }, owner, credentials, {}))!;
      expect(alias.facts).toEqual(plan.facts);
      const rows = panelReadResultSchemas.panelRecordList.parse(await alias.present(owner, facts));
      const objectType = rows.find(row => row.primaryKey === OBJECT_TYPE)!;
      expect(objectType.fields).toMatchObject({ count: 2, countStatus: "ok", countDisplay: "2" });
      expect(rows.find(row => row.primaryKey === SKILL)?.fields).toMatchObject({ count: 4, countStatus: "ok", countDisplay: "4" });
      if (method === "graphNodes") expect(objectType.label.endsWith(" (2)")).toBe(true);
    }
    expect(backendPost).not.toHaveBeenCalled();
    expect(backendGet).not.toHaveBeenCalled();
  });

  it.each([
    ["user.holds-role", USER, ROLE, "user-1", "analyst", "Alice", "Analyst"],
    ["role.uses-permission-policy", ROLE, PERMISSION_POLICY, "analyst", "policy-1", "Analyst", "Data access"],
    ["application.uses-panel", APPLICATION, PRODUCT_PANEL, "app-shipping", "panel-shipping", "Shipping", "Shipping panel"],
    ["org-unit.has-child", ORG_UNIT, ORG_UNIT, "org-parent", "org-child", "Parent", "Child"],
    ["org-unit.has-position", ORG_UNIT, ORG_POSITION, "org-rd", "pos-arch", "R&D", "Architect"],
  ])("plans %s in both directions using only the declared endpoints and scoped labels", async (
    relationKind, from, to, fromId, toId, fromName, toName,
  ) => {
    for (const direction of ["outgoing", "incoming"] as const) {
      const outgoing = direction === "outgoing";
      const node = { className: outgoing ? from : to, primaryKey: outgoing ? fromId : toId };
      const targetClass = outgoing ? to : from;
      const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" },
        owner, credentials, { node, targetClass, direction, relationKinds: [relationKind] }))!;
      const relation = plan.facts.find(({ call }) => call?.name === relationKind);
      expect(relation?.call?.parameters).toEqual({ ...node, from, to, direction });
      expect(plan.facts.filter(({ call }) => call?.name?.includes("."))).toHaveLength(1);
      pgQueryMock.mockImplementation(async (_sql, params) => {
        expect(params).toEqual([owner.domainId, [toId], [toId]]);
        return { rows: [{ id: toId, definition: {
          name: toName, description: "", visibility: "domain", content: { html: "<div/>" }, manifest: { state: {}, members: {} },
        } }] };
      });
      const results = plan.facts.map(({ call, visibleKinds }): JavaPanelReadResult => {
        if (visibleKinds) return { status: "ready", visibility: { PANEL: { USE: {
          fixed: false, all: false, objectIds: [toId], authorId: null,
        } } } };
        if (call?.name === "governanceCenter") return {
          status: "ready", payload: { names: [{ id: node.primaryKey, name: outgoing ? fromName : toName }], emptyDirectory: false },
        };
        if (from === APPLICATION) return {
          status: "ready", payload: [{ id: fromId, names: { en: fromName }, kind: "native", panelIds: [toId] }],
        };
        return {
          status: "ready", payload: { links: [{ fromId, toId }], fromNames: [{ id: fromId, name: fromName }],
            toNames: [{ id: toId, name: toName }] },
        };
      });
      const graph = platformOntologyNeighborsResponseSchema.parse(await plan.present(owner, results));
      expect(graph.edges).toMatchObject([{ relationKind, direction, from: { className: from, primaryKey: fromId },
        to: { className: to, primaryKey: toId } }]);
      expect(graph.neighbors).toMatchObject([{ className: targetClass, label: outgoing ? toName : fromName }]);
      expect(graph.node.label).toBe(outgoing ? fromName : toName);
    }
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it.each([
    [ACTION, "action.uses-function", "a1", "Approve order", "PUBLISHED"],
    [METRIC_VIEW, "metric-view.uses-function", "m1", "Sales total", "PENDING_REVIEW"],
  ] as const)("reads the scoped %s dependency in both directions", async (type, kind, id, label, detail) => {
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const fromNames = [{ id, name: label, detail }];
    const toNames = [{ id: "fn", name: "Find order", detail: "OPERATION_READ" }];
    const links = [{ fromId: id, toId: "fn" }];
    const ready = (payload: unknown): JavaPanelReadResult => ({ status: "ready", payload });
    const outgoing = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node: { className: type, primaryKey: id }, relationKinds: [kind], direction: "outgoing", targetClass: FUNCTION,
    }))!;
    expect(outgoing.facts).toEqual([{ call: { type: ONTOLOGY_TYPE, name: kind, parameters: {
      className: type, primaryKey: id, from: type, to: FUNCTION, direction: "outgoing",
    } } }]);
    await expect(outgoing.present(owner, [ready({ links, fromNames, toNames })])).resolves.toMatchObject({
      node: { label, detail }, neighbors: [{ primaryKey: "fn", label: "Find order", detail: "OPERATION_READ" }],
      edges: [{ relationKind: kind, direction: "outgoing" }],
    });
    await expect(outgoing.present(owner, [ready({ links, fromNames, toNames: [] })])).resolves.toMatchObject({
      neighbors: [{ primaryKey: "fn", label: "fn" }], edges: [{ relationKind: kind }],
    });

    const incoming = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node: { className: FUNCTION, primaryKey: "fn" }, relationKinds: [kind], direction: "incoming", targetClass: type,
    }))!;
    expect(incoming.facts).toEqual([
      { call: { type: ONTOLOGY_TYPE, name: kind, parameters: {
        className: FUNCTION, primaryKey: "fn", from: type, to: FUNCTION, direction: "incoming",
      } } },
      { call: { type: ONTOLOGY_TYPE, name: "functionCenter", parameters: { primaryKey: "fn" } } },
    ]);
    await expect(incoming.present(owner, [ready({ links, fromNames, toNames: [] }), ready(toNames)])).resolves.toMatchObject({
      node: { label: "Find order" }, neighbors: [{ primaryKey: id, label, detail }],
      edges: [{ relationKind: kind, direction: "incoming" }],
    });
    await expect(incoming.present(owner, [{ status: "error", error: "Definition read failed" }, ready(toNames)]))
      .resolves.toMatchObject({ relations: [{ relationKind: kind, status: "failed", edgeCount: 0 }] });
    await expect(incoming.present(owner, [ready({ links, fromNames, toNames: [] }), ready([])]))
      .rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
    expect(backendPost).not.toHaveBeenCalled();
    expect(backendGet).not.toHaveBeenCalled();
  });

  it("reads both object-type dependencies in one batch and keeps edges when model labels are refused", async () => {
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const functionKind = "function.reads-object-type";
    const actionKind = "action.targets-object-type";
    const order = { className: "Order", showName: "Orders" };
    const ready = (payload: unknown): JavaPanelReadResult => ({ status: "ready", payload });
    const refused = { status: "forbidden", error: "Model refused" } as const;
    const edges = (id: string, name: string) => ready({
      links: [{ fromId: id, toId: "Order" }], fromNames: [{ id, name }], toNames: [],
    });
    const functionEdges = edges("fn", "Find order");
    const actionEdges = edges("action", "Approve order");
    const plan = async (className: string, primaryKey: string, params = {}) =>
      (await prepareRegisteredOntologyRead(selection, owner, credentials, {
        node: { className, primaryKey }, relationKinds: [functionKind, actionKind], ...params,
      }))!;
    const present = async (prepared: Awaited<ReturnType<typeof plan>>, values: Record<string, JavaPanelReadResult>) =>
      platformOntologyNeighborsResponseSchema.parse(await prepared.present(owner, prepared.facts.map(({ call }) =>
        values[call!.name])));

    const incoming = await plan(OBJECT_TYPE, "Order", { direction: "incoming", limit: 1 });
    expect(incoming.facts.map(({ call }) => call?.name)).toEqual([functionKind, actionKind, "modelNeighbors"]);
    const reverseFacts = {
      [functionKind]: functionEdges, [actionKind]: actionEdges,
      modelNeighbors: ready({ center: { classDef: [order], relationDef: [] }, relations: {} }),
    };
    await expect(present(incoming, { ...reverseFacts, modelNeighbors: refused })).rejects.toMatchObject({ status: 403 });
    expect(await present(incoming, reverseFacts)).toMatchObject({
      node: { label: "Orders" }, neighbors: [{ primaryKey: "fn", label: "Find order" }],
      edges: [{ relationKind: functionKind, direction: "incoming" }], total: 2, nextOffset: 1,
    });
    expect(await present(incoming, { ...reverseFacts, [functionKind]: { status: "error", error: "Source failed" } }))
      .toMatchObject({
        relations: [{ relationKind: functionKind, status: "failed" }, { relationKind: actionKind, status: "ok" }],
        edges: [{ relationKind: actionKind, direction: "incoming" }], total: 1, nextOffset: null,
      });

    for (const [type, id, kind, edge, label] of [
      [FUNCTION, "fn", functionKind, functionEdges, "Find order"],
      [ACTION, "action", actionKind, actionEdges, "Approve order"],
    ] as const) {
      const outgoing = await plan(type, id, { direction: "outgoing", targetClass: OBJECT_TYPE });
      expect(outgoing.facts.map(({ call }) => call?.name)).toEqual([kind, "dependencyObjectTypeNames"]);
      expect(await present(outgoing, {
        [kind]: edge, dependencyObjectTypeNames: ready({ classDef: [order], relationDef: [] }),
      })).toMatchObject({
        node: { label },
        neighbors: [{ primaryKey: "Order", label: "Orders", detail: "Order" }],
        edges: [{ relationKind: kind, direction: "outgoing" }],
      });
      for (const unavailable of [
        refused, { status: "error", error: "Model failed" },
        { status: "error", code: "PANEL_READ_TIMEOUT", error: "Model timed out" },
      ] as const) {
        expect(await present(outgoing, { [kind]: edge, dependencyObjectTypeNames: unavailable })).toMatchObject({
          neighbors: [{ primaryKey: "Order", label: "Order" }], relations: [{ relationKind: kind, status: "ok", edgeCount: 1 }],
        });
      }
    }
    const functionUse = "action.uses-function";
    const both = await plan(ACTION, "action", { direction: "outgoing", relationKinds: [actionKind, functionUse] });
    expect(both.facts).toHaveLength(3);
    expect(both.facts.map(({ call }) => call?.name))
      .toEqual(expect.arrayContaining([actionKind, functionUse, "dependencyObjectTypeNames"]));
    expect(await present(both, {
      [actionKind]: actionEdges, [functionUse]: { status: "error", error: "Function dependency failed" },
      dependencyObjectTypeNames: refused,
    })).toMatchObject({
      node: { label: "Approve order" },
      edges: [{ relationKind: actionKind, direction: "outgoing" }],
      relations: expect.arrayContaining([
        expect.objectContaining({ relationKind: actionKind, status: "ok" }),
        expect.objectContaining({ relationKind: functionUse, status: "failed" }),
      ]),
    });
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("maps both directions of each model edge and uses the original labels and tuple key", async () => {
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const attributeId = JSON.stringify(["Order", 'line"code']);
    const order = { className: "Order", classDesc: "Orders" };
    const customer = { className: "Customer", showName: "Customers" };
    const attributes = { ...order, attrs: [{ name: 'line"code', showName: "Line code" }, { name: "amount" }] };
    const relationship = { relationship: "SHIPS", relationShowName: "Ships to", fromclass: "Order", toclass: "Customer" };
    const model = (classDef: unknown[], relationDef: object = []) => ({ classDef, relationDef });
    const links = [
      ["object-type.has-attribute", OBJECT_TYPE, ATTRIBUTE, "Order", attributeId, model([attributes]), model([attributes]), "Orders", "Line code"],
      ["relationship.from-object-type", RELATIONSHIP, OBJECT_TYPE, "SHIPS", "Order", model([], { persisted: relationship }),
        model([order], { persisted: relationship }), "Ships to", "Orders"],
      ["relationship.to-object-type", RELATIONSHIP, OBJECT_TYPE, "SHIPS", "Customer", model([], { persisted: relationship }),
        model([customer], { persisted: relationship }), "Ships to", "Customers"],
    ] as const;
    for (const [kind, from, to, fromId, toId, fromCenter, edge, fromLabel, toLabel] of links) {
      const toCenter = to === ATTRIBUTE ? model([{
        className: "Order", attrs: [attributes.attrs[0]],
      }]) : model([toId === "Order" ? order : customer]);
      for (const direction of ["outgoing", "incoming"] as const) {
        const outgoing = direction === "outgoing";
        const node = outgoing ? { className: from, primaryKey: fromId } : { className: to, primaryKey: toId };
        const plan = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
          node, direction, relationKinds: [kind], targetClass: outgoing ? to : from, limit: 1,
        }))!;
        const center = node.className === ATTRIBUTE ? { ...node, attributeKey: ["Order", 'line"code'] } : node;
        expect(plan.facts).toEqual([{ call: { type: ONTOLOGY_TYPE, name: "modelNeighbors", parameters: {
          ...center, relations: [{ kind, direction }],
        } } }]);
        const page = platformOntologyNeighborsResponseSchema.parse(await plan.present(owner, [{
          status: "ready", payload: { center: outgoing ? fromCenter : toCenter, relations: { [kind]: edge } },
        }]));
        expect(page.node.label).toBe(outgoing ? fromLabel : toLabel);
        expect(page.neighbors).toMatchObject([{ label: outgoing ? toLabel : fromLabel }]);
        expect(page.edges).toMatchObject([{
          relationKind: kind, direction, from: { className: from, primaryKey: fromId }, to: { className: to, primaryKey: toId },
        }]);
        expect(page.nextOffset).toBe(kind === "object-type.has-attribute" && outgoing ? 1 : null);
      }
    }
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("keeps model center and edge failures separate and retains dangling endpoint IDs", async () => {
    const kinds = ["relationship.from-object-type", "relationship.to-object-type"];
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const node = { className: RELATIONSHIP, primaryKey: "LINK" };
    const plan = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node, relationKinds: kinds, targetClass: OBJECT_TYPE,
    }))!;
    expect(plan.facts).toEqual([{ call: { type: ONTOLOGY_TYPE, name: "modelNeighbors", parameters: {
      ...node, relations: kinds.map(kind => ({ kind, direction: "outgoing" })),
    } } }]);
    const center = { classDef: [], relationDef: [
      { relationship: "LINK", desc: "Related to", fromclass: "Order", toclass: "Missing" },
    ] };
    const model = (relations: unknown, centerFact: unknown = center): JavaPanelReadResult =>
      ({ status: "ready", payload: { center: centerFact, relations } });
    const graph = await plan.present(owner, [model({ [kinds[1]]: center })]);
    expect(graph).toMatchObject({
      node: { label: "Related to", detail: "Order → Missing" },
      neighbors: [{ primaryKey: "Missing", label: "Missing" }],
      relations: [{ status: "failed", edgeCount: 0 }, { status: "ok", edgeCount: 1 }],
    });
    await expect(plan.present(owner, [model({ [kinds[0]]: null, [kinds[1]]: center })])).resolves.toMatchObject({
      relations: [{ status: "failed", edgeCount: 0 }, { status: "ok", edgeCount: 1 }],
    });
    await expect(plan.present(owner, [model(null)])).resolves.toMatchObject({
      node: { label: "Related to" }, relations: [{ status: "failed", edgeCount: 0 }, { status: "failed", edgeCount: 0 }],
    });
    await expect(plan.present(owner, [model({ [kinds[1]]: center }, null)])).rejects.toMatchObject({ status: 502 });
    await expect(plan.present(owner, [{ status: "forbidden", error: "Model read refused" }]))
      .rejects.toMatchObject({ status: 403 });
    await expect(plan.present(owner, [model({}, { classDef: [], relationDef: [] })]))
      .rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
    const filtered = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node, relationKinds: kinds, targetClass: ATTRIBUTE,
    }))!;
    expect(filtered.facts).toEqual([{ call: { type: ONTOLOGY_TYPE, name: "modelNeighbors", parameters: {
      ...node, relations: [],
    } } }]);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("pages both directions of org children in owner order and keeps relation and center errors distinct", async () => {
    const node = { className: ORG_UNIT, primaryKey: "middle" };
    const relationKind = "org-unit.has-child";
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const input = { node, relationKinds: [relationKind], targetClass: ORG_UNIT, limit: 1 };
    const prepare = (offset: number) => prepareRegisteredOntologyRead(selection, owner, credentials, { ...input, offset });
    const first = (await prepare(0))!;
    expect(first.facts).toEqual([
      { call: { type: ONTOLOGY_TYPE, name: relationKind, parameters: { ...node, from: ORG_UNIT, to: ORG_UNIT, direction: "both" } } },
      { call: { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: node } },
    ]);
    const center = { status: "ready", payload: { names: [{ id: "middle", name: "Middle", detail: "ORG-M" }], emptyDirectory: false } } as const;
    const links = { status: "ready", payload: {
      links: [{ fromId: "middle", toId: "child" }, { fromId: "parent", toId: "middle" }],
      fromNames: [{ id: "parent", name: "Parent", detail: "ORG-P" }], toNames: [{ id: "child", name: "Child", detail: "ORG-C" }],
    } } as const;
    await expect(first.present(owner, [links, center])).resolves.toMatchObject({
      node: { label: "Middle", detail: "ORG-M" }, neighbors: [{ label: "Child", detail: "ORG-C" }],
      edges: [{ relationKind, direction: "outgoing" }], total: 2, nextOffset: 1,
    });
    await expect((await prepare(1))!.present(owner, [links, center])).resolves.toMatchObject({
      neighbors: [{ label: "Parent", detail: "ORG-P" }], edges: [{ relationKind, direction: "incoming" }], total: 2, nextOffset: null,
    });
    await expect(first.present(owner, [{ status: "forbidden", error: "Organization edge refused" }, center])).resolves.toMatchObject({
      edges: [], relations: [{ relationKind, status: "refused", reason: "Organization edge refused" }],
    });
    await expect(first.present(owner, [links, { status: "ready", payload: { names: [], emptyDirectory: false } }]))
      .rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
    await expect(first.present(owner, [links, { status: "forbidden", error: "Organization center refused" }]))
      .rejects.toMatchObject({ status: 403, message: "Organization center refused" });
    const filtered = (await prepareRegisteredOntologyRead(selection, owner, credentials, { ...input, targetClass: ORG_POSITION }))!;
    expect(filtered.facts).toEqual(first.facts.slice(1));
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("scopes registered published Definition neighbors and uses the actual model endpoint", async () => {
    const real = await vi.importActual<typeof import("../../business-definitions/definitions")>("../../business-definitions/definitions");
    vi.mocked(listPublishedDefinitions).mockImplementation(real.listPublishedDefinitions);
    const stored = (id: string, objectType: string, status = "PUBLISHED", domainId = owner.domainId) => ({
      domainId, definition: { id, name: id + " view", objectType, revision: 1, status, parameters: [] },
    });
    const rows = [
      stored("first", "Order"), stored("second", "Order"), stored("draft", "Order", "DRAFT"),
      stored("foreign", "Order", "PUBLISHED", "other-domain"), stored("platform", ACTION), stored("unrelated", "Customer"),
    ];
    pgQueryMock.mockImplementation(async (sql: string, [domain, value]: [string, string]) => {
      expect(sql).toContain("domain_id=$1 AND status='PUBLISHED'");
      expect(sql).toContain("ORDER BY id");
      expect(domain).toBe(owner.domainId);
      const field = sql.includes(" AND id=$2") ? "id" : "objectType";
      if (field === "objectType") expect(sql).toContain(" AND definition->>'objectType'=$2");
      return { rows: rows.filter(row => row.domainId === domain &&
        row.definition.status === "PUBLISHED" && row.definition[field] === value) };
    });
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const relationKind = "definition.based-on-object-type";
    const plan = async (className: string, primaryKey: string, params = {}) =>
      (await prepareRegisteredOntologyRead(selection, owner, credentials, {
        node: { className, primaryKey }, relationKinds: [relationKind], ...params,
      }))!;
    const graph = async (prepared: Awaited<ReturnType<typeof plan>>, facts: readonly JavaPanelReadResult[]) =>
      platformOntologyNeighborsResponseSchema.parse(await prepared.present(owner, facts));
    const model = (classDef: unknown[]): JavaPanelReadResult => ({
      status: "ready", payload: { center: { classDef, relationDef: [] }, relations: {} },
    });
    const type = model([{ className: "Order", showName: "Orders" }]);
    const refused = { status: "forbidden", error: "Model read refused" } as const;

    const outgoing = await plan(DEFINITION, "first", { direction: "outgoing", targetClass: OBJECT_TYPE });
    expect(pgQueryMock.mock.calls).toMatchObject([[expect.stringContaining(" AND id=$2"), [owner.domainId, "first"]]]);
    expect(outgoing.facts).toEqual([{ call: { type: ONTOLOGY_TYPE, name: "modelNeighbors", parameters: {
      className: OBJECT_TYPE, primaryKey: "Order", relations: [],
    } } }]);
    expect(await graph(outgoing, [type])).toMatchObject({
      node: { className: DEFINITION, primaryKey: "first", label: "first view", detail: "Order" },
      edges: [{ relationKind, direction: "outgoing", to: { className: OBJECT_TYPE, primaryKey: "Order" } }],
      neighbors: [{ primaryKey: "Order", label: "Orders" }],
    });
    for (const unreadable of [model([]), refused]) {
      expect(await graph(outgoing, [unreadable])).toMatchObject({
        neighbors: [{ primaryKey: "Order", label: "Order" }], relations: [{ relationKind, status: "ok", edgeCount: 1 }],
      });
    }
    expect(pgQueryMock).toHaveBeenCalledTimes(1);

    const platform = await plan(DEFINITION, "platform");
    expect(platform.facts).toEqual([]);
    expect(await graph(platform, [])).toMatchObject({ edges: [], node: { detail: ACTION } });
    const filtered = await plan(DEFINITION, "first", { direction: "incoming" });
    expect(filtered.facts).toEqual([]);
    const draft = await plan(DEFINITION, "draft");
    expect(draft.facts).toEqual([]);
    await expect(draft.present(owner, [])).rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });

    const incoming = { direction: "incoming", targetClass: DEFINITION, limit: 1 };
    const first = await plan(OBJECT_TYPE, "Order", incoming);
    expect(first.facts).toEqual(outgoing.facts);
    const beforeReverse = pgQueryMock.mock.calls.length;
    expect(await graph(first, [type])).toMatchObject({
      total: 2, nextOffset: 1, edges: [{ relationKind, direction: "incoming", from: { primaryKey: "first" } }],
      neighbors: [{ primaryKey: "first", label: "first view" }],
    });
    expect(await graph(await plan(OBJECT_TYPE, "Order", { ...incoming, offset: 1 }), [type])).toMatchObject({
      total: 2, nextOffset: null, neighbors: [{ primaryKey: "second" }],
    });
    await expect(first.present(owner, [refused])).rejects.toMatchObject({ status: 403, message: "Model read refused" });
    expect(pgQueryMock.mock.calls.slice(beforeReverse)).toMatchObject(Array.from({ length: 2 }, () =>
      [expect.stringContaining(" AND definition->>'objectType'=$2"), [owner.domainId, "Order"]]));
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("reads registered agent execution-user neighbors with VIEW, directory refusals and OSS identity aliases", async () => {
    const real = await vi.importActual<typeof import("../../assistant/definition-relations")>("../../assistant/definition-relations");
    vi.mocked(listAgentDefinitionNodes).mockImplementation(real.listAgentDefinitionNodes);
    vi.mocked(listAgentExecutionUserRelations).mockImplementation(real.listAgentExecutionUserRelations);
    const agent = (id: string, execution_user_id: string | null, kind = "custom") =>
      ({ id, name: id + " name", kind, enabled: true, execution_user_id });
    const rows = [
      agent("admitted", "user-1"), agent("blocked", "user-1"), agent("builder", "user-1", "app-builder"),
      agent("legacy", "admin"), agent("direct", "system"), agent("unset", null),
    ];
    const range = { fixed: false, all: false, authorId: null, objectIds: ["admitted", "legacy", "direct", "builder", "unset"] };
    pgQueryMock.mockImplementation(async (sql: string, [domain, allowed, selected]: [string, string | string[], string[]?]) => {
      expect(domain).toBe(owner.domainId);
      expect(sql).toContain("domain_id=$1 AND kind NOT IN ('app-builder','ops-diagnosis')");
      expect(sql).not.toMatch(/a\.skills|system_prompt/);
      if (sql.startsWith("SELECT execution_user_id ")) {
        expect(sql).toContain(" AND id::text=$2");
        return { rows: rows.filter(row => row.kind === "custom" && row.id === allowed)
          .map(({ execution_user_id }) => ({ execution_user_id })) };
      }
      expect(allowed).toEqual(range.objectIds);
      expect(sql).toContain("a.id::text = ANY($2::text[])");
      const matching = rows.filter(row => range.objectIds.includes(row.id) && row.kind === "custom");
      if (sql.includes("AND a.execution_user_id = ANY($3::text[])")) {
        return { rows: matching.filter(row => row.execution_user_id !== null && selected!.includes(row.execution_user_id)) };
      }
      expect(sql).toContain("AND a.id::text = ANY($3::text[])");
      return { rows: matching.filter(row => selected!.includes(row.id)) };
    });

    const relationKind = "agent.executes-as-user";
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const prepare = async (className: string, primaryKey: string, viewer = owner) =>
      (await prepareRegisteredOntologyRead(selection, viewer, credentials, {
        node: { className, primaryKey }, relationKinds: [relationKind],
        direction: className === USER ? "incoming" : "outgoing", targetClass: className === USER ? AGENT_DEFINITION : USER,
      }))!;
    const scope = { status: "ready", visibility: { AGENT: { VIEW: range } } } as const;
    const shared = { status: "ready", payload: ["admitted"] } as const;
    const alice = { status: "ready", payload: {
      names: [{ id: "user-1", name: "Alice", loginCode: "alice" }], emptyDirectory: false,
    } } as const;
    const noMembers = { status: "forbidden", error: "Member directory refused" } as const;
    const graph = async (plan: Awaited<ReturnType<typeof prepare>>, facts: readonly JavaPanelReadResult[], viewer = owner) =>
      platformOntologyNeighborsResponseSchema.parse(await plan.present(viewer, facts));

    const outgoing = await prepare(AGENT_DEFINITION, "admitted");
    expect(outgoing.facts).toEqual([
      { visibleKinds: [{ kind: "AGENT", verbs: ["VIEW"] }] },
      { call: { type: ONTOLOGY_TYPE, name: "domainSharedUse", parameters: { kind: "AGENT" } } },
      { call: { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: { className: USER, primaryKey: "user-1" } } },
    ]);
    expect(pgQueryMock.mock.calls).toMatchObject([[expect.stringMatching(/^SELECT execution_user_id /), [owner.domainId, "admitted"]]]);
    expect(await graph(outgoing, [scope, shared, alice])).toMatchObject({
      node: { label: "admitted name", detail: expect.stringContaining("enabled") },
      neighbors: [{ className: USER, primaryKey: "user-1", label: "Alice", detail: "alice" }],
      edges: [{ relationKind, direction: "outgoing", from: { primaryKey: "admitted" }, to: { primaryKey: "user-1" } }],
    });
    expect(await graph(outgoing, [scope, shared, noMembers])).toMatchObject({
      neighbors: [{ primaryKey: "user-1", label: "user-1" }], relations: [{ relationKind, status: "ok", edgeCount: 1 }],
    });

    const incoming = await prepare(USER, "user-1");
    expect(incoming.facts).toEqual([
      { call: { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: { className: USER, primaryKey: "user-1" } } },
      ...outgoing.facts.slice(0, 2),
    ]);
    expect(await graph(incoming, [alice, scope, shared])).toMatchObject({
      node: { label: "Alice" }, neighbors: [{ className: AGENT_DEFINITION, primaryKey: "admitted", label: "admitted name" }],
      edges: [{ relationKind, direction: "incoming", from: { primaryKey: "admitted" }, to: { primaryKey: "user-1" } }],
    });
    expect(await graph(incoming, [alice, { status: "forbidden", error: "Agent VIEW refused" }, shared])).toMatchObject({
      relations: [{ relationKind, status: "refused", edgeCount: 0 }],
    });
    const hidden = await prepare(AGENT_DEFINITION, "blocked");
    await expect(hidden.present(owner, [scope, shared, alice])).rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });

    const oss = { ...owner, userId: "system" };
    const unset = await prepare(AGENT_DEFINITION, "unset");
    expect(unset.facts).toEqual(outgoing.facts.slice(0, 2));
    expect(await graph(unset, [scope, shared])).toMatchObject({ edges: [], relations: [{ relationKind, status: "ok", edgeCount: 0 }] });
    const beforeFiltered = pgQueryMock.mock.calls.length;
    const filtered = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node: { className: AGENT_DEFINITION, primaryKey: "admitted" }, relationKinds: [relationKind], direction: "incoming",
    }))!;
    expect(filtered.facts).toEqual(outgoing.facts.slice(0, 2));
    expect(pgQueryMock.mock.calls).toHaveLength(beforeFiltered);

    const legacy = await prepare(AGENT_DEFINITION, "legacy", oss);
    expect(legacy.facts.slice(2)).toEqual([
      { call: { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: { className: USER, primaryKey: "admin" } } },
      { call: { type: ONTOLOGY_TYPE, name: "subjectsCount", parameters: {} } },
    ]);
    const absentAdmin = { status: "ready", payload: { names: [], emptyDirectory: false } } as const;
    const empty = { status: "ready", payload: { total: 0 } } as const;
    const occupied = { status: "ready", payload: { total: 1 } } as const;
    expect(await graph(legacy, [scope, shared, absentAdmin, empty], oss)).toMatchObject({
      edges: [{ to: { primaryKey: "system" } }],
    });
    expect(await graph(legacy, [scope, shared, absentAdmin, occupied], oss)).toMatchObject({
      edges: [{ to: { primaryKey: "admin" } }],
    });
    expect(await graph(legacy, [scope, shared, noMembers, empty], oss)).toMatchObject({
      neighbors: [{ primaryKey: "admin", label: "admin" }],
    });
    const ossCenter = await prepare(USER, "system", oss);
    const ossFacts = { status: "ready", payload: { names: [], emptyDirectory: true } } as const;
    expect((await graph(ossCenter, [ossFacts, scope, shared], oss)).neighbors.map(node => node.primaryKey)).toEqual(["legacy", "direct"]);
    expect((await graph(ossCenter, [noMembers, scope, shared], oss)).neighbors.map(node => node.primaryKey)).toEqual(["direct"]);
    expect(pgQueryMock.mock.calls.filter(([sql]) => sql.includes("a.execution_user_id = ANY")).map(([, params]) => params[2]))
      .toEqual([["user-1"], ["system", "admin"], ["system"]]);
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
    expect(listAgentSkillRelations).not.toHaveBeenCalled();
    expect(assertManagement).not.toHaveBeenCalled();
  });

  it("scopes registered projection bindings to admitted definitions and exact invited endpoints", async () => {
    const projection = (id: string, draft: Record<string, unknown>) => ({
      id, domainId: owner.domainId, ownerId: owner.userId, definition: {
        name: id + " title", description: "", visibility: "domain",
        componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {}, data: {}, ...draft,
      },
    });
    const configured = projection("configured", {
      inputs: { order: { kind: "object", objectType: "Order" } },
      data: {
        orders: { source: { type: { kind: "ObjectType", id: "Order" } }, read: "query", params: {} },
        roles: { source: { type: { kind: "PlatformObjectType", id: ROLE } }, read: "options", params: {} },
      },
      operations: {
        approve: { operation: { kind: "Action", id: "act-1" }, target: { input: "order" } },
      },
    });
    const alternative = projection("unrelated", {
      operations: { approve: { operation: { kind: "PlatformOperation", id: "act-1" } } },
    });
    const chart = projection("chart", {
      componentId: METRIC_CHART_COMPONENT, metricId: "metric-1",
      data: { template: { source: { object: { literal: { className: DASHBOARD_CARD, primaryKey: "card-1" } } },
        read: "chartTemplate", params: {} } },
    });
    const mixed = projection("mixed-binding", {
      data: {
        flow: { source: { object: { literal: { className: WORKFLOW, primaryKey: "workflow-1" } } }, read: "record", params: {} },
        skill: { source: { object: { literal: { className: SKILL, primaryKey: "skill-1" } } }, read: "record", params: {} },
        action: { source: { object: { literal: { className: ACTION, primaryKey: "act-2" } } }, read: "record", params: {} },
        trigger: { source: { object: { literal: { className: TRIGGER, primaryKey: "trigger-1" } } }, read: "record", params: {} },
      },
    });
    const sharedProducts = projection("shared-products", {
      data: {
        orders: { source: { object: { literal: { className: APPLICATION, primaryKey: "orders" } } }, read: "record", params: {} },
        inventory: { source: { object: { literal: { className: APPLICATION, primaryKey: "inventory" } } }, read: "record", params: {} },
        panel: { source: { object: { literal: { className: PRODUCT_PANEL, primaryKey: "summary" } } }, read: "record", params: {} },
      },
    });
    const all = [configured, alternative, chart, mixed, sharedProducts];
    const range = { fixed: false, all: false, authorId: null, objectIds: all.map(row => row.id) };
    pgQueryMock.mockImplementation(async (sql: string, values: unknown[]) => {
      expect(values[0]).toBe(owner.domainId);
      if (sql.includes("WHERE domain_id=$1 AND id=$2")) return { rows: all.filter(row => row.id === values[1]) };
      expect(sql).toContain("p.domain_id=$1");
      expect(sql).toContain("p.id = ANY($2::text[])");
      expect(values[1]).toEqual(range.objectIds);
      if (values[3] === ACTION) return { rows: [configured, alternative] };
      if (values[3] === WORKFLOW) return { rows: [mixed] };
      if (values[3] === METRIC_VIEW) return { rows: [chart] };
      return { rows: [configured] };
    });
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const relationKind = "projection.binds-target";
    const prepare = async (className: string, primaryKey: string, params = {}) =>
      (await prepareRegisteredOntologyRead(selection, owner, credentials, {
        node: { className, primaryKey }, relationKinds: [relationKind], ...params,
      }))!;
    const admitted = { status: "ready", visibility: { PROJECTION: { USE: range } } } as const;
    const nameFacts = (...fromNames: { id: string; name: string; detail?: string }[]) =>
      ({ status: "ready", payload: { links: [], fromNames, toNames: [] } } as const);
    const returnedAction = nameFacts({ id: "act-1", name: "Approve order", detail: "PUBLISHED" });
    const workflow = { status: "ready", payload: [{ id: "workflow-1", name: "Ordering", status: "ACTIVE", version: 4 }] } as const;
    const dependencyCall = (className: string, primaryKey: string) => ({ call: {
      type: ONTOLOGY_TYPE, name: className === ACTION ? "action.uses-function" : "metric-view.uses-function",
      parameters: { className, primaryKey, from: className, to: FUNCTION, direction: "outgoing", includeLinks: false },
    } });
    const workflowCall = { call: { type: ONTOLOGY_TYPE, name: "workflowCenter", parameters: { primaryKey: "workflow-1" } } };
    const model = { status: "ready", payload: {
      center: { classDef: [{ className: "Order", showName: "Orders" }], relationDef: [] }, relations: {},
    } } as const;
    const missingScope = { status: "forbidden", code: "OBJECT_FORBIDDEN", error: "Owner refused" } as const;
    const graph = async (plan: Awaited<ReturnType<typeof prepare>>, facts: readonly JavaPanelReadResult[]) =>
      platformOntologyNeighborsResponseSchema.parse(await plan.present(owner, facts));

    const out = await prepare(PRODUCT_PROJECTION, "configured", { direction: "outgoing" });
    expect(out.facts).toEqual([
      { call: { type: ONTOLOGY_TYPE, name: "modelNeighbors", parameters: { className: OBJECT_TYPE, primaryKey: "Order", relations: [] } } },
      dependencyCall(ACTION, "act-1"),
      { visibleKinds: [{ kind: "PROJECTION", verbs: ["USE"] }] },
    ]);
    expect(await graph(out, [model, returnedAction, admitted])).toMatchObject({
      total: 3, edges: [
        { to: { className: OBJECT_TYPE, primaryKey: "Order" }, binding: { reads: ["query"] } },
        { to: { className: ONTOLOGY_TYPE, primaryKey: ROLE }, binding: { reads: ["options"] } },
        { to: { className: ACTION, primaryKey: "act-1" }, binding: { operations: ["act-1"] } },
      ],
      neighbors: [{ label: "Orders" }, { label: ROLE }, { label: "Approve order", detail: "PUBLISHED" }],
    });
    expect(await graph(out, [missingScope, nameFacts(), admitted])).toMatchObject({
      relations: [{ relationKind, status: "ok", edgeCount: 3 }],
      neighbors: [{ label: "Order" }, { label: ROLE }, { label: "act-1" }],
    });
    await expect(out.present(owner, [model, returnedAction, {
      status: "ready", visibility: { PROJECTION: { USE: { ...range, objectIds: [] } } },
    }])).rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
    expect(pgQueryMock).toHaveBeenCalledTimes(1);

    const typeOnly = await prepare(PRODUCT_PROJECTION, "configured", { targetClass: ONTOLOGY_TYPE });
    expect(typeOnly.facts).toEqual([out.facts[2]]);
    expect(await graph(typeOnly, [admitted])).toMatchObject({ total: 1, neighbors: [{ className: ONTOLOGY_TYPE, primaryKey: ROLE }] });
    const metric = await prepare(PRODUCT_PROJECTION, "chart");
    expect(metric.facts).toEqual([
      dependencyCall(METRIC_VIEW, "metric-1"),
      out.facts[2],
    ]);
    expect(await graph(metric, [nameFacts({ id: "metric-1", name: "Revenue" }), admitted]))
      .toMatchObject({ total: 1, neighbors: [{ primaryKey: "metric-1", label: "Revenue" }] });

    const mixedPlan = await prepare(PRODUCT_PROJECTION, "mixed-binding");
    const triggerCall = { call: { type: ONTOLOGY_TYPE, name: "triggerCenter", parameters: { primaryKey: "trigger-1" } } };
    const trigger = { status: "ready", payload: [{ id: "trigger-1", title: "Daily order", targetKind: "workflow", targetId: "workflow-1" }] } as const;
    expect(mixedPlan.facts).toEqual([workflowCall, dependencyCall(ACTION, "act-2"), triggerCall, out.facts[2]]);
    expect(await graph(mixedPlan, [workflow, nameFacts({ id: "act-2", name: "Ship order" }), trigger, admitted])).toMatchObject({
      relations: [{ relationKind, status: "ok", edgeCount: 4 }],
      neighbors: [
        { className: WORKFLOW, primaryKey: "workflow-1", label: "Ordering", detail: "v4" },
        { className: SKILL, primaryKey: "skill-1", label: "skill-1" },
        { className: ACTION, primaryKey: "act-2", label: "Ship order" },
        { className: TRIGGER, primaryKey: "trigger-1", label: "Daily order", detail: "workflow" },
      ],
    });
    const byWorkflow = await prepare(WORKFLOW, "workflow-1", { direction: "incoming" });
    expect(byWorkflow.facts).toEqual([workflowCall, out.facts[2]]);
    expect(await graph(byWorkflow, [workflow, admitted])).toMatchObject({
      node: { label: "Ordering", detail: "v4" },
      edges: [{ from: { primaryKey: "mixed-binding" }, binding: { reads: ["record"] } }],
    });

    const byAction = await prepare(ACTION, "act-1", { direction: "incoming", targetClass: PRODUCT_PROJECTION });
    expect(byAction.facts).toEqual(out.facts.slice(1));
    const beforeReverse = pgQueryMock.mock.calls.length;
    expect(await graph(byAction, [returnedAction, admitted])).toMatchObject({
      total: 1, edges: [{ direction: "incoming", from: { primaryKey: "configured" } }],
      neighbors: [{ primaryKey: "configured", label: "configured title" }],
    });
    await expect(byAction.present(owner, [nameFacts(), admitted])).rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
    expect(pgQueryMock.mock.calls.slice(beforeReverse)).toHaveLength(1);

    for (const [type, key, dependency, ownerReply] of [
      [ACTION, "act-1", "action.uses-function", returnedAction],
      [METRIC_VIEW, "metric-1", "metric-view.uses-function", nameFacts({ id: "metric-1", name: "Revenue" })],
    ] as const) {
      const both = await prepare(type, key, { relationKinds: [relationKind, dependency] });
      expect(both.facts.map(fact => fact.call?.name)).toEqual([dependency, undefined]);
      expect(both.facts[0].call?.parameters).not.toHaveProperty("includeLinks");
      const linked = { status: "ready", payload: {
        ...ownerReply.payload, links: [{ fromId: key, toId: "fn-1" }], toNames: [{ id: "fn-1", name: "Function" }],
      } } as const;
      expect((await graph(both, [linked, admitted])).edges.map(edge => edge.relationKind).sort())
        .toEqual([dependency, relationKind].sort());
    }
    const stepKind = "role.owns-workflow-step";
    const workflowBoth = await prepare(WORKFLOW, "workflow-1", { relationKinds: [relationKind, stepKind] });
    expect(workflowBoth.facts.map(fact => fact.call?.name)).toEqual([stepKind, "workflowCenter", undefined]);
    const stepLink = { status: "ready", payload: {
      workflows: [], links: [{ roleId: "role-1", workflowId: "workflow-1", stepNo: 1, activatedByWorkflowVersion: "4" }],
    } } as const;
    expect((await graph(workflowBoth, [stepLink, workflow, admitted])).edges.map(edge => edge.relationKind).sort())
      .toEqual([relationKind, stepKind].sort());
    const functionBoth = await prepare(FUNCTION, "fn-1", { relationKinds: [relationKind, "action.uses-function"] });
    expect(functionBoth.facts.map(fact => fact.call?.name)).toEqual(["action.uses-function", "functionCenter", undefined]);

    const sharedPlan = await prepare(PRODUCT_PROJECTION, "shared-products");
    expect(sharedPlan.facts.filter(({ call }) => call?.name === "ontologyDomainShared" || call?.name === "domainSharedUse"))
      .toEqual([
        { call: { type: ONTOLOGY_TYPE, name: "domainSharedUse", parameters: { kind: "PANEL", ids: ["summary"] } } },
        { call: { type: APPLICATION, name: "ontologyDomainShared", parameters: { ids: ["orders", "inventory"] } } },
      ]);
    const appCenter = await prepare(APPLICATION, "orders");
    expect(appCenter.facts.find(({ call }) => call?.name === "ontologyDomainShared")?.call?.parameters)
      .toEqual({ ids: ["orders"] });

    const byType = await prepare(ONTOLOGY_TYPE, ROLE, { direction: "incoming", targetClass: PRODUCT_PROJECTION });
    expect(byType.facts).toEqual([out.facts[2]]);
    expect(await graph(byType, [admitted])).toMatchObject({ edges: [{
      direction: "incoming", from: { primaryKey: "configured" }, binding: { reads: ["options"] },
    }] });
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
    expect(listAgentSkillRelations).not.toHaveBeenCalled();
  });

  it("presents the same scoped authorship for a literal User target and a User binding center", async () => {
    const user = { className: USER, primaryKey: "member-1" };
    const projection = { className: PRODUCT_PROJECTION, primaryKey: "member-summary" };
    const row = { id: projection.primaryKey, domainId: owner.domainId, ownerId: owner.userId, definition: {
      name: "Member summary", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectSummary",
      inputs: {}, outputs: {}, config: {}, data: { record: { source: { object: { literal: user } }, read: "record", params: {} } },
    } };
    pgQueryMock.mockResolvedValue({ rows: [row] });
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const relationKind = "projection.binds-target";
    const prepare = async (node: typeof user | typeof projection, viewer = owner) =>
      (await prepareRegisteredOntologyRead(selection, viewer, credentials, { node, relationKinds: [relationKind] }))!;
    const admitted: JavaPanelReadResult = { status: "ready", visibility: { PROJECTION: { USE: {
      fixed: false, all: false, authorId: null, objectIds: [row.id],
    } } } };
    const member = { status: "ready", payload: {
      names: [{ id: user.primaryKey, name: "Alice", loginCode: "alice" }], emptyDirectory: false,
    } } as const;
    const bucket = (names: string[], total = names.length) => ({ names, total });
    const summary = (created: ReturnType<typeof bucket>, reviewed: ReturnType<typeof bucket>): JavaPanelReadResult =>
      ({ status: "ready", payload: { [user.primaryKey]: { created, reviewed } } });
    const action = summary(bucket(["First", "Same"], 2), bucket([]));
    const workflow = summary(bucket(["Same"]), bucket(["Review flow"]));
    const metric = summary(bucket(["Total", "Count"], 2), bucket(["Total"]));
    const denied = { status: "forbidden", error: "Members read refused" } as const;
    const failed = { status: "error", error: "Workflow facts failed" } as const;
    const out = await prepare(projection);
    const inbound = await prepare(user);
    for (const plan of [out, inbound]) {
      expect(plan.facts.flatMap(({ call }) => call?.name === "userProvenanceByMember" ? [call] : [])).toEqual(
        [ACTION, WORKFLOW, METRIC_VIEW].map(type => ({
          type, name: "userProvenanceByMember", parameters: { memberIds: [user.primaryKey], limit: 3 },
        })),
      );
    }
    const ready = [member, action, workflow, metric, admitted];
    const detail = "alice · Created: First、Same、Same +2 · Reviewed: Review flow、Total";
    await expect(out.present(owner, ready)).resolves.toMatchObject({
      neighbors: [{ ...user, label: "Alice", detail }],
    });
    await expect(inbound.present(owner, ready)).resolves.toMatchObject({
      node: { ...user, label: "Alice", detail }, edges: [{ relationKind, direction: "incoming" }],
    });
    await expect(out.present(owner, [member, action, failed, metric, admitted])).resolves.toMatchObject({
      neighbors: [{ label: "Alice", detail: "alice · Created: First、Same、Total +1 · Reviewed: Total" }],
    });
    await expect(out.present(owner, [denied, action, workflow, metric, admitted])).resolves.toMatchObject({
      edges: [{ relationKind, to: user }], neighbors: [{ ...user, label: user.primaryKey }],
    });
    await expect(inbound.present(owner, [denied, action, workflow, metric, admitted])).rejects.toMatchObject({ status: 403 });
    const oss = { ...owner, userId: "system" };
    const self = await prepare({ className: USER, primaryKey: oss.userId }, oss);
    await expect(self.present(oss, [{ status: "ready", payload: { names: [], emptyDirectory: true } },
      { status: "ready", payload: {} }, { status: "ready", payload: {} }, { status: "ready", payload: {} }, admitted]))
      .resolves.toMatchObject({ node: { primaryKey: "system", label: "system" } });
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("reads registered projection component neighbors with projection USE and the shipped SDK directory", async () => {
    const componentId = "@ontomato/sdk:ObjectList";
    const unpublishedInSdk = "other-package:PrivateComponent";
    const builtin = "builtin-product-projection";
    const projection = (id: string, componentId: string) => ({ id, definition: {
      name: id + " title", description: "", visibility: id === builtin ? "platform" : "domain", componentId,
      inputs: {}, outputs: {}, data: {}, config: {},
    } });
    const rows = [
      projection("admitted", componentId),
      projection(builtin, componentId),
      projection("blocked", componentId),
      projection("different-sdk", "@ontomato/sdk:ObjectForm"),
      projection("outside-sdk", unpublishedInSdk),
    ];
    const range = { fixed: true, all: false, authorId: null, objectIds: ["admitted", "different-sdk", "outside-sdk"] };
    pgQueryMock.mockImplementation(async (_sql: string, [domain, allowed, selected]: [string, string[], string | string[]]) => {
      expect(domain).toBe(owner.domainId);
      expect(allowed).toEqual(range.objectIds);
      return { rows: rows.filter(({ id, definition }) =>
        (id === builtin || allowed.includes(id)) &&
        (Array.isArray(selected) ? selected.includes(id) : selected === definition.componentId)) };
    });
    const relationKind = "projection.uses-component";
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const prepare = async (className: string, primaryKey: string, params = {}) =>
      (await prepareRegisteredOntologyRead(selection, owner, credentials, { node: { className, primaryKey },
        relationKinds: [relationKind], ...params }))!;
    const facts: JavaPanelReadResult[] = [{ status: "ready", visibility: { PROJECTION: { USE: range } } }];
    const graph = async (plan: Awaited<ReturnType<typeof prepare>>, results = facts) =>
      platformOntologyNeighborsResponseSchema.parse(await plan.present(owner, results));

    const outgoing = await prepare(PRODUCT_PROJECTION, "admitted", { direction: "outgoing", targetClass: SDK_COMPONENT });
    expect(outgoing.facts).toEqual([{ visibleKinds: [{ kind: "PROJECTION", verbs: ["USE"] }] }]);
    expect(await graph(outgoing)).toMatchObject({
      node: { primaryKey: "admitted", label: "admitted title" },
      neighbors: [{ primaryKey: componentId, label: "ObjectList", detail: "@ontomato/sdk/base" }],
      edges: [{ relationKind, direction: "outgoing", from: { primaryKey: "admitted" }, to: { primaryKey: componentId } }],
    });
    expect(pgQueryMock.mock.calls.map(([, values]) => values[2])).toEqual([["admitted"]]);

    const incoming = { direction: "incoming", targetClass: PRODUCT_PROJECTION, limit: 1 };
    const first = await graph(await prepare(SDK_COMPONENT, componentId, incoming));
    const second = await graph(await prepare(SDK_COMPONENT, componentId, { ...incoming, offset: first.nextOffset }));
    expect(first).toMatchObject({
      node: { primaryKey: componentId, label: "ObjectList" }, total: 2, nextOffset: 1,
      edges: [{ relationKind, direction: "incoming", from: { primaryKey: "admitted" }, to: { primaryKey: componentId } }],
    });
    expect(second).toMatchObject({ total: 2, nextOffset: null, neighbors: [{ primaryKey: builtin }] });
    expect(pgQueryMock.mock.calls.slice(1).map(([, values]) => values[2]))
      .toEqual([componentId, componentId]);

    const filtered = await prepare(SDK_COMPONENT, componentId, { direction: "outgoing" });
    expect(filtered.facts).toEqual([]);
    expect(await graph(filtered, [])).toMatchObject({ total: 0, relations: [] });
    const withheld = await prepare(SDK_COMPONENT, componentId, incoming);
    expect(await graph(withheld, [{ status: "forbidden", error: "Projection scope refused" }])).toMatchObject({
      node: { primaryKey: componentId }, relations: [{ relationKind, status: "refused", edgeCount: 0 }],
    });
    const deniedProjection = await prepare(PRODUCT_PROJECTION, "blocked");
    await expect(deniedProjection.present(owner, facts)).rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });

    // A stored projection reference still has its ID. Only shipped components can be centers.
    const rawReference = await prepare(PRODUCT_PROJECTION, "outside-sdk");
    expect(await graph(rawReference)).toMatchObject({
      neighbors: [{ primaryKey: unpublishedInSdk, label: unpublishedInSdk }], total: 1,
    });
    const missingCenter = await prepare(SDK_COMPONENT, unpublishedInSdk);
    await expect(missingCenter.present(owner, facts)).rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
    vi.mocked(readPanelComponentCatalogue).mockRejectedValueOnce(new HttpError(403, "SDK catalogue refused"));
    await expect(withheld.present(owner, facts)).rejects.toMatchObject({ status: 403, message: "SDK catalogue refused" });

    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
    expect(decideProductObjects).not.toHaveBeenCalled();
    expect(assertManagement).not.toHaveBeenCalled();
  });

  it("reads registered panel containment in both directions with the actual endpoint USE ranges", async () => {
    const projection = "builtin-product-fixed-projection";
    const fixedChild = "builtin-product-fixed-panel";
    const panel = (id: string, state = {}, members = {}) => ({ id, definition: {
      name: id + " title", description: "", visibility: id === fixedChild ? "platform" : "domain",
      content: { html: "<div/>" }, manifest: { state, members },
    } });
    const projectionRow = (id: string, visibility: string) => ({ id, definition: {
      name: id + " title", description: "", visibility, componentId: "@ontomato/sdk:ObjectList",
      inputs: {}, outputs: {}, data: {}, config: {},
    } });
    const panelRows = [
      panel("root", {
        active: { type: { kind: "object", objectType: "Order" } },
        tab: { type: { kind: "object", objectType: PRODUCT_PANEL } },
        slot: { type: { kind: "placement", candidates: { rule: "usable" } },
          default: { id: "slot-1", target: { projectionId: "placement-projection" } } },
        panelSlot: { type: { kind: "placement", candidates: { panelIds: [fixedChild] } } },
      }, {
        projection: { target: { projectionId: projection } },
        deniedProjection: { target: { projectionId: "panel-only-use" } },
        child: { target: { panelId: "child" } },
        hidden: { target: { panelId: "hidden" } },
        absent: { target: { panelId: "missing" } },
        self: { target: { panelId: "root" } },
        tab: { target: { fromState: "tab", candidates: { panelIds: ["tab-candidate"] } } },
        detail: { target: { fromState: "active", candidates: { rule: "objectDetail" } } },
      }),
      panel("parent", {}, { root: { target: { panelId: "root" } } }),
      panel("unrelated", {}, { projection: { target: { projectionId: "other-projection" } } }),
      panel("hidden", {}, { root: { target: { panelId: "root" } }, projection: { target: { projectionId: projection } } }),
      ...["panel-only-use", "child", "tab-candidate", "detail", fixedChild].map(id => panel(id)),
    ];
    const projectionRows = [projectionRow(projection, "platform"), ...["placement-projection", "panel-only-use", "other-projection"]
      .map(id => projectionRow(id, "domain"))];
    const panelRange = { fixed: true, all: false, objectIds: [
      "root", "parent", "unrelated", "child", "panel-only-use", "tab-candidate", "detail", "missing",
    ], authorId: null };
    const projectionRange = { fixed: true, all: false, objectIds: ["placement-projection", "other-projection"], authorId: null };
    pgQueryMock.mockImplementation(async (sql: string, [domainId, allowed, selected]: [string, string[], string[]?]) => {
      const isPanel = sql.includes("product_panels");
      expect(domainId).toBe(owner.domainId);
      expect(allowed).toEqual(isPanel ? panelRange.objectIds : projectionRange.objectIds);
      const rows = (isPanel ? panelRows : projectionRows).filter(({ id }) =>
        (id.startsWith("builtin-product-") || allowed.includes(id)) && (!selected || selected.includes(id)));
      return { rows: rows.sort((a, b) => a.id.localeCompare(b.id)) };
    });
    vi.mocked(listObjectDetailPanelMappings).mockResolvedValue([
      { className: "Order", panelId: "detail" }, { className: "Other", panelId: "hidden" },
    ]);
    const relationKinds = ["panel.contains-projection", "panel.contains-panel"];
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const prepare = async (className: string, primaryKey: string, params = {}) =>
      (await prepareRegisteredOntologyRead(selection, owner, credentials, { node: { className, primaryKey }, relationKinds, ...params }))!;
    const replies = (plan: Awaited<ReturnType<typeof prepare>>, denyProjection = false) =>
      plan.facts.map(({ visibleKinds }): JavaPanelReadResult => visibleKinds?.[0].kind === "PANEL"
        ? { status: "ready", visibility: { PANEL: { USE: panelRange } } }
        : denyProjection ? { status: "forbidden", error: "Projection scope refused" }
        : { status: "ready", visibility: { PROJECTION: { USE: projectionRange } } });
    const graph = async (plan: Awaited<ReturnType<typeof prepare>>, denyProjection = false) =>
      platformOntologyNeighborsResponseSchema.parse(await plan.present(owner, replies(plan, denyProjection)));

    const outgoing = await prepare(PRODUCT_PANEL, "root", { direction: "outgoing" });
    expect(outgoing.facts).toEqual([
      { visibleKinds: [{ kind: "PANEL", verbs: ["USE"] }] },
      { visibleKinds: [{ kind: "PROJECTION", verbs: ["USE"] }] },
    ]);
    const fromRoot = await graph(outgoing);
    expect(fromRoot.node.label).toBe("root title");
    expect(fromRoot.edges.map(edge => [edge.direction, edge.to.primaryKey])).toEqual([
      projection, "placement-projection", "child", "tab-candidate", "detail", fixedChild,
    ].map(id => ["outgoing", id]));
    expect(fromRoot.neighbors.find(node => node.primaryKey === projection)).toMatchObject({
      label: projection + " title", detail: "@ontomato/sdk:ObjectList",
    });
    expect(pgQueryMock.mock.calls.every(([, values]) => values.length === 3)).toBe(true);

    const fromProjection = await graph(await prepare(PRODUCT_PROJECTION, projection, { direction: "incoming", targetClass: PRODUCT_PANEL }));
    expect(fromProjection.edges).toMatchObject([{
      relationKind: relationKinds[0], direction: "incoming", from: { primaryKey: "root" }, to: { primaryKey: projection },
    }]);
    expect(fromProjection.neighbors).toMatchObject([{ primaryKey: "root", label: "root title" }]);

    const intoRoot = await prepare(PRODUCT_PANEL, "root", { direction: "incoming", targetClass: PRODUCT_PANEL });
    expect(intoRoot.facts).toHaveLength(1);
    expect((await graph(intoRoot)).edges).toMatchObject([{
      relationKind: relationKinds[1], direction: "incoming", from: { primaryKey: "parent" }, to: { primaryKey: "root" },
    }]);
    const both = await graph(await prepare(PRODUCT_PANEL, "root", { direction: "both", targetClass: PRODUCT_PANEL, limit: 1 }));
    expect(both).toMatchObject({ total: 5, nextOffset: 1, edges: [{ direction: "incoming", from: { primaryKey: "parent" } }] });

    const filtered = await prepare(PRODUCT_PROJECTION, projection, { direction: "outgoing" });
    expect(filtered.facts).toEqual([{ visibleKinds: [{ kind: "PROJECTION", verbs: ["USE"] }] }]);
    expect(await graph(filtered)).toMatchObject({ edges: [], relations: [], node: { primaryKey: projection } });
    const missing = await prepare(PRODUCT_PANEL, "hidden");
    await expect(missing.present(owner, replies(missing))).rejects.toMatchObject({ code: "OBJECT_NOT_FOUND" });

    const refused = await graph(outgoing, true);
    expect(refused.relations).toMatchObject([
      { relationKind: relationKinds[0], status: "refused", edgeCount: 0 },
      { relationKind: relationKinds[1], status: "ok", edgeCount: 4 },
    ]);
    vi.mocked(listObjectDetailPanelMappings).mockRejectedValueOnce(new Error("Mappings unavailable"));
    const incomplete = await graph(outgoing);
    expect(incomplete.relations).toMatchObject([
      { relationKind: relationKinds[0], status: "ok", edgeCount: 2 },
      { relationKind: relationKinds[1], status: "failed", edgeCount: 0 },
    ]);
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
    expect(decideProductObjects).not.toHaveBeenCalled();
  });

  it.each([
    ["user.member-of-org-unit", ORG_UNIT, "unit", "Engineering"],
    ["user.holds-org-position", ORG_POSITION, "position", "Lead"],
  ])("keeps the %s edge separate from member name authorization in both directions", async (relationKind, type, id, label) => {
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const userNode = { className: USER, primaryKey: "member" };
    const orgNode = { className: type, primaryKey: id };
    const edge = { status: "ready", payload: {
      links: [{ fromId: "member", toId: id }], fromNames: [], toNames: [{ id, name: label }],
    } } as const;
    const orgCenter = { status: "ready", payload: { names: [{ id, name: label }], emptyDirectory: false } } as const;
    const memberCenter = { status: "ready", payload: { names: [{ id: "member", name: "Reader" }], emptyDirectory: false } } as const;
    const outgoing = (await prepareRegisteredOntologyRead(selection, owner, credentials,
      { node: userNode, direction: "outgoing", targetClass: type, relationKinds: [relationKind] }))!;
    expect(outgoing.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: relationKind, parameters: { ...userNode, from: USER, to: type, direction: "outgoing" } },
      { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: userNode },
    ]);
    await expect(outgoing.present(owner, [edge, memberCenter])).resolves.toMatchObject({
      node: { label: "Reader" }, edges: [{ relationKind, direction: "outgoing" }], neighbors: [{ label }],
    });
    await expect(outgoing.present(owner, [edge, { status: "forbidden", error: "Center unreadable" }]))
      .rejects.toMatchObject({ status: 403 });

    const incoming = (await prepareRegisteredOntologyRead(selection, owner, credentials,
      { node: orgNode, direction: "incoming", targetClass: USER, relationKinds: [relationKind] }))!;
    const scope = { ...orgNode, from: USER, to: type, direction: "incoming" };
    expect(incoming.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: relationKind, parameters: scope },
      { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: orgNode },
      { type: ONTOLOGY_TYPE, name: "organizationMemberNames", parameters: scope },
    ]);
    const names = { status: "ready", payload: [{ id: "member", name: "Reader" }] } as const;
    await expect(incoming.present(owner, [edge, orgCenter, names])).resolves.toMatchObject({
      neighbors: [{ label: "Reader" }], edges: [{ relationKind, direction: "incoming" }],
    });
    await expect(incoming.present(owner, [edge, orgCenter, { status: "forbidden", error: "Members unreadable" }])).resolves.toMatchObject({
      neighbors: [{ label: "member" }], relations: [{ status: "ok", edgeCount: 1 }],
    });
    await expect(incoming.present(owner, [{ status: "forbidden", error: "Organization unreadable" }, orgCenter, names])).resolves.toMatchObject({
      neighbors: [], edges: [], relations: [{ status: "refused", reason: "Organization unreadable" }],
    });
    expect(backendPost).not.toHaveBeenCalled();
    expect(backendGet).not.toHaveBeenCalled();
  });

  it.each([
    ["org-grant.applies-to-org-unit", ORG_UNIT, "subtree", "Example", "组织含下级 · Example"],
    ["org-grant.applies-to-org-position", ORG_POSITION, "position", "Example", "岗位 · Example"],
    ["org-grant.grants-role", ROLE, "organization", "Review role", "组织 · Example"],
  ])("plans both directions of %s with independently authorized role names", async (relationKind, type, grantType, name, grantLabel) => {
    const grant = { id: `${grantType}:source`, grantType, sourceId: "source", sourceName: "Example" };
    const orgNode = { className: ORG_GRANT, primaryKey: grant.id };
    const targetNode = { className: type, primaryKey: type === ROLE ? "role-1" : "source" };
    const orgCenter = { status: "ready", payload: [grant] } as const;
    const targetCenter = { status: "ready", payload: { names: [{ id: targetNode.primaryKey, name }], emptyDirectory: false } } as const;
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    for (const direction of ["outgoing", "incoming"] as const) {
      const outgoing = direction === "outgoing";
      const node = outgoing ? orgNode : targetNode;
      const plan = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
        node, direction, targetClass: outgoing ? type : ORG_GRANT, relationKinds: [relationKind],
      }))!;
      const roleNames = outgoing && type === ROLE;
      expect(plan.facts[0].call).toEqual({ type: ONTOLOGY_TYPE, name: relationKind,
        parameters: { ...node, from: ORG_GRANT, to: type, direction } });
      expect(plan.facts.slice(1).map(({ call }) => call?.name)).toEqual([
        outgoing ? "orgGrantCenter" : "governanceCenter",
        ...(roleNames ? ["orgGrantRoleDirectoryNames", "orgGrantWorkflowRoleNames"] : []),
      ]);
      const edge = { status: "ready", payload: {
        links: [{ fromId: grant.id, toId: targetNode.primaryKey }], grants: outgoing ? [] : [grant],
        toNames: outgoing && !roleNames ? [{ id: targetNode.primaryKey, name }] : [],
      } } as const;
      const results: JavaPanelReadResult[] = [edge, outgoing ? orgCenter : targetCenter];
      if (roleNames) results.push({ status: "forbidden", error: "Role directory denied" },
        { status: "ready", payload: [{ roleId: "role-1", roleCode: name }] });
      await expect(plan.present(owner, results)).resolves.toMatchObject({
        node: { label: outgoing ? grantLabel : name }, edges: [{ relationKind, direction }],
        neighbors: [{ label: outgoing ? name : grantLabel }],
      });
      if (roleNames) {
        await expect(plan.present(owner, [edge, orgCenter, { status: "ready", payload: [{ roleId: "role-1", roleCode: "Current name" }] },
          { status: "ready", payload: [{ roleId: "role-1", roleCode: "Historical name" }] }])).resolves.toMatchObject({
          neighbors: [{ label: "Current name" }],
        });
        await expect(plan.present(owner, [edge, orgCenter, { status: "forbidden", error: "Directory denied" },
          { status: "forbidden", error: "Workflow grants denied" }])).resolves.toMatchObject({
          neighbors: [{ label: "role-1" }], relations: [{ status: "ok", edgeCount: 1 }],
        });
      }
      if (outgoing) await expect(plan.present(owner, [edge, { status: "ready", payload: [] }]))
        .rejects.toMatchObject({ status: 404, code: "OBJECT_NOT_FOUND" });
    }
    expect(backendPost).not.toHaveBeenCalled();
    expect(backendGet).not.toHaveBeenCalled();
  });

  it("keeps denied neighbor relations separate from the authorized center and target filter", async () => {
    const node = { className: ROLE, primaryKey: "analyst" };
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const plan = (await prepareRegisteredOntologyRead(selection, owner, credentials, { node, direction: "outgoing" }))!;
    const facts = plan.facts.map(({ call }): JavaPanelReadResult => call?.name === "governanceCenter"
      ? { status: "ready", payload: { names: [{ id: node.primaryKey, name: "Analyst" }], emptyDirectory: false } }
      : { status: "forbidden", error: "Policy owner refused" });
    const graph = platformOntologyNeighborsResponseSchema.parse(await plan.present(owner, facts));
    expect(graph.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationKind: "role.uses-permission-policy", status: "refused", edgeCount: 0 }),
      expect.objectContaining({ relationKind: "role.owns-workflow-step", status: "refused", edgeCount: 0 }),
    ]));
    expect(graph.node.label).toBe("Analyst");
    const filtered = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node, direction: "outgoing", targetClass: USER,
    }))!;
    expect(filtered.facts.map(({ call }) => call?.name)).toEqual(["governanceCenter"]);
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("presents workflow step edges and outgoing labels from one fact, with an independent workflow center", async () => {
    const relationKind = "role.owns-workflow-step";
    const role = { className: ROLE, primaryKey: "role-1" };
    const workflow = { className: WORKFLOW, primaryKey: "wf-1" };
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const links = [{
      roleId: role.primaryKey, roleCode: "Reviewer", workflowId: workflow.primaryKey,
      stepNo: 2, activatedByWorkflowVersion: "3",
      scope: { kind: "self_organization", className: "Order", field: "orgId" },
    }];
    const roleCenter = { status: "ready", payload: {
      names: [{ id: role.primaryKey, name: "Review role" }], emptyDirectory: false,
    } } as const;
    const workflows = { status: "ready", payload: [{ id: workflow.primaryKey, name: "Approval", status: "ACTIVE", version: 4 }] } as const;
    const refused = { status: "forbidden", error: "Workflow grants denied" } as const;
    const outgoing = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node: role, direction: "outgoing", targetClass: WORKFLOW,
    }))!;
    expect(outgoing.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: relationKind, parameters: { ...role, from: ROLE, to: WORKFLOW, direction: "outgoing" } },
      { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: role },
    ]);
    const authorization = {
      stepNo: 2, version: 3, scope: "self_organization", scopeLabel: "Own organization", scopeField: "Order.orgId",
    };
    await expect(outgoing.present(owner, [
      { status: "ready", payload: { links, workflows: workflows.payload } }, roleCenter,
    ])).resolves.toMatchObject({
      node: { label: "Review role" },
      edges: [{ relationKind, direction: "outgoing", from: role, to: workflow, authorization }],
      neighbors: [{ ...workflow, label: "Approval", detail: "v4" }],
    });
    const unlabeledEdge = { status: "ready", payload: { links, workflows: [] } } as const;
    await expect(outgoing.present(owner, [unlabeledEdge, roleCenter])).resolves.toMatchObject({
      neighbors: [{ ...workflow, label: workflow.primaryKey }], relations: [{ status: "ok", edgeCount: 1 }],
    });

    const incoming = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node: workflow, direction: "incoming", targetClass: ROLE,
    }))!;
    expect(incoming.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: relationKind, parameters: { ...workflow, from: ROLE, to: WORKFLOW, direction: "incoming" } },
      { type: ONTOLOGY_TYPE, name: "workflowCenter", parameters: { primaryKey: workflow.primaryKey } },
    ]);
    await expect(incoming.present(owner, [unlabeledEdge, workflows])).resolves.toMatchObject({
      node: { label: "Approval", detail: "v4" },
      edges: [{ relationKind, direction: "incoming", from: role, to: workflow, authorization }],
      neighbors: [{ ...role, label: "Reviewer" }],
    });
    await expect(incoming.present(owner, [refused, workflows])).resolves.toMatchObject({
      node: { label: "Approval" }, edges: [], relations: [{ status: "refused", edgeCount: 0 }],
    });
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("reads workflow step action references in both directions without requiring Action visibility for an edge", async () => {
    const relationKind = "workflow.step-references-action";
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const workflow = { className: WORKFLOW, primaryKey: "wf-1" };
    const action = { className: ACTION, primaryKey: "act-1" };
    const hidden = { className: ACTION, primaryKey: "act-2" };
    const link = { fromId: workflow.primaryKey, toId: action.primaryKey };
    const workflows = [{ id: workflow.primaryKey, name: "Approval", status: "ACTIVE", version: 4 }];
    const actions = [{ id: action.primaryKey, name: "Approve", detail: "PUBLISHED" }];
    const outgoing = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node: workflow, direction: "outgoing", targetClass: ACTION,
    }))!;
    expect(outgoing.facts.map(({ call }) => call?.name)).toEqual([relationKind, "workflowStepActionNames"]);
    const references = { status: "ready", payload: { workflows, links: [link, link, { ...link, toId: hidden.primaryKey }] } } as const;
    await expect(outgoing.present(owner, [references, { status: "ready", payload: actions }])).resolves.toMatchObject({
      node: { ...workflow, label: "Approval", detail: "v4" },
      neighbors: [{ ...action, label: "Approve", detail: "PUBLISHED" }, { ...hidden, label: hidden.primaryKey }],
      total: 2,
    });

    const incoming = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node: action, direction: "incoming", targetClass: WORKFLOW,
    }))!;
    expect(incoming.facts.map(({ call }) => call?.name)).toEqual([relationKind, "action.uses-function"]);
    const actionCenter = { status: "ready", payload: { links: [], fromNames: actions, toNames: [] } } as const;
    await expect(incoming.present(owner, [
      { status: "ready", payload: { workflows, links: [link] } }, actionCenter,
    ])).resolves.toMatchObject({
      node: { ...action, label: "Approve" },
      edges: [{ relationKind, from: workflow, to: action, direction: "incoming" }],
      neighbors: [{ ...workflow, label: "Approval", detail: "v4" }],
    });
    await expect(incoming.present(owner, [{ status: "error", error: "Workflow read failed" }, actionCenter]))
      .resolves.toMatchObject({ node: { ...action, label: "Approve" }, edges: [], relations: [{ relationKind, status: "failed" }] });
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("searches the built-in graph results for Application and ontology with the original first page and sharing label", async () => {
    const projections = JSON.parse(readFileSync(new URL(
      "../../../../../ontology-manager/resources/builtin-panels/data-browser/projections.json", import.meta.url,
    ), "utf8")) as { id: string; input: { data: { rows?: { read: string; source: { type: { id: string } } } } } }[];
    const { rows } = projections.find(({ id }) => id === "builtin-product-db-capability-search-results")!.input.data;
    const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: rows!.source.type.id, method: rows!.read },
      owner, credentials, { className: APPLICATION, search: "ontology", page: { number: 1, size: 20 } }))!;
    expect(plan.facts).toEqual(["navigation", "ontologyDomainShared"].map(name => ({ call: { type: APPLICATION, name, parameters: {} } })));
    const app = (id: string, name: string) => ({
      id, kind: "native", names: { en: name }, descriptions: {}, icon: "grid", rail: "apps",
      category: "business", sort: 1, entry: { path: `/${id}` }, scheduleAdapter: null, releaseId: null,
    });
    const navigation = { status: "ready" as const, payload: [
      app("ontology", "Ontology"),
      ...Array.from({ length: 20 }, (_, i) => app(`app-${i}`, `Ontology area ${String(i).padStart(2, "0")}`)),
      app("tools", "Tools"),
    ] };
    const page = panelReadResultSchemas.panelRecordQuery.parse(await plan.present(owner, [
      navigation, { status: "ready", payload: ["ontology", "unadmitted-app"] },
    ]));
    expect(page).toMatchObject({ total: 21, hasMore: true });
    expect(page.rows).toHaveLength(20);
    expect(page.rows[0]).toMatchObject({ className: APPLICATION, primaryKey: "ontology", label: "Ontology",
      fields: { detail: "native · 全本域可用" } });
    expect(page.rows[19].primaryKey).toBe("app-18");
    await expect(plan.present(owner, [navigation, { status: "forbidden", error: "Domain policy read refused" }]))
      .rejects.toMatchObject({ status: 403, message: "Domain policy read refused" });
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("retains multi-type instance search and reports only missing directory types as failures", async () => {
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" } as const;
    const plan = (await prepareRegisteredOntologyRead(selection, owner, credentials, { search: "Apps", page: { number: 1, size: 20 } }))!;
    expect(plan.facts.flatMap(fact => fact.call ? [fact.call] : [])).toEqual(expect.arrayContaining([
      { type: APPLICATION, name: "navigation", parameters: {} },
      { type: ONTOLOGY_TYPE, name: "modelInstanceDirectory", parameters: { type: OBJECT_TYPE } },
    ]));
    expect(plan.facts.some(fact => fact.call?.name === "domainSharedUse" || fact.call?.name === "ontologyDomainShared")).toBe(false);
    for (const type of [ACTION, METRIC_VIEW]) {
      expect(plan.facts.filter(({ call }) => call?.type === type && call.name === "list")).toHaveLength(1);
    }
    const range = { fixed: false, all: false, authorId: null, objectIds: [] };
    const results = plan.facts.map(({ call, visibleKinds }): JavaPanelReadResult => {
      if (visibleKinds) {
        const [{ kind, verbs: [verb] }] = visibleKinds;
        return { status: "ready", visibility: { [kind]: { [verb]: range } } };
      }
      if (call?.name === "modelInstanceDirectory")
        return { status: "forbidden", error: "Model directory refused" };
      if (call?.type === APPLICATION)
        return { status: "ready", payload: [
          { id: "app", names: { en: "Apps" }, descriptions: {}, kind: "native", icon: "grid", rail: "apps",
            category: "business", sort: 1, entry: { path: "/app" }, releaseId: null, scheduleAdapter: null },
        ] };
      if (call?.type === USER) return { status: "ready", payload: [{ id: "editor", displayName: "Editor" }] };
      if (call?.type === ACTION) return { status: "ready", payload: [{ id: "publish", name: "Apps publish", createdBy: "editor" }] };
      if (call?.type === TRIGGER) return { status: "ready", payload: { tasks: [], timeZone: "UTC" } };
      if (call?.type === BUSINESS_KNOWLEDGE) return { status: "ready", payload: { entries: {} } };
      return { status: "ready", payload: [] };
    });
    const page = panelReadResultSchemas.panelRecordQuery.parse(await plan.present(owner, results));
    expect(page.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ className: APPLICATION, primaryKey: "app" }),
      expect.objectContaining({ className: DEFINITION, primaryKey: "def-apps" }),
      expect.objectContaining({ className: ACTION, primaryKey: "publish" }),
      expect.objectContaining({ className: USER, primaryKey: "editor" }),
    ]));
    expect(page.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining(" · ")]));
    expect(listPublishedDefinitions).toHaveBeenCalledWith(owner);
    expect(readPanelComponentCatalogue).toHaveBeenCalledTimes(1);
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
    const blank = (await prepareRegisteredOntologyRead(selection, owner, credentials, {}))!;
    expect(blank.facts).toEqual([]);
    expect(await blank.present(owner, [])).toMatchObject({ rows: [], total: 0, hasMore: false });
  });

  it.each([
    [OBJECT_TYPE, "orders", { classDef: [{ className: "Order", classDesc: "Orders" }] }, "Order", "Orders", "Order"],
    ["platform:Attribute", "amount", { classDef: [{ className: "Order", attrs: [{ name: "amount", showName: "Amount" }] }] },
      '["Order","amount"]', "Amount", "Order"],
    ["platform:Relationship", "contains", { relationDef: { contains: {
      relationShowName: "Contains", fromclass: "Order", toclass: "Item",
    } } }, "contains", "Contains", "Order → Item"],
  ])("searches the original model display fields from the selected %s directory", async (
    className, search, payload, primaryKey, label, detail,
  ) => {
    const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" },
      owner, credentials, { className, search }))!;
    expect(plan.facts).toEqual([{ call: { type: ONTOLOGY_TYPE, name: "modelInstanceDirectory", parameters: { type: className } } }]);
    const page = panelReadResultSchemas.panelRecordQuery.parse(await plan.present(owner, [{ status: "ready", payload }]));
    expect(page).toMatchObject({ total: 1, rows: [{ className, primaryKey, label, fields: { detail } }] });
    await expect(plan.present(owner, [{ status: "forbidden", error: "Model directory refused" }]))
      .rejects.toMatchObject({ status: 403, message: "Model directory refused" });
    expect(backendPost).not.toHaveBeenCalled();
  });
  it.each([
    [METRIC_VIEW, "list", "published", [{ id: "m1", name: "Sales total", status: "PUBLISHED" }],
      "m1", "Sales total", "PUBLISHED"],
    [FUNCTION, "list", "read", [{ id: "f1", name: "Find order", operation: "READ" }],
      "f1", "Find order", "READ"],
    [ACTION, "list", "draft", [{ id: "a1", name: "Approve order", status: "DRAFT" }],
      "a1", "Approve order", "DRAFT"],
    [WORKFLOW, "instanceDirectory", "v7", [{ id: "wf-7", name: "Approval", status: "ACTIVE", version: 7 }],
      "wf-7", "Approval", "v7"],
    [TRIGGER, "list", "workflow", { tasks: [triggerFixture], timeZone: "UTC" },
      triggerFixture.id, triggerFixture.title, triggerFixture.targetKind],
    [BUSINESS_KNOWLEDGE, "query", "approval guide", {
      entries: { k1: { knowledgeID: "k1", knowledgeTitle: "Approval guide", status: 1 } },
    }, "k1", "Approval guide", undefined],
  ] as const)("searches %s with its registered owner directory", async (
    className, name, search, payload, primaryKey, label, detail,
  ) => {
    const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" },
      owner, credentials, { className, search, page: { number: 1, size: 20 } }))!;
    expect(plan.facts).toEqual([{ call: { type: className, name, parameters: {} } }]);
    const page = panelReadResultSchemas.panelRecordQuery.parse(await plan.present(owner, [{ status: "ready", payload }]));
    expect(page).toMatchObject({ total: 1, hasMore: false, rows: [{ className, primaryKey, label }] });
    expect(page.rows[0].fields.detail).toBe(detail);
    await expect(plan.present(owner, [{ status: "forbidden", error: "Directory refused" }]))
      .rejects.toMatchObject({ status: 403 });
    await expect(plan.present(owner, [{ status: "empty" }])).rejects.toMatchObject({ status: 502 });
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("searches members by their original action, workflow and metric provenance", async () => {
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" } as const;
    const plan = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      className: USER, search: "order approval", page: { number: 1, size: 20 },
    }))!;
    expect(plan.facts).toEqual([
      { call: { type: USER, name: "instanceDirectory", parameters: {} } },
      { call: { type: ACTION, name: "list", parameters: {} } },
      { call: { type: WORKFLOW, name: "instanceProvenance", parameters: {} } },
      { call: { type: METRIC_VIEW, name: "list", parameters: {} } },
    ]);
    const page = panelReadResultSchemas.panelRecordQuery.parse(await plan.present(owner, [
      { status: "ready", payload: [{ id: "user-1", loginCode: "alice", displayName: "Alice" }] },
      { status: "ready", payload: [{ id: "a", name: "Approve Order", createdBy: "user-1" }] },
      { status: "ready", payload: [{ name: "Order Approval", reviewedBy: "user-1" }] },
      { status: "ready", payload: [{ id: "m", name: "Order Total", createdBy: "user-1", reviewedBy: "user-1" }] },
    ]));
    expect(page).toMatchObject({ total: 1, hasMore: false, rows: [{
      className: USER, primaryKey: "user-1", label: "Alice",
      fields: { detail: "alice · Created: Approve Order、Order Total · Reviewed: Order Approval、Order Total" },
    }] });
    expect(backendPost).not.toHaveBeenCalled();
    expect(backendGet).not.toHaveBeenCalled();
  });

  it("keeps member refusal distinct from independent provenance failures", async () => {
    const viewer = { ...owner, userId: "system" };
    const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" },
      viewer, credentials, { className: USER }))!;
    const actionRefused = { status: "forbidden", error: "Action directory refused" } as const;
    const workflowFailed = { status: "error", error: "Workflow provenance failed" } as const;
    const metric = { status: "ready", payload: [{ id: "m", name: "Order Total", createdBy: "admin" }] } as const;
    await expect(plan.present(viewer, [
      { status: "forbidden", error: "Members refused" }, actionRefused, workflowFailed, metric,
    ])).rejects.toMatchObject({ status: 403, message: "Members refused" });
    await expect(plan.present(viewer, [
      { status: "ready", payload: [{ id: "admin", loginCode: "admin" }] }, actionRefused, workflowFailed, metric,
    ])).resolves.toMatchObject({ total: 1, rows: [{ primaryKey: "admin", fields: { detail: "admin · Created: Order Total" } }] });
    await expect(plan.present(viewer, [
      { status: "ready", payload: [] }, actionRefused, workflowFailed, metric,
    ])).resolves.toMatchObject({ total: 0, rows: [] });
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("searches and pages role names from the directory and recorded grants together", async () => {
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" } as const;
    const results: JavaPanelReadResult[] = [
      { status: "ready", payload: [
        { roleId: "known", roleCode: "Alpha review" },
        { roleId: "other", roleCode: "Unrelated" },
      ] },
      { status: "ready", payload: [
        { roleId: "known", roleCode: "Shadow review" },
        { roleId: "review-outside", roleCode: null },
      ] },
    ];
    const prepare = (number: number) => prepareRegisteredOntologyRead(selection, owner, credentials, {
      className: ROLE, search: "review", page: { number, size: 1 },
    });
    const first = (await prepare(1))!;
    expect(first.facts).toEqual([
      { call: { type: ROLE, name: "instanceDirectory", parameters: {} } },
      { call: { type: ROLE, name: "instanceGrantRoles", parameters: {} } },
    ]);
    await expect(first.present(owner, results)).resolves.toMatchObject({
      total: 2, hasMore: true, rows: [{ className: ROLE, primaryKey: "known", label: "Alpha review" }],
    });
    await expect((await prepare(2))!.present(owner, results)).resolves.toMatchObject({
      total: 2, hasMore: false, rows: [{ className: ROLE, primaryKey: "review-outside", label: "review-outside" }],
    });
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("keeps role source refusals independent and reports a missing fact", async () => {
    const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" },
      owner, credentials, { className: ROLE }))!;
    const refused = { status: "forbidden", error: "Role source refused" } as const;
    const readable = { status: "ready", payload: [{ roleId: "visible", roleCode: "Visible" }] } as const;
    const empty = { status: "ready", payload: [] } as const;
    await expect(plan.present(owner, [refused, readable])).resolves.toMatchObject({ total: 1 });
    await expect(plan.present(owner, [readable, refused])).resolves.toMatchObject({ total: 1 });
    await expect(plan.present(owner, [refused, empty])).rejects.toMatchObject({ status: 403 });
    await expect(plan.present(owner, [readable, { status: "empty" }])).rejects.toMatchObject({ status: 502 });
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("finds visible policies by creatable type using only the selected CREATE facts", async () => {
    const functionLabel = tForLocale(credentials.locale, platformObjectTypes[FUNCTION].labelKey!);
    const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" },
      owner, credentials, { className: PERMISSION_POLICY, search: functionLabel, page: { number: 1, size: 20 } }))!;
    expect(plan.facts).toEqual([
      { call: { type: PERMISSION_POLICY, name: "instanceDirectory", parameters: {} } },
      { call: { type: PERMISSION_POLICY, name: "instanceCreateKinds", parameters: {
        targetKinds: ["PANEL", "PROJECTION", "COMPONENT", "AGENT", "METRIC", "READ_FUNCTION", "WRITE_FUNCTION", "WORKFLOW", "TRIGGER"],
      } } },
    ]);
    const page = panelReadResultSchemas.panelRecordQuery.parse(await plan.present(owner, [
      { status: "ready", payload: [{ id: "ops", name: "Operations" }, { id: "sales", name: "Sales" }] },
      { status: "ready", payload: [
        { policyId: "ops", targetKind: "READ_FUNCTION" },
        { policyId: "ops", targetKind: "WRITE_FUNCTION" },
        { policyId: "hidden", targetKind: "READ_FUNCTION" },
        { policyId: "sales", targetKind: "PANEL" },
      ] },
    ]));
    expect(page).toMatchObject({ total: 1, hasMore: false, rows: [{
      className: PERMISSION_POLICY, primaryKey: "ops", label: "Operations",
    }] });
    expect(String(page.rows[0].fields.detail).split(functionLabel)).toHaveLength(2);
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("keeps policy directory denial separate from an unavailable CREATE description", async () => {
    const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" },
      owner, credentials, { className: PERMISSION_POLICY, search: "Operations" }))!;
    const directory = { status: "ready", payload: [{ id: "ops", name: "Operations" }] } as const;
    const grants = { status: "ready", payload: [{ policyId: "ops", targetKind: "PANEL" }] } as const;
    await expect(plan.present(owner, [{ status: "forbidden", error: "Policy directory refused" }, grants]))
      .rejects.toMatchObject({ status: 403 });
    const page = panelReadResultSchemas.panelRecordQuery.parse(await plan.present(owner,
      [directory, { status: "error", error: "CREATE read unavailable" }]));
    expect(page).toMatchObject({ total: 1, rows: [{ primaryKey: "ops", label: "Operations" }] });
    expect(page.rows[0].fields).not.toHaveProperty("detail");
    expect(backendPost).not.toHaveBeenCalled();
  });

  it.each([
    { className: ORG_UNIT, search: "ENG", payload: [
      { id: "unit-b", name: "Beta", code: "ENG-B" }, { id: "unit-a", name: " Alpha ", code: " ENG-A " },
    ], total: 2, id: "unit-a", label: "Alpha", detail: "ENG-A" },
    { className: ORG_POSITION, search: "finance", payload: [
      { id: "position-b", name: "Analyst", orgName: "Research" }, { id: "position-a", name: "Lead", orgName: "Finance" },
    ], total: 1, id: "position-a", label: "Lead", detail: "Finance" },
    { className: ORG_GRANT, search: "removed", payload: [
      { id: "organization:removed", grantType: "organization", sourceId: "removed", sourceName: null },
      { id: "position:lead", grantType: "position", sourceId: "lead", sourceName: "Lead" },
    ], total: 1, id: "organization:removed", label: "组织 · removed" },
  ])("searches $className from its own narrowly scoped organization batch fact", async ({
    className, search, payload, total, id, label, detail,
  }) => {
    const plan = (await prepareRegisteredOntologyRead({ kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" },
      owner, credentials, { className, search, page: { number: 1, size: 1 } }))!;
    expect(plan.facts).toEqual([{ call: { type: className, name: "instanceDirectory", parameters: {} } }]);
    await expect(plan.present(owner, [{ status: "ready", payload }])).resolves.toMatchObject({
      total, hasMore: total > 1,
      rows: [{ className, primaryKey: id, label, ...(detail && { fields: { detail } }) }],
    });
    await expect(plan.present(owner, [{ status: "ready", payload: [] }])).resolves.toMatchObject({ rows: [], total: 0 });
    await expect(plan.present(owner, [{ status: "forbidden", error: "Organization read denied" }]))
      .rejects.toMatchObject({ status: 403, message: "Organization read denied" });
    expect(backendPost).not.toHaveBeenCalled();
    expect(backendGet).not.toHaveBeenCalled();
  });

  it.each([
    [PRODUCT_PANEL, "PANEL", "USE", "shipping memo", "Shipping panel", "Shipping memo · 全本域可用"],
    [PRODUCT_PROJECTION, "PROJECTION", "USE", "shipping memo", "Shipping projection", "@ontomato/sdk:DataTable"],
    [AGENT_DEFINITION, "AGENT", "VIEW", "disabled", "Shipping agent", "disabled · 全本域可用"],
  ])("searches %s with only its original visibility and scoped sharing", async (
    className, kind, verb, search, label, detail,
  ) => {
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "instanceSearch" } as const;
    const plan = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      className, search, page: { number: 1, size: 20 },
    }))!;
    const scope = { visibleKinds: [{ kind, verbs: [verb] }] };
    const marks = { call: { type: ONTOLOGY_TYPE, name: "domainSharedUse", parameters: { kind } } };
    expect(plan.facts).toEqual(kind === "PROJECTION" ? [scope] : [scope, marks]);
    const range = { fixed: false, all: false, authorId: null, objectIds: ["readable"] };
    pgQueryMock.mockImplementation(async (sql, params) => {
      expect(sql).toContain(kind === "PANEL" ? "product_panels" : "product_projections");
      expect(sql).toContain("p.id = ANY($2::text[])");
      expect(params).toEqual([owner.domainId, ["readable"]]);
      return { rows: [{ id: "readable", definition: {
        name: label, description: "Shipping memo", visibility: "domain",
        ...(kind === "PANEL"
          ? { content: { html: "<div/>" }, manifest: { state: {}, members: {} } }
          : { componentId: "@ontomato/sdk:DataTable", data: {}, config: {}, inputs: {}, outputs: {} }),
      } }] };
    });
    vi.mocked(listAgentDefinitionNodes).mockResolvedValueOnce([{ id: "readable", name: label, enabled: false }]);
    const facts: JavaPanelReadResult[] = [{ status: "ready", visibility: { [kind]: { [verb]: range } } }];
    if (kind !== "PROJECTION") facts.push({ status: "ready", payload: ["readable", "hidden"] });
    const page = panelReadResultSchemas.panelRecordQuery.parse(await plan.present(owner, facts));
    expect(page).toMatchObject({ total: 1, hasMore: false, rows: [{ className, primaryKey: "readable", label, fields: { detail } }] });
    if (kind === "AGENT") expect(listAgentDefinitionNodes).toHaveBeenCalledWith(owner, credentials, range, undefined);
    else expect(pgQueryMock).toHaveBeenCalledTimes(1);
    await expect(plan.present(owner, [{ status: "forbidden", error: "Range refused" }]))
      .rejects.toMatchObject({ status: 403, message: "Range refused" });
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
    expect(decideProductObjects).not.toHaveBeenCalled();
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
          skill: PAGE_OPERATOR_SKILL,
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
          relationKind: "application.uses-panel",
          direction: "incoming",
          from: { className: "platform:Application", primaryKey: "app-ops" },
        }),
      ]),
    );
    // Ungranted projection & panel must be filtered out
    expect(panelNeighbors.edges.some((e) => e.to.primaryKey === "proj-not-granted")).toBe(false);
    expect(panelNeighbors.edges.some((e) => e.to.primaryKey === "panel-not-granted")).toBe(false);

    // 8. Child panel sees incoming panel.contains-panel; application sees outgoing application.uses-panel
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

    vi.mocked(backendPost).mockClear();
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const relationKind = "permission-policy.governs-object-type";
    const policy = { className: PERMISSION_POLICY, primaryKey: "pol-1" };
    const objectType = { className: OBJECT_TYPE, primaryKey: "Order" };
    const endpoints = { from: PERMISSION_POLICY, to: OBJECT_TYPE };
    const outgoingScope = { ...policy, ...endpoints, direction: "outgoing" };
    const outgoing = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node: policy, relationKinds: [relationKind], limit: 1,
    }))!;
    expect(outgoing.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: relationKind, parameters: outgoingScope },
      { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: policy },
      { type: ONTOLOGY_TYPE, name: "policyDataObjectTypeNames", parameters: outgoingScope },
    ]);
    const policyName = { id: "pol-1", name: "Order Read Policy" };
    const policyCenter = { status: "ready", payload: { names: [policyName], emptyDirectory: false } } as const;
    const link = { fromId: "pol-1", toId: "Order" };
    const outgoingEdge = { status: "ready", payload: {
      links: [link, link, { ...link, toId: "Refund" }], fromNames: [], toNames: [],
    } } as const;
    const model = { classDef: [{ className: "Order", showName: "Orders" }], relationDef: [] };
    await expect(outgoing.present(owner, [outgoingEdge, policyCenter, { status: "ready", payload: model }]))
      .resolves.toMatchObject({
        node: { label: policyName.name }, total: 2, nextOffset: 1,
        edges: [{ relationKind, direction: "outgoing", from: policy, to: objectType }],
        neighbors: [{ ...objectType, label: "Orders" }],
      });
    for (const nameResult of [
      { status: "forbidden", error: "Model read denied" },
      { status: "error", error: "Model read timed out" },
    ] as const) {
      await expect(outgoing.present(owner, [outgoingEdge, policyCenter, nameResult])).resolves.toMatchObject({
        neighbors: [{ ...objectType, label: "Order" }], relations: [{ relationKind, status: "ok", edgeCount: 1 }],
      });
    }

    const incoming = (await prepareRegisteredOntologyRead(selection, owner, credentials, {
      node: objectType, direction: "incoming", targetClass: PERMISSION_POLICY, relationKinds: [relationKind],
    }))!;
    expect(incoming.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: relationKind, parameters: { ...objectType, ...endpoints, direction: "incoming" } },
      { type: ONTOLOGY_TYPE, name: "modelNeighbors", parameters: { ...objectType, relations: [] } },
    ]);
    const modelCenter = { status: "ready", payload: { center: model, relations: {} } } as const;
    await expect(incoming.present(owner, [
      { status: "ready", payload: { links: [link], fromNames: [policyName], toNames: [] } }, modelCenter,
    ])).resolves.toMatchObject({
      node: { label: "Orders" }, edges: [{ relationKind, direction: "incoming", from: policy, to: objectType }],
      neighbors: [{ ...policy, label: policyName.name }],
    });
    await expect(incoming.present(owner, [{ status: "forbidden", error: "Policy read denied" }, modelCenter]))
      .resolves.toMatchObject({ edges: [], relations: [{ relationKind, status: "refused", edgeCount: 0 }] });
    expect(backendPost).not.toHaveBeenCalled();
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

    vi.mocked(backendPost).mockClear();
    vi.mocked(backendGet).mockClear();
    const selection = { kind: "platform", typeId: ONTOLOGY_TYPE, method: "neighbors" } as const;
    const kind = "permission-policy.can-enter-application";
    const policy = { className: PERMISSION_POLICY, primaryKey: "pol-1" };
    const app = { className: APPLICATION, primaryKey: "app-1" };
    const appRow = { id: "app-1", names: { en: "Order Workspace" }, kind: "product", panelIds: [] };
    const policyName = { id: "pol-1", name: "Order Operations Policy" };
    const grant = { policyId: "pol-1", targetKind: "ENTRY", targetKey: "app-1/use-main/legacy", verb: "ENTER",
      scope: { kind: "self_organization", className: "Order", field: "orgId" } };
    const authorization = {
      verb: "ENTER", verbLabel: "Enter", entry: grant.targetKey, entryLabel: "use-main",
      scope: "self_organization", scopeLabel: "Own organization", scopeField: "Order.orgId",
    };
    const ends = { from: PERMISSION_POLICY, to: APPLICATION };
    const outgoing = (await prepareRegisteredOntologyRead(selection, owner, credentials,
      { node: policy, direction: "outgoing", relationKinds: [kind] }))!;
    const outgoingScope = { ...policy, ...ends, direction: "outgoing" };
    expect(outgoing.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: kind, parameters: outgoingScope },
      { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: policy },
      { type: ONTOLOGY_TYPE, name: "entryGrantApplicationNames", parameters: outgoingScope },
    ]);
    const policyReply = { status: "ready", payload: { names: [policyName], emptyDirectory: false } } as const;
    const grantsReply = { status: "ready", payload: [grant, { ...grant, targetKey: "app-1/use-other" }] } as const;
    await expect(outgoing.present(owner, [
      grantsReply, policyReply, { status: "ready", payload: { applications: [appRow], shared: ["app-1"] } },
    ])).resolves.toMatchObject({
      node: { label: policyName.name }, total: 1, edges: [{ relationKind: kind, direction: "outgoing", authorization }],
      neighbors: [{ ...app, label: "Order Workspace", detail: expect.stringContaining("product") }],
    });
    await expect(outgoing.present(owner, [grantsReply, policyReply, { status: "error", error: "App labels timed out" }]))
      .resolves.toMatchObject({ neighbors: [{ ...app, label: "app-1" }], relations: [{ status: "ok", edgeCount: 1 }] });

    const incoming = (await prepareRegisteredOntologyRead(selection, owner, credentials,
      { node: app, direction: "incoming", relationKinds: [kind] }))!;
    const incomingScope = { ...app, ...ends, direction: "incoming" };
    expect(incoming.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: kind, parameters: incomingScope },
      { type: ONTOLOGY_TYPE, name: "application.uses-panel", parameters: {
        ...app, from: APPLICATION, to: PRODUCT_PANEL, direction: "outgoing", includeLinks: false,
      } },
      { type: ONTOLOGY_TYPE, name: "entryGrantPolicyNames", parameters: incomingScope },
      { type: APPLICATION, name: "ontologyDomainShared", parameters: { ids: ["app-1"] } },
    ]);
    const appReply = { status: "ready", payload: [appRow] } as const;
    const sharing = { status: "ready", payload: [] } as const;
    await expect(incoming.present(owner, [grantsReply, appReply, { status: "ready", payload: [policyName] }, sharing]))
      .resolves.toMatchObject({
        edges: [{ relationKind: kind, direction: "incoming", authorization }],
        neighbors: [{ ...policy, label: policyName.name }],
      });
    await expect(incoming.present(owner, [grantsReply, appReply, { status: "forbidden", error: "Policies unreadable" }, sharing]))
      .resolves.toMatchObject({ neighbors: [{ ...policy, label: "pol-1" }], relations: [{ status: "ok", edgeCount: 1 }] });
    await expect(incoming.present(owner, [
      { status: "error", error: "Entry grants unavailable" }, appReply, { status: "ready", payload: [policyName] }, sharing,
    ])).resolves.toMatchObject({ edges: [], relations: [{ status: "failed", reason: "Entry grants unavailable" }] });

    const actionKind = "permission-policy.can-execute-action";
    const action = { className: ACTION, primaryKey: "act-1" };
    const actionName = { id: "act-1", name: "Approve order", detail: "published" };
    const actionScope = { from: PERMISSION_POLICY, to: ACTION };
    const edit = { policyId: "pol-1", targetKind: "ACTION", targetKey: "act-1", verb: "EDIT", scope: null };
    const execute = { ...edit, targetKey: "act-2", verb: "EXECUTE", scope: grant.scope };
    const actionGrantReply = { status: "ready", payload: [
      edit, { ...edit, verb: "VIEW" }, execute, { ...edit, verb: "CREATE", targetKey: "" },
    ] } as const;
    const actionNames = { status: "ready", payload: [actionName] } as const;
    const fromPolicy = (await prepareRegisteredOntologyRead(selection, owner, credentials,
      { node: policy, direction: "outgoing", relationKinds: [actionKind] }))!;
    expect(fromPolicy.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: actionKind, parameters: { ...policy, ...actionScope, direction: "outgoing" } },
      { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: policy },
      { type: ONTOLOGY_TYPE, name: "policyGrantActionNames", parameters: { ...policy, ...actionScope, direction: "outgoing" } },
    ]);
    await expect(fromPolicy.present(owner, [actionGrantReply, policyReply, actionNames])).resolves.toMatchObject({
      total: 2, edges: [
        { relationKind: actionKind, direction: "outgoing", authorization: { verb: "EDIT", verbLabel: "Edit" } },
        { relationKind: actionKind, direction: "outgoing", authorization: {
          verb: "EXECUTE", scope: "self_organization", scopeLabel: "Own organization", scopeField: "Order.orgId",
        } },
      ], neighbors: [{ ...action, label: actionName.name }, { primaryKey: "act-2", label: "act-2" }],
    });
    await expect(fromPolicy.present(owner, [actionGrantReply, policyReply, { status: "error", error: "Action names timed out" }]))
      .resolves.toMatchObject({ neighbors: [{ label: "act-1" }, { label: "act-2" }], relations: [{ status: "ok", edgeCount: 2 }] });

    const fromAction = (await prepareRegisteredOntologyRead(selection, owner, credentials,
      { node: action, direction: "incoming", relationKinds: [actionKind] }))!;
    expect(fromAction.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: actionKind, parameters: { ...action, ...actionScope, direction: "incoming" } },
      { type: ONTOLOGY_TYPE, name: "action.uses-function", parameters: {
        ...action, from: ACTION, to: FUNCTION, direction: "outgoing", includeLinks: false,
      } },
      { type: ONTOLOGY_TYPE, name: "actionGrantPolicyNames", parameters: { ...action, ...actionScope, direction: "incoming" } },
    ]);
    const actionCenter = { status: "ready", payload: { links: [], fromNames: [actionName], toNames: [] } } as const;
    await expect(fromAction.present(owner, [actionGrantReply, actionCenter, { status: "ready", payload: [policyName] }]))
      .resolves.toMatchObject({ node: { label: actionName.name }, total: 1,
        edges: [{ relationKind: actionKind, direction: "incoming", authorization: { verb: "EDIT" } }],
        neighbors: [{ ...policy, label: policyName.name }] });
    await expect(fromAction.present(owner, [actionGrantReply, actionCenter, { status: "forbidden", error: "Policy names denied" }]))
      .resolves.toMatchObject({ neighbors: [{ ...policy, label: "pol-1" }], relations: [{ status: "ok", edgeCount: 1 }] });
    await expect(fromAction.present(owner, [
      { status: "error", error: "Action grants unavailable" }, actionCenter, { status: "ready", payload: [policyName] },
    ])).resolves.toMatchObject({ edges: [], relations: [{ status: "failed", reason: "Action grants unavailable" }] });

    const objectRelation = "permission-policy.can-use-object";
    const objectPlan = async (node: typeof policy, options = {}) =>
      (await prepareRegisteredOntologyRead(selection, owner, credentials, { node, relationKinds: [objectRelation], ...options }))!;
    const objectPolicy = { policyId: "pol-1", targetKind: "WORKFLOW" };
    const policyLabels = { status: "ready", payload: { names: [policyName], createKinds: [objectPolicy] } } as const;
    const objects = await objectPlan(policy);
    expect(objects.facts[0].call?.parameters).toEqual({ ...policy, direction: "outgoing", targetKinds: [
      "PANEL", "PROJECTION", "COMPONENT", "AGENT", "METRIC", "READ_FUNCTION", "WRITE_FUNCTION", "WORKFLOW", "TRIGGER",
    ] });
    expect(objects.facts.flatMap(({ call }) => call?.name.startsWith("policyObject") ? [[call.name, call.parameters.targetKinds]] : []))
      .toEqual([
        ["policyObjectFunctionNames", ["READ_FUNCTION", "WRITE_FUNCTION"]],
        ["policyObjectMetricNames", ["METRIC"]], ["policyObjectWorkflowNames", ["WORKFLOW"]],
        ["policyObjectTriggerNames", ["TRIGGER"]], ["policyObjectSharedUses", ["PANEL", "AGENT"]],
      ]);

    const fn = { className: FUNCTION, primaryKey: "fn-1" };
    const fnScope = { targetKinds: ["READ_FUNCTION", "WRITE_FUNCTION"] };
    const fnPlan = await objectPlan(policy, { targetClass: FUNCTION, layers: ["capability"], limit: 1 });
    expect(fnPlan.facts.map(({ call }) => call)).toEqual([
      { type: ONTOLOGY_TYPE, name: objectRelation, parameters: { ...policy, ...fnScope, direction: "outgoing" } },
      { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: policy },
      { type: ONTOLOGY_TYPE, name: "objectGrantPolicies", parameters: { ...policy, ...fnScope, direction: "outgoing" } },
      { type: ONTOLOGY_TYPE, name: "policyObjectFunctionNames", parameters: { ...policy, ...fnScope, direction: "outgoing" } },
    ]);
    const fnName = { id: "fn-1", name: "Load orders", detail: "read" };
    const fnLabel = { status: "ready", payload: [fnName] } as const;
    const readGrant = { policyId: "pol-1", targetKind: "READ_FUNCTION", targetKey: "fn-1", verb: "EDIT", scope: null };
    const writeGrant = { ...readGrant, targetKind: "WRITE_FUNCTION", verb: "USE" };
    const functionEdges = { status: "ready", payload: [
      readGrant, writeGrant, { ...writeGrant, targetKey: "fn-2" }, { ...writeGrant, targetKey: "", verb: "CREATE" },
    ] } as const;
    await expect(fnPlan.present(owner, [functionEdges, policyReply, policyLabels, fnLabel])).resolves.toMatchObject({
      node: { detail: "Can create: Workflow" }, total: 2, nextOffset: 1,
      edges: [{ to: fn, authorization: { verb: "EDIT" } }], neighbors: [{ ...fn, label: fnName.name }],
    });
    await expect(fnPlan.present(owner, [functionEdges, policyReply, policyLabels, { status: "error", error: "Names unavailable" }]))
      .resolves.toMatchObject({ neighbors: [{ label: "fn-1" }], relations: [{ status: "ok", edgeCount: 1 }] });

    const objectReverse = await objectPlan(fn, { direction: "incoming" });
    expect(objectReverse.facts[0].call?.parameters).toEqual({ ...fn, ...fnScope, direction: "incoming" });
    expect(objectReverse.facts.map(({ call }) => call?.name)).toEqual([objectRelation, "functionCenter", "objectGrantPolicies"]);
    await expect(objectReverse.present(owner, [functionEdges, fnLabel, policyLabels])).resolves.toMatchObject({
      node: { label: fnName.name }, total: 1, edges: [{ direction: "incoming", authorization: { verb: "EDIT" } }],
      neighbors: [{ ...policy, label: policyName.name, detail: "Can create: Workflow" }],
    });
    await expect(objectReverse.present(owner, [functionEdges, fnLabel, { status: "forbidden", error: "Policy names denied" }]))
      .resolves.toMatchObject({ neighbors: [{ label: "pol-1" }], relations: [{ status: "ok", edgeCount: 1 }] });

    const nodeRange = { fixed: false, all: false, authorId: null, objectIds: ["one", "two", "unrelated"] };
    const panelPlan = await objectPlan(policy, { targetClass: PRODUCT_PANEL, limit: 1 });
    const panelGrants = { status: "ready", payload: ["one", "two"].map(targetKey => ({
      ...readGrant, targetKind: "PANEL", targetKey, verb: "USE",
    })) } as const;
    pgQueryMock.mockClear().mockResolvedValue({ rows: [{ id: "one", definition: {
      name: "Approved panel", description: "Orders", visibility: "domain",
      content: { html: "<div/>" }, manifest: { state: {}, members: {} },
    } }] });
    await expect(panelPlan.present(owner, [
      panelGrants, policyReply, policyLabels, { status: "ready", payload: { PANEL: ["one"] } },
      { status: "ready", visibility: { PANEL: { USE: nodeRange } } },
    ])).resolves.toMatchObject({ total: 2, neighbors: [{ label: "Approved panel", detail: expect.stringContaining("Orders") }] });
    expect(pgQueryMock.mock.calls).toMatchObject([[expect.stringContaining("p.id = ANY"), [owner.domainId, nodeRange.objectIds, ["one"]]]]);
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
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
