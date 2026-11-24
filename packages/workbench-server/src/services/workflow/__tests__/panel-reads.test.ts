import { ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW } from "@ontomato/contracts/platform-object-types";
import { afterEach, expect, it, vi } from "vitest";
import { panelFormDescriptionSchema, panelRecordListSchema, type PanelFormField } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { createWorkflowReadAdapter } from "../panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test/" } } }));

vi.mock("../../assistant/skills", () => ({
  readAssistantSkillView: vi.fn(), resolvePageSkillSource: vi.fn(), loadedPageSkillVersion: vi.fn(),
}));

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "domain-a", userId: "reader" };
const viewer = { token: "reader-token", locale: "en" };
const workflow = {
  id: "wf-1", name: "Restock flow", description: "Approve and restock", status: "ACTIVE", version: 2,
  hasDraft: true, createdBy: "alice", reviewedBy: "bob",
  runContract: { className: "Order", statusOpen: ["open"], statusDone: ["done"] },
  steps: [
    { stepNo: 1, name: "Review", roleCode: "buyer", actionId: "act-1", caseScoped: true, actionType: "execute",
      actorPolicy: { mode: "rule", executionPrincipalId: "alice", parameters: { amount: 10 } } },
    { stepNo: 2, actionId: "act-2", invocationMode: "automatic", actorPolicy: { mode: "agent" } },
  ],
};
const draft = { id: "wf-2", name: "Draft flow", status: "DRAFT", steps: [] };
const grant = { roleCode: "buyer", capabilityId: "act-1", stepNo: 2, scope: { kind: "all" }, inForce: true };

function readOwner(refused: string[] = []) {
  const responses: Record<string, unknown> = {
    "/workflow/grants": [
      { ...grant, workflowId: "wf-1" },
      { ...grant, workflowId: "wf-1", capabilityId: "act-2", inForce: false },
      { ...grant, roleCode: "direct" },
      { ...grant, workflowId: "other" },
    ],
    "/workflow/subjects": [{ id: "alice", loginCode: "a", displayName: "Alice" }, { id: "bob", loginCode: "bob-login" }],
    "/action/queryList": [{ id: "act-1", name: "Buy", status: "PUBLISHED" }, { id: "act-2", name: "Ship", status: "PENDING_REVIEW" }],
  };
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body));
    sent.push({ path, body });
    if (refused.includes(path)) return Response.json({ success: false, message: "Owner unavailable" });
    const data = path === "/workflow/query"
      ? body.id ? [workflow, draft].find(row => row.id === body.id) ?? null : [workflow, draft]
      : responses[path];
    return Response.json({ success: true, data });
  }));
  return { adapter: createWorkflowReadAdapter(owner, viewer), sent };
}

afterEach(() => { vi.unstubAllGlobals(); });

it("projects the list, including original step summaries, lifecycle and authorization", async () => {
  const { adapter, sent } = readOwner();
  const records = panelRecordListSchema.parse(await adapter.list());
  expect(sent.map(call => call.path).sort()).toEqual(["/action/queryList", "/workflow/grants", "/workflow/query", "/workflow/subjects"]);
  expect(records[0]).toMatchObject({
    primaryKey: "wf-1", label: "Restock flow", subtitle: "Approve and restock", tones: { status: "success" },
    fields: {
      status: "Active", statusCode: "ACTIVE", hasDraft: true, hasDraftLabel: "Draft", version: "v2",
      stepsSummary: "Review [Fixed logic · Rule (deterministic) · Alice (a) · Per-case authorization] → act-2 [Automatic · Agent (decision) · Praxis system principal]",
      grantsSummary: "1 capabilities granted to 1 roles · 1 steps use per-case authorization",
      createdBy: "Alice", reviewedBy: "bob-login", canActivate: true, canDeactivate: true,
    },
  });
  expect(records[1]).toMatchObject({
    fields: { status: "Draft", version: "v0", grantsSummary: "No grants", stepsSummary: "No steps defined", createdBy: "Unspecified" },
    tones: { grantsSummary: "warning", status: "warning" },
  });
});

