import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { panelRecordSchema, type PanelRecord } from "@ontomato/contracts/panel-projection";
import { GRANT_POLICY_ENTRIES, PERMISSION_POLICY, RESOLVE_PENDING_POLICY_GRANT } from "@ontomato/contracts/platform-object-types";
import { getPostgresPool } from "../../../infrastructure/postgres";
import { backendPost } from "../../../utils/backend-client";
import { registeredPanelOperation, type PanelOperationHost } from "../../product-panels/server-operations";
import { assistantStore, type AgentRow } from "../../assistant/store";
import { createGovernanceReadAdapters } from "../panel-reads";
import {
  grantPolicyEntries, inspectPolicyAccess, listPendingPolicyGrants, previewEntryGrant, resolvePendingPolicyGrants,
} from "../policy-access";

vi.mock("../../../utils/backend-client", async original => ({
  ...(await original<typeof import("../../../utils/backend-client")>()),
  backendPost: vi.fn(),
}));
vi.mock("../../../infrastructure/postgres", async original => ({
  ...(await original<typeof import("../../../infrastructure/postgres")>()),
  getPostgresPool: vi.fn(),
}));
vi.mock("../../assistant/skills", () => ({}));
vi.mock("../../assistant/store", async original => {
  const store = await original<typeof import("../../assistant/store")>();
  return { ...store, assistantStore: { ...store.assistantStore, channelAgents: vi.fn() } };
});

const viewer = { token: "viewer-token", apiKey: "viewer-key", locale: "en", headers: { "X-Domain-Id": "domain-1" } };
const domainId = "domain-1";
const policyId = "policy-1";
const entryId = "Shop:orders";
const detailId = "object-detail:Order";
const scope = { kind: "self_organization", className: "Order", field: "organization" };
const entries = [
  { entryId, appId: "Shop", useId: "orders", label: "Orders", panelIds: ["orders-panel"], agentIds: ["preset-agent", "custom-agent"], entryEntitlement: true },
  { entryId: detailId, appId: "Shop", useId: "detail", label: "Order details", panelIds: [], agentIds: [], entryEntitlement: false },
];
const rootFacts = {
  policyId, entries, targetPolicyRoleIds: ["role-1", "role-2"],
  existingGrants: [
    { policyId, kind: "PANEL", id: "orders-panel", verb: "USE", scope: null },
    { policyId, kind: "ACTION", id: "standalone", verb: "EXECUTE", scope },
    { policyId, kind: "ACTION", id: "step-only", verb: "EXECUTE", scope },
  ],
  publishedActions: [
    { id: "standalone", name: "Submit order", targetClass: "Order", targetKeyField: "orderId" },
    { id: "step-only", name: "Approve order" },
  ],
  workflowStepActions: [
    { actionId: "step-only", workflowId: "approval", workflowName: "Approval", version: 2, stepNo: 1 },
    { actionId: "standalone", workflowId: "approval", workflowName: "Approval", version: 2, stepNo: 2 },
    { actionId: "unrelated", workflowId: "other", workflowName: "Other", version: 1, stepNo: 1 },
  ],
};

const query = vi.fn();
const post = vi.mocked(backendPost);
const json = (data: unknown) => ({
  text: JSON.stringify(data), status: 200, statusText: "OK", headers: new Headers(),
});
function structuredField(record: PanelRecord, field: string) {
  expect(record.fields[field]).toMatchObject({ kind: "json" });
  return (record.fields[field] as { value: unknown }).value;
}

