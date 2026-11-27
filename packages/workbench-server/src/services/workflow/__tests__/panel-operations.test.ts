import { expect, it, vi } from "vitest";
import { ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW, WORKFLOW } from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { panelServerOperation, type PanelOperationHost, type PanelWriteServerOperation } from "../../product-panels/server-operations";
import type { JavaPanelReadResult } from "../../product-panels/java-panel-reads";
import type { RegisteredDataReadItem } from "../../product-panels/registered-data-read";
import { ready, refusalsOf } from "../../product-panels/__tests__/availability-fixture";

vi.mock("../../assistant/skills", () => ({
  readAssistantSkillView: vi.fn(), loadedSkillVersion: vi.fn(),
}));

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

function fakeHost(ownerAnswer: (path: string) => unknown) {
  const actor = { owner: { domainId: "d", userId: "reader" }, credentials: { token: "token", locale: "en" } };
  const request = vi.fn<Parameters<PanelOperationHost["request"]>, ReturnType<PanelOperationHost["request"]>>(
    async path => Response.json(ownerAnswer(path)),
  );
  const host: PanelOperationHost = { initiator: actor, executor: actor, locale: "en", request, requestWorkbench: request };
  return { host, request };
}

const write = (ref: string) =>
  panelServerOperation(ref) as Extract<PanelWriteServerOperation, { targetType: string }>;
const target = { kind: "object" as const, objectType: WORKFLOW, primaryKey: "wf-1" };

it("saves draft fields in the Java workflow shape and reports the assigned object", async () => {
  const { host, request } = fakeHost(() => ({ success: true, data: { id: "new", name: "Restock" } }));
  const operation = write(`${WORKFLOW}.save`);
  const result = await operation.execute(host, { kind: "draft" }, { values: {
    name: " Restock ",
    runClassName: "LegacyOrder",
    runContract: { className: "Order" },
    steps: [
      { name: "Empty step", roleCode: " ", actionId: "" },
      { name: "Check", roleCode: "buyer", invocationChoice: "fixed", actorPolicy: { mode: "rule", parameters: { limit: 20 } } },
      { name: "Order", actionId: "buy", invocationChoice: "automatic", caseScoped: true },
    ],
  } }, "intent");
  expect(request.mock.calls[0][0]).toBe("/api/data-query/workflow/save");
  expect(JSON.parse(String(request.mock.calls[0][1].body))).toEqual({
    name: "Restock", runClassName: "Order", runContract: { className: "Order" },
    steps: [
      { stepNo: 1, name: "Check", roleCode: "buyer", actionType: "execute", invocationMode: "manual", caseScoped: false,
        actorPolicy: { mode: "rule", principalField: "principal", parameters: { limit: 20 }, parameterBindings: {}, valueMap: {} } },
      { stepNo: 2, name: "Order", actionId: "buy", actionType: "approve", invocationMode: "automatic", caseScoped: true,
        actorPolicy: { mode: "none" } },
    ],
  });
  expect(result).toEqual({
    kind: "success", data: { id: "new" }, created: { objectType: WORKFLOW, primaryKey: "new" },
    affected: { objects: [{ objectType: WORKFLOW, primaryKey: "new" }], objectTypes: [WORKFLOW] },
  });
});

it("rejects blank workflow names and non-object policy JSON before writing", async () => {
  const { host, request } = fakeHost(() => ({ success: true }));
  const operation = write(`${WORKFLOW}.save`);
  await expect(operation.execute(host, { kind: "draft" }, { values: { name: " " } }, "intent")).rejects.toThrow();
  for (const field of ["parameters", "parameterBindings", "valueMap"]) {
    await expect(operation.execute(host, { kind: "draft" }, { values: {
      name: "Restock",
      steps: [{ actionId: "buy", actorPolicy: { mode: "rule", [field]: [] } }],
    } }, "intent")).rejects.toThrow();
  }
  expect(request).not.toHaveBeenCalled();
});

