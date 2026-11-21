import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, provide } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { noOperations } from "./panel-frame";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";

/*
 * A declared (direct) projection placed in an older code panel's frame through `<Projection>` — the pilot's summary and
 * form, shared by the direct panel P and the frame panel Q. Its components read the same named data as in the platform's
 * document, here through this version's resource module for the task, and run the same operations through the
 * coordinator.
 *
 * The mistakes these catch: a frame that cannot draw a declared projection at all; a component in a frame sending its
 * own request beside the member data; a run that does not reach the coordinator.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projections: Record<string, DirectProjection> = {
  "task-form": {
    ...record, id: "task-form", name: "Task form", componentId: "@ontomato/sdk:ObjectForm",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
    data: { form: { source: { object: { input: "task" } }, read: "form", params: {} } },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } } },
  },
  "task-run": {
    ...record, id: "task-run", name: "Run now", componentId: "@ontomato/sdk:OperationButton",
    inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: { operation: "runNow" },
    data: {}, operations: { runNow: { operation: { kind: "PlatformOperation", id: "schedules.runNow" }, target: { input: "task" } } },
  },
};
const panel = definePanel({
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, deepLink: true } },
  members: {
    form: { target: { projectionId: "task-form" }, inputs: { task: { state: "selectedTask" } } },
    run: { target: { projectionId: "task-run" }, inputs: { task: { state: "selectedTask" } } },
  },
  commands: {},
});
const description = {
  fields: [{ path: "/name", label: "Name", control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false }],
  values: { name: "Nightly" }, revision: 2,
  errors: [],
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
};
const runNow = { kind: "action", handlerRef: "schedules.runNow", label: "Run now", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };
const save = { kind: "form.save", handlerRef: `${SCHEDULED_TASK}.save`, label: "Save", effect: "write", target: { source: "input", input: "task" }, inputSchema: {}, resultSchema: {}, batch: false };

afterEach(() => {
  document.body.innerHTML = "";
  vi.resetModules();
});

it("draws a declared projection in a frame from this version's task module, and runs its operation through the coordinator", async () => {
  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const { createPanelInstance } = await import("../../../../../packages/apps-sdk/src/panel/instance");
  const { panelContextKey } = await import("../../../../../packages/apps-sdk/src/panel/context");
  const { default: Projection } = await import("../../../../../packages/apps-sdk/src/panel/Projection.vue");
  const describe = vi.fn(async () => description);
  registerPlatformObjectAdapter({ objectType: SCHEDULED_TASK, forms: { describe, save: vi.fn() } });
  const prepared: unknown[] = [];
  // Each member's operations as their owners admit them, read through the platform; its data, through the task module.
  const readPanelData = vi.fn(async (request: PanelMemberReadRequest): Promise<ProductPanelReadResponse> => {
    if (!request.operations) throw new Error("This test reads no member data through the platform");
    return { status: "ready", value: (request.memberPath[0]!.member === "run" ? { runNow } : { save }) as never };
  });
  const instance = createPanelInstance(panel, {
    text: (key) => key, pageKey: "tasks", url: () => "/tasks", label: () => "Tasks",
    initial: { selectedTask: { className: SCHEDULED_TASK, primaryKey: "t-1" } },
    operations: {
      ...noOperations.operations,
      prepare: async (operationId, invocation) => {
        prepared.push([operationId, invocation]);
        return { intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d06", operationId, label: "Run now", confirmation: { kind: "none" } };
      },
    },
    confirmOperation: async ({ intentId }) => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: null } }),
    recordDraftCreated: async () => {},
    readProjection: async (id) => projections[id] as never,
  });
  const app = createApp(defineComponent({
    setup: () => {
      provide(panelContextKey, {
        panel: { content: { html: "", module: "" }, manifest: panel },
        manifest: panel, instance,
        projection: (id: string) => instance.projection(id),
        invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
        projectionsChanged: () => () => {}, draft: instance.draft, holdUnsaved: () => () => {},
        t: (key: string) => key, resources: async () => {}, expandPageComposer: async () => {}, readPanelData, navigate: async () => {}, notify: () => {}, currentEntry: computed(() => null), entryMenu: computed(() => null),
      });
      return () => h("div", [h(Projection, { slot: "form" }), h(Projection, { slot: "run" })]);
    },
  }));
  const element = document.createElement("div");
  document.body.append(element);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  await vi.waitFor(() => expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Nightly"));
  expect(describe).toHaveBeenCalledWith({ target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" }, changedField: null });
  const button = await vi.waitFor(() => {
    const found = element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
    if (!found || found.disabled) throw new Error("The button is not ready");
    return found;
  });
  expect(button.textContent?.trim()).toBe("Run now");
  button.click();
  expect(readPanelData).toHaveBeenCalledWith({ memberPath: [{ member: "run" }], operations: true, inputs: { task: { className: SCHEDULED_TASK, primaryKey: "t-1" } } });
  await vi.waitFor(() => expect(prepared).toEqual([["run.runNow", { call: { target: { kind: "object", objectType: SCHEDULED_TASK, primaryKey: "t-1" }, input: {} } }]]));
  app.unmount();
});
