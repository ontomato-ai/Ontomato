import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
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
 * An application's icon in its owner's form (2026-11-21 acceptance L-02): the reader sees the allowed domain application icons and picks
 * one, as the platform's own application settings do, and the owner keeps its string key; a key an older release wrote
 * stays until the reader picks another.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
/** Any owner's form: the field's control is the same on every one. */
const target = { className: FUNCTION, primaryKey: "fn-1" };
const projection: DirectProjection = {
  ...record, id: "application-form", name: "Application", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { app: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "app" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "app" } } },
};
const manifest: DirectPanelManifest = {
  state: { app: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { app: { state: "app" } } } },
};
const description = {
  fields: [{ path: "/icon", label: "Icon", help: "Tells the application apart in the navigation.", control: { kind: "application-icon" }, valueSchema: {}, required: true, readOnly: false }],
  values: { icon: "retired-key" },
  errors: [], revision: 1,
  save: { method: "PUT", path: "/applications/:id", bodySchema: {}, draftOperation: "application.save" },
};
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

afterEach(() => {
  document.body.innerHTML = "";
});

it("shows the icons available to a domain application and keeps the key the reader picks", async () => {
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "applications", url: () => "/applications", label: () => "Applications", initial: { app: target },
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => (request.operations ? ready({}) : ready(description)),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "form" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const field = await vi.waitFor(() => {
    const found = element.querySelector<HTMLElement>('[data-field="/icon"]');
    if (!found) throw new Error("The form is not drawn");
    return found;
  });
  expect(field.textContent).not.toContain(publicEn.platform.formControlUnavailable);
  const values = () => instance.forms.handle("form")!.values.value.icon;
  // The key an older release wrote is kept, though the platform no longer offers it.
  expect(values()).toBe("retired-key");
  const users = field.querySelector<HTMLButtonElement>('button[aria-label="users"]');
  expect(users).not.toBeNull();
  users!.click();
  await nextTick();
  expect(values()).toBe("users");
  expect(field.querySelector('button[aria-label="users"]')?.getAttribute("aria-pressed")).toBe("true");

  // Laid out as the form's other controls are (M2, 2026-11-21): across the row, its help under it, and the icon it holds
  // beside the search rather than alone at the far end of an empty heading.
  const picker = field.querySelector<HTMLElement>(".application-icon-picker")!;
  expect(picker.classList.contains("sdk-form-field-wide")).toBe(true);
  expect(picker.nextElementSibling?.textContent).toBe("Tells the application apart in the navigation.");
  expect(picker.querySelector(".icon-heading")).toBeNull();
  const search = picker.querySelector(".icon-search")!;
  expect(search.querySelector("input")).not.toBeNull();
  expect(search.querySelector(".icon-current svg")).not.toBeNull();
});
