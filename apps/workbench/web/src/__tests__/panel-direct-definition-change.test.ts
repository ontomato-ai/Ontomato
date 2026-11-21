import { noOperations } from "./panel-frame";
import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelHumanOperationPreparation } from "@ontomato/contracts/panel-agent";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";

/*
 * A member's projection definition changing while the reader has unsaved input (design 5: no executable content is
 * swapped while a draft is protected): the change waits, the input and the unsaved state stay, and the new definition
 * is drawn once the reader saved — the same rule a panel's frame follows.
 *
 * The mistake this catches: a directly rendered member drawn anew from its changed definition mid-typing, losing what
 * the reader typed.
 */

const task = { className: SCHEDULED_TASK, primaryKey: "t-1" };
const base = { domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
let revision = 1;
const formProjection = (): DirectProjection => ({
  ...base, id: "task-form", revision, name: revision === 1 ? "Task form" : "Task form v2", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
  data: { form: { source: { object: { input: "task" } }, read: "form", params: {} } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${SCHEDULED_TASK}.save` }, target: { input: "task" } } },
});
/** The owner's save of the chosen task, as it admits it. */
const admitted: ProductPanelReadResponse = { status: "ready", value: { save: {
  kind: "form.save", handlerRef: `${SCHEDULED_TASK}.save`, label: "Save", effect: "write", target: { source: "input", input: "task" },
  inputSchema: {}, resultSchema: {}, batch: false,
} } };

const manifest: DirectPanelManifest = {
  state: { selectedTask: { type: { kind: "object", objectType: SCHEDULED_TASK }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: "task-form" }, inputs: { task: { state: "selectedTask" } } } },
  events: {},
};
const description = {
  fields: [{ path: "/name", label: "Name", control: { kind: "text" as const }, valueSchema: {}, required: false, readOnly: false }],
  values: { name: "Nightly" }, errors: [], revision: 2,
  save: { method: "PUT" as const, path: "/tasks/:id", bodySchema: {}, draftOperation: `${SCHEDULED_TASK}.save` },
};

afterEach(() => {
  document.body.innerHTML = "";
  revision = 1;
});

it("keeps the reader's unsaved input when the member's definition changes, and draws the new one after the save", async () => {
  const projectionReads = vi.fn();
  // The platform's request path: projection records, and the coordinator preparing the save.
  const requests = {
    request: async (path: string, init: { body?: unknown }) => {
      if (path === "/panel-operations/intents") {
        const { operationId } = JSON.parse(String(init.body)) as { operationId: string };
        const preparation: PanelHumanOperationPreparation = {
          intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d07", operationId, label: operationId, confirmation: { kind: "none" },
        };
        return Response.json(preparation);
      }
      projectionReads(path);
      return Response.json({ projection: formProjection() });
    },
  };
  const mount = mountDirectPanel({
    manifest,
    run: {
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: { selectedTask: task },
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {}, failed: (reason) => { throw reason; },
    },
    requests, use: { applicationId: "app-tasks", useId: "tasks" }, messages: {}, locale: ref("en"), defaultLocale: "en",
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: async ({ intentId }) => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: { kind: "success", data: {} } } }),
    read: async (request): Promise<ProductPanelReadResponse> => (request.operations ? admitted : { status: "ready", value: description as never }),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h("div", [mount.member("form")]) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const name = () => element.querySelector<HTMLInputElement>('[data-field="/name"] input')!;
  await vi.waitFor(() => expect(name()?.value).toBe("Nightly"));

  name().value = "Nightly run";
  name().dispatchEvent(new Event("input"));
  await nextTick();
  expect(mount.instance.dirty()).toBe(true);

  revision = 2;
  mount.projectionsChanged([{ id: "task-form", revision: 2 }]);
  await nextTick();
  await nextTick();
  // Held while the reader's input is unsaved: nothing is read anew, the input and the unsaved state stay.
  expect(projectionReads).toHaveBeenCalledTimes(1);
  expect(name().value).toBe("Nightly run");
  expect(mount.instance.dirty()).toBe(true);

  // Saved, the form is clean, and the definition that waited is read and drawn.
  await mount.invoke("form.save");
  await vi.waitFor(() => expect(projectionReads).toHaveBeenCalledTimes(2));
  expect(mount.instance.dirty()).toBe(false);
  await vi.waitFor(() => expect(name()?.value).toBe("Nightly"));
});
