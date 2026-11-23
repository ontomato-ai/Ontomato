import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick, ref } from "vue";
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
 * Fields an owner marks `advanced` (A's contract, 2026-11-22: an application entry's inputs): at each level — the form,
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

function open(errors: { field: string; code: string; message: string }[]) {
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
      : { status: "ready", value: { fields, values: { name: "Orders", slug: "orders", entries: [{ title: "Home", inputs: "{}" }] }, errors, revision: 1,
        save: { method: "PUT", path: "/apps/:id", bodySchema: {}, draftOperation: "app.update" } } as never },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("form") });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { mount, app, element };
}

const shown = (element: HTMLElement, path: string) => {
  const item = element.querySelector<HTMLElement>(`[data-field="${path}"]`);
  return item !== null && !item.closest<HTMLElement>("[data-advanced-body]")?.style.display.includes("none");
};

it("draws marked fields after the others in a closed section at each level, which the reader opens", async () => {
  const { mount, app, element } = open([]);
  await vi.waitFor(() => expect(element.querySelector('[data-field="/name"]')).not.toBeNull());
  expect(shown(element, "/name")).toBe(true);
  expect(shown(element, "/slug")).toBe(false);
  expect(shown(element, "/entries/0/title")).toBe(true);
  expect(shown(element, "/entries/0/inputs")).toBe(false);
  // After the plain fields of its level.
  const top = [...element.querySelectorAll<HTMLElement>(".sdk-owner-form > * [data-field]")].map((item) => item.dataset.field);
  expect(top.indexOf("/slug")).toBeGreaterThan(top.indexOf("/entries"));
  for (const toggle of element.querySelectorAll<HTMLButtonElement>("[data-advanced-toggle]")) toggle.click();
  await nextTick();
  expect(shown(element, "/slug")).toBe(true);
  expect(shown(element, "/entries/0/inputs")).toBe(true);
  app.unmount();
  mount.dispose();
});

it("opens the section of a marked field the owner refuses, so its message shows", async () => {
  const { mount, app, element } = open([{ field: "/entries/0/inputs", code: "invalid_object", message: "Inputs must be an object" }]);
  await vi.waitFor(() => expect(element.querySelector('[data-field="/entries/0/inputs"]')).not.toBeNull());
  expect(shown(element, "/entries/0/inputs")).toBe(true);
  expect(shown(element, "/slug")).toBe(false);
  app.unmount();
  mount.dispose();
});
