import { WORKFLOW } from "@ontomato/contracts/platform-object-types";
import { expect, it } from "vitest";
import { panelFormDescriptionSchema, type PanelFormField } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { createWorkflowPanelReadPresenter, prepareWorkflowPanelRead } from "../panel-reads";

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const viewer = { locale: "en" };
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
const grant = { roleCode: "buyer", capabilityId: "act-1", stepNo: 2, scope: { kind: "all" }, inForce: true, activatedByWorkflowVersion: "2" };
const subjects = [{ id: "alice", loginCode: "a", displayName: "Alice" }, { id: "bob", loginCode: "bob-login" }];
const actions = [{ id: "act-1", name: "Buy", status: "PUBLISHED" }, { id: "act-2", name: "Ship", status: "PENDING_REVIEW" }];
const grants = [
  { ...grant, workflowId: workflow.id },
  { ...grant, workflowId: workflow.id, capabilityId: "act-2", inForce: false },
  { ...grant, roleCode: "direct", workflowId: null, stepNo: null, activatedByWorkflowVersion: null },
  { ...grant, roleCode: "unrelated", capabilityId: "act-3", workflowId: null, stepNo: null, activatedByWorkflowVersion: null },
  { ...grant, workflowId: "other" },
];
const formFacts = { subjects, actions };
const recordFacts = { ...formFacts, grants };
const catalogueFacts = { ...recordFacts, workflows: [workflow, draft] };

function plan(method: string, params: Record<string, unknown> = {}, primaryKey?: string) {
  return prepareWorkflowPanelRead({ typeId: WORKFLOW, method, primaryKey }, params, viewer.locale)!;
}

function walkFields(fields: PanelFormField[]): PanelFormField[] {
  return fields.flatMap(field => {
    const { control } = field;
    if (control.kind === "object") return [field, ...walkFields([...control.fields, ...Object.values(control.variants ?? {}).flat()])];
    if (control.kind === "object-array") return [field, ...walkFields(control.itemFields)];
    return [field];
  });
}

it("projects list, query and record facts through the registered workflow plan", () => {
  const list = plan("list");
  const query = plan("query", { search: "FLOW", cursor: "1", size: 1 });
  const detail = plan("record", {}, workflow.id);
  expect([list.call.parameters, query.call.parameters]).toEqual([{}, {}]);
  expect(detail.call.parameters).toEqual({ primaryKey: workflow.id });

  const rows = list.present(catalogueFacts) as Array<Record<string, any>>;
  expect(rows[0]).toMatchObject({
    primaryKey: workflow.id, label: "Restock flow", subtitle: "Approve and restock",
    tones: { status: "success", statusBadges: "success" },
    fields: {
      status: "Active", statusBadges: ["Active", "Draft"], version: "v2", activeGrantVersion: "v2",
      createdBy: "Alice", reviewedBy: "bob-login", canActivate: true, canDeactivate: true,
      grantsSummary: "1 capabilities granted to 1 roles · 1 steps use per-case authorization",
    },
  });
  expect(rows[0].fields.stepsSummary).toContain("Review [Fixed logic · Rule (deterministic) · Alice (a) · Per-case authorization]");
  expect(rows[1]).toMatchObject({
    fields: { status: "Draft", statusBadges: ["Draft"], version: "v0", grantsSummary: "No grants", stepsSummary: "No steps defined" },
  });
  expect(query.present(catalogueFacts)).toMatchObject({ rows: [{ primaryKey: draft.id }], total: 2 });
  expect(detail.present({ ...recordFacts, workflow })).toMatchObject({ primaryKey: workflow.id, fields: { status: "Active" } });
  try {
    plan("query", { cursor: "bad" });
    expect.unreachable("invalid cursor must be rejected");
  } catch (error) {
    expect(error).toMatchObject({ code: "INVALID_CURSOR" });
  }

  const restricted = detail.present({ workflow, subjects: [], actions: [], grants: null });
  expect(restricted).toMatchObject({ fields: { createdBy: "Unspecified", grantsSummary: "Could not read grants" } });
});

it("reads the four authorization groups as records with scope and action names", () => {
  const present = createWorkflowPanelReadPresenter(viewer.locale);
  const selected = { primaryKey: workflow.id };
  expect(present.grantCaseScopedSteps({ workflow, actions })).toMatchObject([
    { fields: { roleCode: "buyer", stepName: "Review", actionName: "Buy" } },
  ]);
  expect(present.grantInForce({ grants, actions }, selected)).toMatchObject([
    { fields: { roleCode: "buyer", capabilities: ["Buy · 2 · All readable objects"] } },
  ]);
  expect(present.grantSuperseded({ grants, actions }, selected)).toMatchObject([
    { fields: { roleCode: "buyer", capabilities: ["Ship · 2 · All readable objects"] } },
  ]);
  expect(present.grantDirect({ workflow, grants, actions })).toMatchObject([
    { fields: { roleCode: "direct", capabilities: ["Buy · All readable objects"] } },
  ]);
  expect(present.grantDirect({ workflow: draft, grants, actions })).toEqual([]);
});

it("describes read-only and editable workflow forms with admitted directory and action options", () => {
  const detail = panelFormDescriptionSchema.parse(plan("form", {}, workflow.id).present({ ...formFacts, workflow }));
  expect(walkFields(detail.fields).every(field => field.readOnly)).toBe(true);
  expect(walkFields(detail.fields).find(field => field.path === "/invocationChoice")?.warning).toBe(
    "Automatic invocation is reserved for future use.",
  );
  expect(detail.values).toMatchObject({
    runContract: { className: "Order", statusOpen: ["open"], statusDone: ["done"] },
    steps: [{ invocationChoice: "fixed", actorPolicy: { parameters: { amount: 10 } } }, { invocationChoice: "automatic" }],
  });

  const values = { name: "Work in progress" };
  const create = panelFormDescriptionSchema.parse(plan("createForm", { values }).present(formFacts));
  expect(create.values).toMatchObject(values);
  const fields = walkFields(create.fields);
  expect(fields.some(field => field.readOnly)).toBe(false);
  expect(fields.find(field => field.path === "/actionId")?.control).toMatchObject({
    allowCreate: true, options: [{ value: "act-1", label: "Buy" }],
  });
  expect(fields.find(field => field.path === "/executionPrincipalId")?.control).toMatchObject({
    allowCreate: true, options: [
      { value: "alice", label: "Alice (a)" },
      { value: "bob", label: "bob-login (bob-login)" },
    ],
  });

  const restricted = panelFormDescriptionSchema.parse(plan("createForm").present({ subjects: [], actions: [] }));
  const restrictedFields = walkFields(restricted.fields);
  expect(restrictedFields.find(field => field.path === "/executionPrincipalId")?.control).toMatchObject({ options: [] });
  expect(restrictedFields.find(field => field.path === "/actionId")?.control).toMatchObject({ options: [] });
});