it("describes the lifecycle impact and provides the availability reason for the selected workflow", async () => {
  const host = (status: string, hasDraft = false) =>
    fakeHost(() => ({ success: true, data: { id: "wf-1", name: "Restock", status, hasDraft } })).host;
  for (const id of [ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW]) {
    const operation = write(id);
    const impact = await operation.inspectImpact?.inspect(host("DRAFT"), [{ target, input: {} }]);
    expect(impact).toMatchObject({
      summary: expect.stringContaining("Restock"),
      objects: [{ target: { objectType: WORKFLOW, primaryKey: "wf-1" }, label: "Restock" }],
      total: 1,
    });
  }
  const refusal = async (id: string, status: string, hasDraft = false) =>
    (await refusalsOf(write(id), [target], () => ready({ id: "wf-1", status, hasDraft }))).refusals[0];
  expect(await refusal(ACTIVATE_WORKFLOW, "ACTIVE")).toMatchObject({ reason: expect.stringContaining("already active") });
  expect(await refusal(ACTIVATE_WORKFLOW, "ACTIVE", true)).toBeUndefined();
  expect(await refusal(DEACTIVATE_WORKFLOW, "DRAFT")).toMatchObject({ reason: expect.stringContaining("active workflow") });
  expect(await refusal(DELETE_WORKFLOW, "ACTIVE")).toMatchObject({ reason: expect.stringContaining("before deleting") });
});


it("reads each workflow's lifecycle state, takes it from rows, and finds a selection with any missing workflow not found", async () => {
  const states: Record<string, object> = {
    "wf-1": { id: "wf-1", status: "ACTIVE", hasDraft: false }, "wf-2": { id: "wf-2", status: "DRAFT", hasDraft: false },
  };
  const answer = (item: RegisteredDataReadItem): JavaPanelReadResult => {
    const state = states[item.call!.parameters.primaryKey as string];
    return state ? ready(state) : { status: "error", code: "WORKFLOW_NOT_FOUND", error: "Workflow not found" };
  };
  const operation = write(ACTIVATE_WORKFLOW);
  const second = { ...target, primaryKey: "wf-2" };
  const page = await refusalsOf(operation, [target, second], answer);
  expect(page.reads).toEqual(["wf-1", "wf-2"].map(primaryKey =>
    ({ call: { type: WORKFLOW, name: "lifecycleState", parameters: { primaryKey } } })));
  expect(page.refusals[0]?.reason).toContain("already active");
  expect(page.refusals[1]).toBeUndefined();

  const missing = await refusalsOf(operation, [second, { ...target, primaryKey: "wf-gone" }], answer);
  expect(missing.refusals).toEqual([{ reason: en["panels.workflow.notFound"] }, { reason: en["panels.workflow.notFound"] }]);

  expect(operation.availability!.row!({ primaryKey: "wf-1", label: "Restock", fields: { statusCode: "ACTIVE", hasDraft: true } }))
    .toEqual({ status: "ACTIVE", hasDraft: true });
});

it("reports activation notes and submits each lifecycle action to its owner", async () => {
  const { host, request } = fakeHost(() => ({ success: true, data: { id: "wf-1", activationNotes: ["Generated one query.", "Review query names."] } }));
  const result = await write(ACTIVATE_WORKFLOW).execute(host, target, {}, "intent");
  expect(result).toMatchObject({ kind: "success", message: "Workflow activated. Generated one query.\nReview query names." });
  await expect(write(DEACTIVATE_WORKFLOW).execute(host, target, {}, "intent")).resolves.toMatchObject({ kind: "success" });
  await expect(write(DELETE_WORKFLOW).execute(host, target, {}, "intent")).resolves.toMatchObject({
    kind: "success", affected: { removed: [{ objectType: WORKFLOW, primaryKey: "wf-1" }] },
  });
  expect(request.mock.calls.map(([path, init]) => [path, JSON.parse(String(init.body))])).toEqual([
    ["/api/data-query/workflow/activate", { id: "wf-1" }],
    ["/api/data-query/workflow/deactivate", { id: "wf-1" }],
    ["/api/data-query/workflow/delete", { id: "wf-1" }],
  ]);
});