beforeEach(() => {
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "service-token");
  vi.mocked(getPostgresPool).mockReturnValue({ query } as unknown as ReturnType<typeof getPostgresPool>);
  vi.mocked(assistantStore.channelAgents).mockResolvedValue([
    { id: "preset-agent", kind: "regular", name: "Assistant", owner_id: null },
    { id: "custom-agent", kind: "custom", name: "Order helper", owner_id: "agent-owner" },
  ] as AgentRow[]);
  query.mockImplementation(async (sql: string) => {
    if (sql.includes("product_object_details")) return { rows: [{ className: "Order", panelId: "order-detail" }] };
    if (sql.includes("product_panel_entry_dependencies")) return { rows: [
      { panel_id: "orders-panel", dependencies: [
        { objectType: "PANEL", objectKey: "orders-panel", verb: "USE" },
        { objectType: "PANEL", objectKey: "builtin-product-orders", verb: "USE" },
        { objectType: "PROJECTION", objectKey: "order-list", verb: "USE" },
        { objectType: "COMPONENT", objectKey: "@ontomato/sdk:ObjectList", verb: "USE" },
        { objectType: "AGENT", objectKey: "preset:regular", verb: "USE" },
        { objectType: "AGENT", objectKey: "custom-agent", verb: "USE" },
        { objectType: "WORKFLOW", objectKey: "approval", verb: "VIEW" },
        { objectType: "ACTION", objectKey: "standalone", verb: "EXECUTE" },
      ] },
      { panel_id: "order-detail", dependencies: [
        { objectType: "PROJECTION", objectKey: "order-list", verb: "USE" },
        { objectType: "COMPONENT", objectKey: "domain-component:domain-1:order-card", verb: "USE" },
      ] },
    ] };
    if (sql.includes("product_panels")) return { rows: [
      { id: "orders-panel", definition: { name: "Orders panel" }, owner_id: "panel-owner" },
    ] };
    if (sql.includes("product_projections")) return { rows: [
      { id: "order-list", definition: { name: "Order list" }, owner_id: "projection-owner" },
    ] };
    if (sql.includes("domain_components")) return { rows: [
      { id: "domain-component:domain-1:order-card", definition: { name: "Order card" }, owner_id: "component-owner" },
    ] };
    throw new Error("Unexpected query: " + sql);
  });
  post.mockReset().mockImplementation(async (_name, url, body) => {
    if (url.endsWith("/entry-roots")) {
      const { entryIds } = body as { entryIds: string[] };
      return json({ ...rootFacts, entries: rootFacts.entries.filter(entry => entryIds.includes(entry.entryId)) });
    }
    throw new Error("Unexpected policy request: " + url);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  query.mockClear();
});

describe("policy access", () => {
  it("combines registered roots, scoped detail mappings and the saved closure in a grant preview", async () => {
    const record = panelRecordSchema.parse(await previewEntryGrant(viewer, domainId, policyId, [entryId, detailId]));
    expect(record.primaryKey).toBe(policyId);
    expect(structuredField(record, "entries")).toContainEqual(expect.objectContaining({ entryId: detailId, panelIds: ["order-detail"] }));
    const candidates = structuredField(record, "candidates") as Array<{ id: string }>;
    expect(candidates.filter(candidate => candidate.id === "order-list")).toEqual([
      expect.objectContaining({ label: "Order list", kind: "PROJECTION", verb: "USE", grantable: true, defaultSelected: true }),
    ]);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "domain-component:domain-1:order-card", label: "Order card", defaultSelected: true }),
      expect.objectContaining({ id: "custom-agent", label: "Order helper", defaultSelected: true }),
      expect.objectContaining({ id: "orders-panel", alreadyGranted: true, defaultSelected: false }),
      expect.objectContaining({
        id: "standalone", grantable: true, alreadyGranted: true, existingScopes: [scope], requiresScope: true,
        targetClass: "Order", targetKeyField: "orderId", workflowAuthorized: true,
      }),
      expect.objectContaining({
        id: "step-only", workflowAuthorized: true, grantable: false, defaultSelected: false, alreadyGranted: true,
        workflowSteps: [expect.objectContaining({ workflowId: "approval", version: 2, stepNo: 1 })],
      }),
    ]));
    for (const fixed of ["builtin-product-orders", "@ontomato/sdk:ObjectList", "preset-agent", "preset:regular"]) {
      expect(candidates).toContainEqual(expect.objectContaining({
        id: fixed, fixedByDistribution: true, distributionRule: "builtin_asset", grantable: false, defaultSelected: false,
      }));
    }
    expect(candidates.some(candidate => candidate.id === "unrelated")).toBe(false);
    expect(structuredField(record, "targetPolicyRoleIds")).toEqual(["role-1", "role-2"]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("product_object_details"), [domainId]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("product_panel_entry_dependencies"), [domainId, ["orders-panel", "order-detail"]]);
    expect(post).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/\/entry-roots$/), { policyId, entryIds: [entryId, detailId] }, {
      headers: {
        tk: "viewer-token", "X-API-Key": "viewer-key", "X-Domain-Id": domainId, "Accept-Language": "en",
        "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": "service-token",
      },
      retries: 1,
    });
  });

  it("writes only explicit grants and rejects malformed choices before contacting Java", async () => {
    const result = { policyId, grantedEntryCount: 1, grantedObjectCount: 1 };
    post.mockResolvedValue(json(result));
    const input = { entryIds: [entryId], acceptedObjects: [{ kind: "ACTION", id: "standalone", verb: "EXECUTE", scope }] };
    expect(await grantPolicyEntries(viewer, policyId, input)).toEqual(result);
    expect(post).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/\/entries:grant$/), { policyId, ...input }, expect.anything());
    post.mockClear();
    expect(() => grantPolicyEntries(viewer, policyId, { ...input, entryIds: [""] })).toThrow();
    expect(() => grantPolicyEntries(viewer, policyId, { ...input, acceptedObjects: [{ ...input.acceptedObjects[0], scope: { kind: "self_organization" } }] })).toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it("labels the owner's pending items and forwards explicit confirm and ignore decisions", async () => {
    const item = { id: 1, source: "panel", changeKey: "change-1", actorId: "creator", entryId, kind: "PROJECTION", targetId: "order-list", verb: "USE", scope: null };
    const publication = { ...item, id: 2, source: "first-publication", entryId: null };
    post.mockResolvedValueOnce(json({ policyId, canManage: true, targetPolicyRoleIds: ["role-1"], items: [item, publication] }));
    const record = await listPendingPolicyGrants(viewer, domainId, policyId);
    expect(record.fields.canManage).toBe(true);
    expect(structuredField(record, "items")).toEqual([
      { ...item, label: "Order list" }, { ...publication, label: "Order list" },
    ]);
    expect(post).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/\/pending:list$/), { policyId }, expect.anything());

    const result = { policyId, resolvedCount: 2 };
    post.mockResolvedValueOnce(json(result));
    const input = { resolutions: [{ id: 1, confirm: true, scope }, { id: 2, confirm: false }] };
    expect(await resolvePendingPolicyGrants(viewer, policyId, input)).toEqual(result);
    expect(post).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/\/pending:resolve$/), { policyId, ...input }, expect.anything());
  });

  it("uses the batch decision and keeps fixed or workflow-only items out of the repair list", async () => {
    const actionTargets = [{ actionId: "standalone", className: "Order", objectId: "order-2", fields: { organization: "other" } }];
    const standalone = {
      kind: "ACTION", id: "standalone", verb: "EXECUTE", allowed: true,
      sources: [{ type: "policy", policyId, scope, roleIds: ["role-1"] }],
      effectiveScopes: [scope],
      targetDecisions: [{ className: "Order", objectId: "order-2", allowed: false, reason: "Outside scope" }],
    };
    post.mockResolvedValueOnce(json({ ...rootFacts, entries: [entries[0]] })).mockResolvedValueOnce(json({
      subjectId: "subject", entryId, targetPolicyId: policyId,
      targetPolicyRoleIds: ["role-1", "role-2"], subjectRoleIds: ["role-1"],
      entry: { kind: "ENTRY", id: entryId, verb: "ENTER", allowed: false, sources: [] },
      items: [
        { kind: "PROJECTION", id: "order-list", verb: "USE", allowed: false, sources: [] },
        { kind: "AGENT", id: "preset-agent", verb: "USE", allowed: false, sources: [] },
        { kind: "ACTION", id: "step-only", verb: "EXECUTE", allowed: false, sources: [{ type: "workflow_step", workflowId: "approval", version: 2, stepNo: 1 }] },
        standalone,
      ],
    }));
    const record = await inspectPolicyAccess(viewer, domainId, policyId, { subjectId: "subject", entryId, actionTargets });
    expect(post).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/\/access:inspect$/), {
      subjectId: "subject", entryId, targetPolicyId: policyId, optionalActionTargets: actionTargets,
      items: expect.arrayContaining([
        { kind: "AGENT", id: "custom-agent", verb: "USE", ownerFacts: { ownerId: "agent-owner", state: "PUBLISHED" } },
        { kind: "PANEL", id: "orders-panel", verb: "USE", ownerFacts: { ownerId: "panel-owner", state: "PUBLISHED" } },
        { kind: "ACTION", id: "step-only", verb: "EXECUTE" },
      ]),
    }, expect.anything());
    expect(structuredField(record, "entry")).toMatchObject({ id: entryId, label: "Orders", allowed: false });
    expect(structuredField(record, "items")).toEqual(expect.arrayContaining([{ ...standalone, label: "Submit order" }]));
    expect(structuredField(record, "missingGrantableItems")).toEqual([{ kind: "PROJECTION", id: "order-list", verb: "USE", label: "Order list" }]);
  });

  it("exposes the policy reads and dispatches both registered writes for the selected policy", async () => {
    const reads = createGovernanceReadAdapters(viewer).policies;
    expect((await reads.previewEntryGrant(domainId, policyId, { entryIds: [entryId] })).primaryKey).toBe(policyId);
    const target = { kind: "object", objectType: PERMISSION_POLICY, primaryKey: policyId } as const;
    const actor = { credentials: viewer, owner: { domainId, userId: "viewer" } };
    const host: PanelOperationHost = { initiator: actor, executor: actor, request: vi.fn(), requestWorkbench: vi.fn() };
    for (const operation of [
      { id: GRANT_POLICY_ENTRIES, input: { entryIds: [entryId], acceptedObjects: [] }, data: { policyId, grantedEntryCount: 1, grantedObjectCount: 0 } },
      { id: RESOLVE_PENDING_POLICY_GRANT, input: { resolutions: [{ id: 1, confirm: false }] }, data: { policyId, resolvedCount: 1 } },
    ]) {
      const handler = registeredPanelOperation(operation.id)?.handler;
      if (!handler || handler.effect !== "write" || handler.kind !== "action" || handler.batch || !handler.targetInput)
        throw new Error("Missing policy write");
      post.mockResolvedValueOnce(json(operation.data));
      expect(await handler.execute(host, target, operation.input, "intent")).toMatchObject({
        kind: "success", data: operation.data,
        affected: { objects: [{ objectType: PERMISSION_POLICY, primaryKey: policyId }], objectTypes: expect.arrayContaining([PERMISSION_POLICY]) },
      });
    }
  });
});
