import { afterEach, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { FUNCTION } from "@ontomato/contracts/platform-object-types";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { directRun, noOperations } from "./panel-frame";

/*
 * (Harness shared in shape with panel-form-advanced.) Fields an owner marks `advanced` (A's contract, 2026-11-22: an application entry's inputs): at each level — the form,
 * an object's fields, a row of a list — they are drawn after the others in one section that starts closed and that the
 * reader opens; one of them that the owner refuses opens it, so a message is never hidden.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projection: DirectProjection = {
  ...record, id: "app-form", name: "Application", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { app: { kind: "object", objectType: FUNCTION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "app" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${FUNCTION}.save` }, target: { input: "app" } } },
};
const manifest: DirectPanelManifest = {
  state: { app: { type: { kind: "object", objectType: FUNCTION }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { app: { state: "app" } } } },
};
const text = (path: string, label: string, advanced?: true) => ({
  path, label, required: false, readOnly: false, valueSchema: {}, control: { kind: "text" }, ...(advanced ? { advanced } : {}),
});
const fields = [
  text("/name", "Name"),
  text("/slug", "Slug", true),
  {
    path: "/entries", label: "Entries", required: false, readOnly: false, valueSchema: {},
    control: { kind: "object-array", itemFields: [text("/title", "Title"), text("/inputs", "Inputs", true)] },
  },
];
const save = { kind: "form.save", handlerRef: `${FUNCTION}.save`, label: "Save", effect: "write", target: { source: "input", input: "app" }, inputSchema: {}, resultSchema: {}, batch: false };

afterEach(() => {
  document.body.innerHTML = "";
});

function open(errors: { field: string; code: string; message: string }[], shape: { sections?: unknown[]; fields?: unknown[] } = {}) {
  const mount = mountDirectPanel({
    manifest,
    run: directRun({ pageKey: "apps", url: () => "/apps", label: () => "Apps", initial: { app: { className: FUNCTION, primaryKey: "a-1" } } }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection }) },
    use: { applicationId: "app", useId: "apps" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => request.operations
      ? { status: "ready", value: { save } as never }
      : { status: "ready", value: { fields: shape.fields ?? fields, ...(shape.sections ? { sections: shape.sections } : {}), values: { name: "Orders", slug: "orders", entries: [{ title: "Home", inputs: "{}" }] }, errors, revision: 1,
        save: { method: "PUT", path: "/apps/:id", bodySchema: {}, draftOperation: "app.update" } } as never },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("form") });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { mount, app, element };
}



// An owner may group its form into sections (原页面对照《智能体设置》: basics, model, prompt, capabilities, execution,
// data scope): each drawn with its title and its hint, in the owner's order, with a list of them beside the form that
// takes the reader to one; a form with no sections is drawn as one list of fields.
it("draws an owner's sections in order with their hints, and a list of them that takes the reader to one", async () => {
  const sections = [{ key: "basics", title: "Basics", hint: "What the item is called" }, { key: "rows", title: "Entries" }];
  const sectionedFields = [{ ...fields[0], section: "basics" }, { ...fields[1], section: "basics" }, { ...fields[2], section: "rows" }];
  const { mount, app, element } = open([], { sections, fields: sectionedFields });
  await vi.waitFor(() => expect(element.querySelector("[data-form-section]")).not.toBeNull());
  const drawn = [...element.querySelectorAll<HTMLElement>("[data-form-section]")].map((section) => ({
    key: section.dataset.formSection,
    title: section.querySelector("h3")?.textContent?.trim(),
    hint: section.querySelector(".sdk-owner-form-section-hint")?.textContent?.trim() ?? null,
    fields: [...section.querySelectorAll<HTMLElement>(":scope > * [data-field], :scope > [data-field]")].map((field) => field.dataset.field).filter((path) => !path!.includes("/0/")),
  }));
  expect(drawn).toEqual([
    { key: "basics", title: "Basics", hint: "What the item is called", fields: ["/name", "/slug"] },
    { key: "rows", title: "Entries", hint: null, fields: ["/entries"] },
  ]);
  const scrolled: string[] = [];
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) { scrolled.push(this.dataset.formSection ?? ""); };
  const links = [...element.querySelectorAll<HTMLButtonElement>(".sdk-owner-form-contents button")];
  expect(links.map((link) => link.textContent?.trim())).toEqual(["Basics", "Entries"]);
  links[1]!.click();
  expect(scrolled).toEqual(["rows"]);
  app.unmount();
  mount.dispose();
});

// Markdown the owner keeps (an agent's prompt) says how long it is as the reader writes it; the page keeps the count
// and drops the old preview (面板化线主控 2026-11-22).
it("counts a Markdown field's characters as the reader writes", async () => {
  const prompt = { path: "/name", label: "Prompt", required: false, readOnly: false, valueSchema: {}, control: { kind: "markdown" } };
  const { mount, app, element } = open([], { fields: [prompt] });
  const count = () => element.querySelector('[data-field="/name"] .sdk-form-field-count')?.textContent?.trim();
  await vi.waitFor(() => expect(count()).toBe("6 characters · Markdown"));
  const input = element.querySelector<HTMLTextAreaElement>('[data-field="/name"] textarea')!;
  input.value = "Orders and more";
  input.dispatchEvent(new Event("input"));
  await vi.waitFor(() => expect(count()).toBe("15 characters · Markdown"));
  app.unmount();
  mount.dispose();
});
