import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * A form its owner keeps read-only (a function an action uses, 2026-11-21 acceptance F-01): the reason the owner gives
 * is said once for the form, not under every field it applies to, and a field with a reason of its own still says it.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const fn = { className: FUNCTION, primaryKey: "fn-1" };
const projection: DirectProjection = {
  ...record, id: "function-form", name: "Function", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { fn: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "fn" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "fn" } } },
};
const manifest: DirectPanelManifest = {
  state: { fn: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { fn: { state: "fn" } } } },
  events: {},
};
const USED = "A function an action uses cannot be changed or deleted";
const field = (path: string, label: string, control: Record<string, unknown>, more: Record<string, unknown> = {}) =>
  ({ path, label, control, valueSchema: {}, required: false, readOnly: true, readOnlyReason: USED, ...more });
const description = {
  fields: [
    field("/name", "Name", { kind: "text" }),
    field("/description", "Description", { kind: "text", multiline: true }),
    field("/parameters", "Parameters", { kind: "object-array", itemFields: [field("/name", "Parameter", { kind: "text" })] }),
    field("/code", "Code", { kind: "text" }, { readOnlyReason: "Only the owner's editor changes code" }),
  ],
  values: { name: "Adjust age", description: "Sets an age", parameters: [{ name: "personId" }], code: "pass" },
  errors: [], revision: 1,
  save: { method: "PUT", path: "/functions/:id", bodySchema: {}, draftOperation: "function.save" },
};
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

afterEach(() => {
  document.body.innerHTML = "";
});

it("says a reason the owner gives several fields once for the form, and a field's own reason beside it", async () => {
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "functions", url: () => "/functions", label: () => "Functions", initial: { fn },
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => (request.operations ? ready({}) : ready(description)),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "form" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  await vi.waitFor(() => expect(element.querySelector('[data-field="/name"] input')).toBeTruthy());

  const text = element.textContent ?? "";
  expect(text.split(USED).length - 1).toBe(1);
  expect(element.querySelector('[data-field="/name"]')?.textContent).not.toContain(USED);
  expect(element.querySelector('[data-field="/code"]')?.textContent).toContain("Only the owner's editor changes code");
  // A read-only field is marked so, and its value stays the owner's text to read.
  expect(element.querySelector('[data-field="/name"]')?.classList.contains("is-readonly")).toBe(true);
  expect(element.querySelector<HTMLInputElement>('[data-field="/name"] input')?.value).toBe("Adjust age");
});
