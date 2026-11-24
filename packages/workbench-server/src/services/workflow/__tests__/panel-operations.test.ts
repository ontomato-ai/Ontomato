import { expect, it, vi } from "vitest";
import { ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW, WORKFLOW } from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { panelServerOperation, type PanelOperationHost, type PanelWriteServerOperation } from "../../product-panels/server-operations";

vi.mock("../../assistant/skills", () => ({
  readAssistantSkillView: vi.fn(), resolvePageSkillSource: vi.fn(), loadedPageSkillVersion: vi.fn(),
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
  await expect(write(ACTIVATE_WORKFLOW).unavailable?.(host("ACTIVE"), target)).resolves.toMatchObject({ reason: expect.stringContaining("already active") });
  await expect(write(ACTIVATE_WORKFLOW).unavailable?.(host("ACTIVE", true), target)).resolves.toBeUndefined();
  await expect(write(DEACTIVATE_WORKFLOW).unavailable?.(host("DRAFT"), target)).resolves.toMatchObject({ reason: expect.stringContaining("active workflow") });
  await expect(write(DELETE_WORKFLOW).unavailable?.(host("ACTIVE"), target)).resolves.toMatchObject({ reason: expect.stringContaining("before deleting") });
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
