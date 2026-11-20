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
    data: { operation: { source: { operation: { kind: "PlatformOperation", id: "schedules.runNow" } }, read: "describe", params: {} } },
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
  fields: [field("/name", "Name"), field("/note", "Note")], values: { name, note: "" }, errors: [], revision,
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
});
const runNow = {
  handlerRef: "schedules.runNow", label: "立即运行", effect: "write", target: { source: "input", input: "task" },
  inputSchema: {}, resultSchema: {}, batch: false,
};

type Read = Omit<ProductPanelReadRequest, "source">;
function open(answer: (request: Read) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>, initial = {}) {
  const reads: Read[] = [];
  const draftErrors: unknown[] = [];
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
    expandPageComposer: noOperations.expandPageComposer,
    confirmOperation: async ({ intentId }) => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: outcome as never } }),
    recordDraftCreated: async () => {},
    reportDraftError: (reason) => draftErrors.push(reason),
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
  return { instance, element, reads, prepared, draftErrors, setOutcome: (next: unknown) => { outcome = next; }, unmount: () => app.unmount() };
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
  // The button is named as the owner names the operation in the reader's language, not by the projection's own name.
  await vi.waitFor(() => expect(element.querySelector(".sdk-operation-button button")?.textContent?.trim()).toBe("立即运行"));
});

it("saves through the owner's operation, marks the fields the owner refused, and reads again what it changed", async () => {
  const { instance, element, prepared, setOutcome, reads } = open(owner, { selectedTask: task("t-1") });
  await vi.waitFor(() => expect(input(element, "/name")?.value).toBe("t-1"));
  setOutcome({ kind: "refusal", code: "FIELD_VALIDATION_FAILED", message: "Check the marked fields",
    errors: [{ field: "/note", code: "value_too_long", message: "A note is a sentence" }] });
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

it("runs run-now through the owner's operation for the selected task, and says what the owner said of it", async () => {
  const { element, prepared, setOutcome } = open(owner, { selectedTask: task("t-1") });
  const button = await vi.waitFor(() => {
    const found = element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
    if (!found || found.disabled) throw new Error("The button is not ready");
    return found;
  });
  // The owner returns the run it started, and says in the reader's language that it started.
  const started = { id: "run-1", taskId: "t-1", status: "running", startedAt: "2026-11-20T08:00:00Z" };
  setOutcome({ kind: "success", data: started, message: "已开始运行", affected: { objects: [task("t-1")], objectTypes: [SCHEDULED_TASK] } });
  button.click();
  await vi.waitFor(() => expect(prepared).toEqual([["run.runNow", { call: { target: { kind: "object", ...{ objectType: SCHEDULED_TASK, primaryKey: "t-1" } }, input: {} } }]]));
  const said = () => element.querySelector(".sdk-operation-button [data-outcome=success]")?.textContent;
  await vi.waitFor(() => expect(said()).toBe("已开始运行"));
  // What the write returned is the owner's record of it, never laid out for the reader.
  expect(element.querySelector(".sdk-operation-result")).toBeNull();
  expect(element.textContent).not.toContain("run-1");

  // An owner that says nothing of it: the platform's own word that it was done.
  setOutcome({ kind: "success", data: started, affected: { objects: [task("t-1")], objectTypes: [SCHEDULED_TASK] } });
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  button.click();
  await vi.waitFor(() => expect(said()).toBe("Done"));
  expect(element.querySelector(".sdk-operation-result")).toBeNull();
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

it("shows the fields the owner does not accept in the form it read, keeping the values it returned", async () => {
  const errors = [{ field: "/note", code: "value_too_long", message: "A note is a sentence" }];
  const { element } = open((request) => (request.dataName === "operation" ? ready(runNow)
    : ready({ ...form("t-1"), values: { name: "t-1", note: "x" }, errors })), { selectedTask: task("t-1") });
  await vi.waitFor(() => expect(element.querySelector('[data-field="/note"] .el-form-item__error')?.textContent).toBe("A note is a sentence"));
  expect(input(element, "/note").value).toBe("x");
});

it("refuses a draft whole when the owner's check of it names fields it does not accept", async () => {
  const { receivePanelDraft } = await import("../../../../../packages/apps-sdk/src/panel/draft");
  const errors = [{ field: "/note", code: "value_too_long", message: "A note is a sentence" }];
  const { instance, element, reads, draftErrors } = open((request) => {
    if (request.dataName === "operation") return ready(runNow);
    // The owner checks the draft's values and answers its form with what it does not accept.
    return ready(request.inputs.values ? { ...form("t-1"), values: request.inputs.values, errors } : form("t-1"));
  }, { selectedTask: task("t-1") });
  await vi.waitFor(() => expect(input(element, "/name")?.value).toBe("t-1"));
  const link = { sessionId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d01", runId: "7d1c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d02", path: "outputs/drafts/task.page-draft.json" };
  await receivePanelDraft("tasks", instance.forms, {
    readPageDraft: async () => ({ pageKey: "tasks", operation: `${SCHEDULED_TASK}.save`, target: { id: "t-1" }, form: { name: "t-1", note: "x" } }),
  }, link, instance.receiveDraft);
  await vi.waitFor(() => expect(draftErrors).toHaveLength(1));
  expect((draftErrors[0] as Error).message).toBe("A note is a sentence");
  expect(reads.find((read) => read.inputs.values)?.inputs).toMatchObject({ values: { name: "t-1", note: "x" }, changedField: null });
  // Nothing of the refused draft is shown as the form's.
  expect(instance.dirty()).toBe(false);
  expect(input(element, "/note").value).toBe("");
});

it("keeps what the reader types when the first read of the form is answered after a refresh's, and holds a refresh while they type", async () => {
  // A directly rendered page opened, or reloaded, and sent to the background and back at once: the refresh reaches the
  // form while its first read is on its way, the refresh's own read comes back first and the reader starts typing; the
  // first read, answered last with the note as it was saved, must not put that back (128, 2026-11-19, in a frame).
  let holdFirst: ((answer: ProductPanelReadResponse) => void) | null = null;
  let formReads = 0;
  const { instance, element } = open((request) => {
    if (request.dataName !== "form") return owner(request);
    formReads += 1;
    if (formReads === 1) return new Promise((resolve) => { holdFirst = resolve; });
    return owner(request);
  }, { selectedTask: task("t-1") });
  await vi.waitFor(() => expect(holdFirst).not.toBeNull());
  instance.refreshAll();
  await vi.waitFor(() => expect(input(element, "/name")?.value).toBe("t-1"));
  const note = input(element, "/note");
  note.value = "Typed while the first read was on its way";
  note.dispatchEvent(new Event("input"));
  await nextTick();

  holdFirst!(owner({ memberPath: [{ member: "form" }], dataName: "form", inputs: { task: task("t-1") } }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(input(element, "/note")).toBe(note);
  expect(note.value).toBe("Typed while the first read was on its way");
  expect(instance.dirty()).toBe(true);

  // Another refresh while the reader holds the edit waits until they save or discard: what they typed stays.
  const before = formReads;
  instance.refreshAll();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(formReads).toBe(before);
  expect(input(element, "/note").value).toBe("Typed while the first read was on its way");
  expect(instance.dirty()).toBe(true);
});
