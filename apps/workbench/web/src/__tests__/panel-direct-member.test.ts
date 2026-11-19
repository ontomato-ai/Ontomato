import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Members of a directly rendered panel (design 4.2): the instance reads each member's named data through the host's one
 * read port, and the components show it in the product's one presentation of its states. The form reads the owner's
 * form for the selected task, asks the owner again with its values, and saves through the owner's own operation; the
 * button reads the owner's description of run-now and runs it through the coordinator.
 *
 * The mistakes these catch: a component still sending a request of its own; a read made for nothing selected, or an
 * empty answer shown for it; an answer for an earlier selection drawn for the new one; a save or a run that does not go
 * to the owner's operation; a refusal whose field messages land nowhere; data an operation changed left as it was.
 */

const task = (primaryKey: string) => ({ className: SCHEDULED_TASK, primaryKey });
const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projections: Record<string, DirectProjection> = {
  "task-form": {
    ...record, id: "task-form", name: "Task form", componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {}, config: {},
    data: { form: { source: { object: { input: "task" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  },
  "task-run": {
    ...record, id: "task-run", name: "Run now", componentId: "@ontomato/sdk:OperationButton",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
    data: { operation: { source: { operation: "schedules.runNow" }, read: "describe", params: {} } },
  },
};
const manifest: DirectPanelManifest = {
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
  members: {
    form: { target: { projectionId: "task-form" }, inputs: { task: { state: "selectedTask" } } },
    run: { target: { projectionId: "task-run" }, inputs: { task: { state: "selectedTask" } } },
  },
  events: {},
};
const field = (path: string, label: string) => ({ path, label, control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false });
const form = (name: string, revision = 3) => ({
  fields: [field("/name", "Name"), field("/note", "Note")], values: { name, note: "" }, revision,
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
});
const runNow = {
  handlerRef: "schedules.runNow", effect: "write", target: { source: "input", input: "task" },
  inputSchema: {}, resultSchema: {}, batch: false,
};

type Read = Omit<ProductPanelReadRequest, "source">;
function open(answer: (request: Read) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>, initial = {}) {
  const reads: Read[] = [];
  const prepared: [string, unknown][] = [];
  let outcome: unknown = { kind: "success", data: {}, affected: { objects: [task("t-1")], objectTypes: [SCHEDULED_TASK] } };
  const prepare = vi.fn(async (operationId: string, invocation: unknown): Promise<PanelHumanOperationPreparation> => {
    prepared.push([operationId, invocation]);
    return { intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d05", operationId, label: operationId, confirmation: { kind: "none" } };
  });
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial,
    text: createPanelText({}, { value: "en" } as never, "en"),
    operations: { ...noOperations.operations, prepare },
    confirmOperation: async ({ intentId }) => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: outcome as never } }),
    recordDraftCreated: async () => {},
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      reads.push(request);
      return answer(request);
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h("div", [h(PanelMember, { instance, member: "form" }), h(PanelMember, { instance, member: "run" })]) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { instance, element, reads, prepared, setOutcome: (next: unknown) => { outcome = next; }, unmount: () => app.unmount() };
}

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });
const owner = (request: Read) => ready(request.dataName === "operation" ? runNow : form(String((request.inputs.task as { primaryKey: string }).primaryKey)));
const input = (element: HTMLElement, path: string) => element.querySelector<HTMLInputElement>(`[data-field="${path}"] input`)!;

afterEach(() => {
  document.body.innerHTML = "";
});

it("asks for a selection without reading, then reads the owner's form and run-now description for the selected task", async () => {
  const { instance, element, reads } = open(owner);
  await vi.waitFor(() => expect(element.textContent).toContain("Select an item first"));
  // Nothing is read for nothing selected, and nothing says it was found empty.
  expect(reads.filter((read) => read.dataName === "form")).toEqual([]);
  expect(element.textContent).not.toContain("Nothing to show");

  instance.state.set("selectedTask", task("t-1"));
  await vi.waitFor(() => expect(input(element, "/name")?.value).toBe("t-1"));
  expect(reads.find((read) => read.dataName === "form")).toEqual({
    memberPath: [{ member: "form" }], dataName: "form", inputs: { task: task("t-1"), changedField: null },
  });
  expect(reads.find((read) => read.dataName === "operation")).toMatchObject({ memberPath: [{ member: "run" }], dataName: "operation" });
  await vi.waitFor(() => expect(element.querySelector(".sdk-operation-button button")?.textContent?.trim()).toBe("Run now"));
});

