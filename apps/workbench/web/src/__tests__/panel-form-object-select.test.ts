import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { FUNCTION as APPLICATION } from "@ontomato/contracts/platform-object-types";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { directRun, noOperations } from "./panel-frame";

/*
 * A choice whose values are objects (an application entry's default agent, A's contract 2026-11-22): the form shows the
 * declared option the value is — whatever order its keys come in — and writes that option's own value; a choice cleared
 * leaves the field out of the values, never null or an empty text.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projection: DirectProjection = {
  ...record, id: "entry-form", name: "Entry", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { entry: { kind: "object", objectType: APPLICATION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "entry" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${APPLICATION}.save` }, target: { input: "entry" } } },
};
const manifest: DirectPanelManifest = {
  state: { entry: { type: { kind: "object", objectType: APPLICATION }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { entry: { state: "entry" } } } },
  commands: {},
};
const option = (value: Record<string, string>, label: string) => ({ value, label, description: null, disabled: false, disabledReason: null });
const field = {
  path: "/defaultAgent", label: "Default agent", required: false, readOnly: false, valueSchema: { type: "object" },
  control: { kind: "select", options: [option({ kind: "preset", agentKind: "knowledge-governance" }, "Knowledge governance"), option({ kind: "id", id: "a-1" }, "Analyst")] },
};
const save = { kind: "form.save", handlerRef: `${APPLICATION}.save`, label: "Save", effect: "write", target: { source: "input", input: "entry" }, inputSchema: {}, resultSchema: {}, batch: false };

afterEach(() => {
  document.body.innerHTML = "";
});

it("shows the declared option an object value is, and leaves a cleared choice out of the values", async () => {
  const mount = mountDirectPanel({
    manifest,
    run: directRun({ pageKey: "entries", url: () => "/entries", label: () => "Entries", initial: { entry: { className: APPLICATION, primaryKey: "app-1" } } }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection }) },
    use: { applicationId: "app", useId: "entries" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => request.operations
      ? { status: "ready", value: { save } as never }
      // The owner answers the value with its keys in another order than the option declares them.
      : { status: "ready", value: { fields: [field], values: { defaultAgent: { agentKind: "knowledge-governance", kind: "preset" } }, errors: [], revision: 1,
        save: { method: "PUT", path: "/entries/:id", bodySchema: {}, draftOperation: "entry.update" } } as never },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => mount.member("form") });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const shown = () => element.querySelector('[data-field="/defaultAgent"] .el-select__selected-item:not(.is-hidden)')?.textContent?.trim();
  await vi.waitFor(() => expect(shown()).toBe("Knowledge governance"));

  const handle = mount.instance.forms.handle("form")!;
  // Cleared: the field is left out, not null and not "".
  const select = element.querySelector<HTMLElement>('[data-field="/defaultAgent"] .el-select__wrapper')!;
  select.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  await nextTick();
  element.querySelector<HTMLElement>('[data-field="/defaultAgent"] .el-select__clear')!.click();
  await nextTick();
  expect(Object.hasOwn(handle.values.value, "defaultAgent")).toBe(false);
  app.unmount();
  mount.dispose();
});
