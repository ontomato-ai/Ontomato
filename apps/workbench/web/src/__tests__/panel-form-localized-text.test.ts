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
 * A text the owner keeps in several languages (an application's names and descriptions, 2026-11-21 acceptance L-02),
 * edited as the owner stores it, `{language: text}`: the reader's language first, every language that has a text or
 * must have one shown, the rest added on demand. An optional language cleared is no longer in the value; a required one
 * cleared is the empty text, for the owner to refuse; the owner's message about one language stands on that language.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
/** Any owner's form: the field's control is the same on every one. */
const app = { className: FUNCTION, primaryKey: "fn-1" };
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
  commands: {},
};
const names = {
  path: "/names", label: "Name", valueSchema: {}, required: true, readOnly: false,
  control: {
    kind: "localized-text", primaryLocale: "zh-CN", requiredLocales: ["en"],
    locales: [{ code: "en", label: "English" }, { code: "zh-CN", label: "简体中文" }, { code: "ja", label: "日本語" }],
  },
};
const description = {
  fields: [names],
  values: { names: { en: "Orders", "zh-CN": "订单" } },
  errors: [{ field: "/names/en", code: "already_exists", message: "Another application is named Orders" }],
  revision: 1,
  save: { method: "PUT", path: "/applications/:id", bodySchema: {}, draftOperation: "application.save" },
};
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

afterEach(() => {
  document.body.innerHTML = "";
});

it("edits a text in the languages the owner keeps: the reader's first, the rest on demand, as the owner stores it", async () => {
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "applications", url: () => "/applications", label: () => "Applications", initial: { app },
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => (request.operations ? ready({}) : ready(description)),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "form" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const field = await vi.waitFor(() => {
    const found = element.querySelector<HTMLElement>('[data-field="/names"]');
    if (!found?.querySelector("input")) throw new Error("The names are not drawn");
    return found;
  });
  const row = (code: string) => field.querySelector<HTMLElement>(`[data-locale="${code}"]`);
  const type = (code: string, text: string) => {
    const input = row(code)!.querySelector<HTMLInputElement>("input")!;
    input.value = text;
    input.dispatchEvent(new Event("input"));
  };
  const values = () => instance.forms.handle("form")!.values.value.names;

  // The reader's language first, then every language with a text; Japanese has none and waits to be added.
  expect([...field.querySelectorAll<HTMLElement>("[data-locale]")].map((element) => element.dataset.locale)).toEqual(["zh-CN", "en"]);
  expect(row("zh-CN")!.textContent).toContain("简体中文");
  expect(field.textContent).not.toContain(publicEn.platform.formControlUnavailable);
  // The owner's message about English stands on English.
  expect(row("en")!.textContent).toContain("Another application is named Orders");

  // Added, Japanese is a language like the others; cleared again, it is no longer in the value.
  field.querySelector<HTMLElement>(".sdk-form-locale-add .el-select__wrapper")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const option = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((item) => item.textContent?.trim() === "日本語");
    if (!found) throw new Error("Japanese is not offered");
    return found;
  });
  option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await vi.waitFor(() => expect(row("ja")).not.toBeNull());
  type("ja", "注文");
  await nextTick();
  expect(values()).toEqual({ en: "Orders", "zh-CN": "订单", ja: "注文" });
  type("ja", "");
  await nextTick();
  expect(values()).toEqual({ en: "Orders", "zh-CN": "订单" });

  // A required language cleared is the empty text, which the owner refuses; it cannot be removed.
  type("en", "");
  await nextTick();
  expect(values()).toEqual({ en: "", "zh-CN": "订单" });
  expect(row("en")!.querySelector(".sdk-form-locale-remove")).toBeNull();
});

// An optional text the reader empties in every language is not given at all (as an optional choice cleared): the owner
// receives no value for it, never an empty object of languages (A-Java, 2026-11-22: an entry's description).
it("leaves an optional text out of the values once every language of it is emptied", async () => {
  const optional = { ...names, path: "/note", label: "Note", required: false, control: { ...names.control, requiredLocales: undefined } };
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "applications", url: () => "/applications", label: () => "Applications", initial: { app },
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => (request.operations ? ready({}) : ready({ ...description, fields: [optional], values: { note: { "zh-CN": "备注" } }, errors: [] })),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "form" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const input = await vi.waitFor(() => {
    const found = element.querySelector<HTMLInputElement>('[data-field="/note"] [data-locale="zh-CN"] input');
    if (!found) throw new Error("The note is not drawn");
    return found;
  });
  input.value = "";
  input.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(Object.hasOwn(instance.forms.handle("form")!.values.value, "note")).toBe(false));
});

// An optional text whose owner requires English once it is given (an entry's names and descriptions, A-Java 2026-11-22):
// while another language has a text, an emptied English stays the empty text for the owner to refuse; once no language
// has a text, the text is left out as a whole, never `{en: ""}`.
it("leaves out an optional text that requires a language once no language of it has a text", async () => {
  const optional = { ...names, path: "/note", label: "Note", required: false };
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "applications", url: () => "/applications", label: () => "Applications", initial: { app },
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => (request.operations ? ready({}) : ready({ ...description, fields: [optional], values: { note: { en: "Note", "zh-CN": "备注" } }, errors: [] })),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "form" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const input = (code: string) => element.querySelector<HTMLInputElement>(`[data-field="/note"] [data-locale="${code}"] input`);
  await vi.waitFor(() => expect(input("zh-CN")).not.toBeNull());
  const clear = (code: string) => {
    input(code)!.value = "";
    input(code)!.dispatchEvent(new Event("input"));
  };
  const values = () => instance.forms.handle("form")!.values.value;

  clear("en");
  await nextTick();
  expect(values().note).toEqual({ en: "", "zh-CN": "备注" });
  clear("zh-CN");
  await vi.waitFor(() => expect(Object.hasOwn(values(), "note")).toBe(false));
});
