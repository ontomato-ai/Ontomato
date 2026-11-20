import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformObjectTypes, platformRelationKinds } from "@ontomato/contracts/platform-object-types";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { AuthFailedError, BackendResponseError, backendPost } from "../../../utils/backend-client";
import { HttpError } from "../../../utils/errors";
import { listAgentDefinitions } from "../../assistant/definitions";
import { assistantSkillCatalog } from "../../assistant/skills";
import { listPublishedDefinitions } from "../../business-definitions/definitions";
import {
  readPlatformOntologyCounts,
  readPlatformOntologyNeighbors,
  readPlatformOntologyObjects,
  readPlatformOntologySchema,
  readPlatformOntologyStart,
} from "../query";

vi.mock("../../../utils/backend-client", async (original) => ({
  ...(await original<typeof import("../../../utils/backend-client")>()),
  backendPost: vi.fn(),
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
const credentials = { token: "tok-1", locale: "zh-CN" };

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
  it("exposes all four layers, declared layered object types, and 29 relation kinds directly from contracts", () => {
    const schema = readPlatformOntologySchema();
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
  });

  it("coalesces shared owners in counts and separates ok, refused, failed, and unavailable statuses", async () => {
    assertPermissionMock.mockRejectedValueOnce(new HttpError(403, "Missing analysis-agent permission", "PERMISSION_DENIED"));
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

    const { counts } = await readPlatformOntologyCounts(owner, credentials);
    const byType = new Map(counts.map((c) => [c.type, c]));

    expect(byType.get("platform:ObjectType")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Attribute")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Relationship")).toMatchObject({ status: "ok", count: 1 });
    expect(byType.get("platform:Skill")).toMatchObject({ status: "refused" });
    expect(byType.get("platform:AgentDefinition")).toMatchObject({ status: "refused" });
    expect(byType.get("platform:Trigger")).toMatchObject({ status: "failed" });
    expect(byType.get("platform:SDKComponent")).toMatchObject({ status: "unavailable" });
    expect(byType.get("platform:ApplicationPanelUse")).toBeUndefined();

    // /admin/getMetas must be called only once across ObjectType + Attribute + Relationship
    const metaCalls = vi.mocked(backendPost).mock.calls.filter(([, url]) => String(url).endsWith("/admin/getMetas"));
    expect(metaCalls).toHaveLength(1);
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
});