it("filters before paginating and reads a single record by ID", async () => {
  const { adapter, sent } = readOwner();
  expect(await adapter.query({ search: "FLOW", size: 1 })).toMatchObject({ rows: [{ primaryKey: "wf-1" }], nextCursor: "1", total: 2 });
  expect(await adapter.query({ search: "FLOW", size: 1, cursor: "1" })).toMatchObject({ rows: [{ primaryKey: "wf-2" }], total: 2 });
  for (const search of ["alice", "BOB-LOGIN", "fixed logic", "active", "and restock"]) {
    expect(await adapter.query({ search })).toMatchObject({ rows: [{ primaryKey: "wf-1" }], total: 1 });
  }
  expect(await adapter.record("wf-1")).toMatchObject({ primaryKey: "wf-1", fields: { status: "Active" } });
  expect(sent).toContainEqual({ path: "/workflow/query", body: { id: "wf-1" } });
  await expect(adapter.record("missing")).rejects.toMatchObject({ status: 404, code: "WORKFLOW_NOT_FOUND" });
});

it("separates optional catalogue failures from the workflow and grant dialog reads", async () => {
  const { adapter } = readOwner(["/workflow/grants", "/workflow/subjects", "/action/queryList"]);
  expect(await adapter.list()).toMatchObject([
    { fields: { grantsSummary: "Could not read grants", createdBy: "Unspecified" } },
    { fields: { grantsSummary: "Could not read grants" } },
  ]);
  for (const read of [adapter.grantCaseScopedSteps, adapter.grantInForce, adapter.grantSuperseded, adapter.grantDirect]) {
    await expect(read("wf-1")).rejects.toMatchObject({ code: "WORKFLOW_GRANTS_UNAVAILABLE", message: "Could not read grants" });
  }
  await expect(readOwner(["/workflow/query"]).adapter.list()).rejects.toMatchObject({ status: 500, code: "WORKFLOW_READ_FAILED" });
});

it("reads the four authorization groups as records with scope and action names", async () => {
  const { adapter } = readOwner();
  expect(await adapter.grantCaseScopedSteps("wf-1")).toMatchObject([{ fields: { roleCode: "buyer", stepName: "Review", actionName: "Buy" } }]);
  expect(await adapter.grantInForce("wf-1")).toMatchObject([{ fields: { roleCode: "buyer", capabilities: ["Buy · 2 · All readable objects"] } }]);
  expect(await adapter.grantSuperseded("wf-1")).toMatchObject([{ fields: { roleCode: "buyer", capabilities: ["Ship · 2 · All readable objects"] } }]);
  expect(await adapter.grantDirect("wf-1")).toMatchObject([{ fields: { roleCode: "direct", capabilities: ["Buy · 2 · All readable objects"] } }]);
});

function walkFields(fields: PanelFormField[]): PanelFormField[] {
  return fields.flatMap(field => {
    const { control } = field;
    if (control.kind === "object") return [field, ...walkFields([...control.fields, ...Object.values(control.variants ?? {}).flat()])];
    if (control.kind === "object-array") return [field, ...walkFields(control.itemFields)];
    return [field];
  });
}

it("describes a fully read-only existing form and an editable draft that preserves values on refresh", async () => {
  const { adapter } = readOwner();
  const detail = panelFormDescriptionSchema.parse(await adapter.form("wf-1"));
  expect(walkFields(detail.fields).every(field => field.readOnly)).toBe(true);
  expect(detail.values).toMatchObject({
    runContract: { className: "Order", statusOpen: ["open"], statusDone: ["done"] },
    steps: [{ invocationChoice: "fixed", actorPolicy: { parameters: { amount: 10 } } }, { invocationChoice: "automatic" }],
  });
  const create = panelFormDescriptionSchema.parse(await adapter.createForm({}));
  const fields = walkFields(create.fields);
  expect(fields.some(field => field.readOnly)).toBe(false);
  expect(fields.find(field => field.path === "/actionId")?.control).toMatchObject({ allowCreate: true, options: [{ value: "act-1", label: "Buy", description: null, disabled: false, disabledReason: null }] });
  expect(fields.find(field => field.path === "/executionPrincipalId")?.control).toMatchObject({
    allowCreate: true, options: [
      { value: "alice", label: "Alice", description: null, disabled: false, disabledReason: null },
      { value: "bob", label: "bob-login", description: null, disabled: false, disabledReason: null },
    ],
  });
  const values = { ...create.values, name: "Work in progress" };
  expect((await adapter.createForm({ values, changedField: "/name" })).values).toEqual(values);
});

it("exposes the three lifecycle operation descriptions with their confirmation impact", async () => {
  const adapter = createWorkflowReadAdapter(owner, viewer);
  for (const ref of [ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW] as const) {
    await expect(adapter[`${ref}.describe`]()).resolves.toMatchObject({
      handlerRef: ref,
      inspectImpact: { handlerRef: `${ref}.inspect-impact` },
    });
  }
});