it("saves through the owner's operation, marks the fields the owner refused, and reads again what it changed", async () => {
  const { instance, element, prepared, setOutcome, reads } = open(owner, { selectedTask: task("t-1") });
  await vi.waitFor(() => expect(input(element, "/name")?.value).toBe("t-1"));
  setOutcome({ kind: "refusal", code: "FIELD_VALIDATION_FAILED", message: "Check the marked fields",
    details: { fields: [{ field: "/note", message: "A note is a sentence" }] } });
  const note = input(element, "/note");
  note.value = "x";
  note.dispatchEvent(new Event("input"));
  await nextTick();
  await expect(instance.invoke("form.save")).rejects.toThrow("Check the marked fields");
  expect(prepared[0]).toEqual(["form.save", { call: {
    target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" },
    input: { values: { name: "t-1", note: "x" }, revision: 3, submittedFields: ["/note"] },
  } }]);
  await vi.waitFor(() => expect(element.querySelector('[data-field="/note"] .el-form-item__error')?.textContent).toBe("A note is a sentence"));

  setOutcome({ kind: "success", data: {}, affected: { objects: [task("t-1")], objectTypes: [SCHEDULED_TASK] } });
  const before = reads.filter((read) => read.dataName === "form").length;
  await instance.invoke("form.save");
  await nextTick();
  // The receipt rereads nothing itself; what it changed reaches the instance through the host's refresh port, once.
  expect(reads.filter((read) => read.dataName === "form").length).toBe(before);
  instance.refresh({ objects: [{ objectType: SCHEDULED_TASK, primaryKey: "t-1" }], objectTypes: [SCHEDULED_TASK] });
  await vi.waitFor(() => expect(reads.filter((read) => read.dataName === "form").length).toBe(before + 1));
  await nextTick();
  expect(reads.filter((read) => read.dataName === "form").length).toBe(before + 1);
});

it("runs run-now through the owner's operation for the selected task", async () => {
  const { element, prepared } = open(owner, { selectedTask: task("t-1") });
  const button = await vi.waitFor(() => {
    const found = element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
    if (!found || found.disabled) throw new Error("The button is not ready");
    return found;
  });
  button.click();
  await vi.waitFor(() => expect(prepared).toEqual([["run.runNow", { call: { target: { kind: "object", ...{ objectType: SCHEDULED_TASK, primaryKey: "t-1" } }, input: {} } }]]));
});

it("shows no permission and the owner's reason in the product's one presentation", async () => {
  const { element } = open((request) => (request.dataName === "form"
    ? { status: "forbidden" } : { status: "error", message: "The task service did not answer" }), { selectedTask: task("t-1") });
  await vi.waitFor(() => {
    expect(element.textContent).toContain("You do not have access to this");
    expect(element.querySelector(".sdk-operation-button [role=alert]")?.textContent).toBe("The task service did not answer");
  });
});

it("never draws an answer for an earlier selection over the later one", async () => {
  const pending = new Map<string, (answer: ProductPanelReadResponse) => void>();
  const { instance, element } = open((request) => {
    if (request.dataName === "operation") return ready(runNow);
    const key = (request.inputs.task as { primaryKey: string }).primaryKey;
    return new Promise((resolve) => pending.set(key, resolve));
  }, { selectedTask: task("t-1") });
  await vi.waitFor(() => expect(pending.has("t-1")).toBe(true));
  instance.state.set("selectedTask", task("t-2"));
  await vi.waitFor(() => expect(pending.has("t-2")).toBe(true));
  pending.get("t-2")!(ready(form("t-2")));
  await vi.waitFor(() => expect(input(element, "/name")?.value).toBe("t-2"));
  pending.get("t-1")!(ready(form("t-1")));
  await nextTick();
  await nextTick();
  expect(input(element, "/name").value).toBe("t-2");
});
