import { afterEach, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * What a page hears when an operation button's write is done, drawn directly: a function's delete, say. The reader is
 * told in the platform's message what was done to which object, in the owner's words — the button sits in the detail
 * that goes away with what it deleted, so a line beside it would vanish with it — and the page hears the outcome. What
 * the write removed is let go of: the selection that held it is cleared and a checked list drops it.
 *
 * What this rules out: a delete that says nothing (the button's receipt gone with the detail pane), a notice that does
 * not say which object, a page left selecting an object that no longer exists.
 */

const item = (primaryKey: string) => ({ className: BUSINESS_KNOWLEDGE, primaryKey });
const identity = (primaryKey: string) => ({ objectType: BUSINESS_KNOWLEDGE, primaryKey });
const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const remove: ProductProjection = {
  ...record, id: "knowledge-delete", name: "Delete", componentId: "@ontomato/sdk:OperationButton",
  inputs: { entry: { kind: "object", objectType: BUSINESS_KNOWLEDGE } }, outputs: {},
  config: { operation: "delete", type: "danger" },
  data: {},
  operations: { delete: { operation: { kind: "PlatformOperation", id: DELETE_KNOWLEDGE }, target: { input: "entry" } } },
};
const manifest = definePanel({
  state: {
    selected: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
    checked: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
  },
  members: { remove: { target: { projectionId: remove.id }, inputs: { entry: { state: "selected" } } } },
  commands: {},
});
const deleteKnowledge = {
  kind: "action", handlerRef: DELETE_KNOWLEDGE, label: "Delete", effect: "write", target: { source: "input", input: "entry" },
  inputSchema: {}, resultSchema: {}, batch: false,
};
const removed = { objects: [identity("k-1")], objectTypes: [BUSINESS_KNOWLEDGE], removed: [identity("k-1")] };
const done = { kind: "success", data: {}, message: "Business knowledge “Refund policy” deleted", affected: removed } as const;

function open() {
  const instance = createDirectPanelInstance(manifest, {
    readComponentPackage: noOperations.readComponentPackage,
    pageKey: "knowledge", url: () => "/ontology/knowledge", label: () => "Knowledge",
    initial: { selected: item("k-1"), checked: [item("k-1"), item("k-2")] },
    text: createPanelText({}, { value: "en" } as never, "en"),
    operations: {
      ...noOperations.operations,
      prepare: async (operationId) => ({
        intentId: "5f0c1a2e-6a0b-4f8e-9a51-0c6f3e2b1d07", operationId, label: "Delete", confirmation: { kind: "none" },
      }),
    },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: async ({ intentId }) => ({ decision: "confirm", response: { kind: "dispatched", intentId, outcome: done } }),
    recordDraftCreated: async () => {},
    readProjection: async () => remove,
    read: async (request) => ({ status: "ready", value: (request.operations ? { delete: deleteKnowledge } : null) as never }),
  });
  const heard: unknown[] = [];
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h(PanelMember, { instance, member: "remove", onDone: (outcome: unknown) => heard.push(outcome) }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { instance, element, heard, unmount: () => app.unmount() };
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("tells the reader in the platform's message what was done to which object, and hands the page the outcome", async () => {
  const { element, heard, unmount } = open();
  const button = await vi.waitFor(() => {
    const found = element.querySelector<HTMLButtonElement>(".sdk-operation-button button");
    if (!found || found.disabled) throw new Error("The button is not ready");
    return found;
  });
  button.click();
  await vi.waitFor(() => expect(document.querySelector(".el-message")?.textContent).toContain("Business knowledge “Refund policy” deleted"));
  expect(heard).toEqual([done]);
  // Said once, where it outlasts the button: nothing beside the button repeats it.
  expect(element.querySelector(".sdk-operation-button [role=status]")).toBeNull();
  unmount();
});

it("lets go of what a write removed: the selection holding it is cleared and a checked list drops it", () => {
  const { instance, unmount } = open();
  instance.refresh(removed);
  expect(instance.state.values.value.selected).toBeNull();
  expect(instance.state.values.value.checked).toEqual([item("k-2")]);
  unmount();
});
