import { afterEach, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { SCHEDULED_TASK } from "@ontomato/contracts/platform-object-types";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import { noOperations, directRun } from "./panel-frame";

/*
 * A theme given where a panel places a projection (product-layer standard, theme: default → deployment → application →
 * panel → this placement) is the last word inside that placement: its values for the design variables are set on the
 * member's place, in the reader's mode, so the component drawn there and the pop-ups it opens take them, and nothing
 * outside the placement does.
 */

const base = { domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "", revision: 1 };
const summary: DirectProjection = {
  ...base, id: "task-summary", name: "Task", componentId: "@ontomato/sdk:ObjectSummary",
  inputs: { task: { kind: "object", objectType: SCHEDULED_TASK } }, outputs: {}, config: {},
  data: { record: { source: { object: { input: "task" } }, read: "record", params: {} } },
};
const manifest: DirectPanelManifest = {
  state: {},
  members: {
    themed: { target: { projectionId: summary.id }, theme: { light: { "--sdk-color-primary": "#0a7d4f" }, dark: { "--sdk-color-primary": "#5fd39b" } } },
    plain: { target: { projectionId: summary.id } },
  },
  commands: {},
};

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
});

it("sets a placement's theme on the member's place, in the reader's mode, and on no other member", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element,
    template: `<projection slot="themed"></projection><projection slot="plain"></projection>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: directRun({
      pageKey: "tasks", url: () => "/tasks", label: () => "Tasks", initial: {},
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({ projection: summary }) },
    use: { applicationId: "app-tasks", useId: "tasks" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (): Promise<ProductPanelReadResponse> => ({ status: "awaiting" as never, value: undefined as never }),
  });
  await module.mountPanel({});
  await mount;
  const place = (member: string) => element.querySelector<HTMLElement>(`[data-member="${member}"]`)!;
  await vi.waitFor(() => expect(place("themed").style.getPropertyValue("--sdk-color-primary")).toBe("#0a7d4f"));
  expect(place("themed").style.getPropertyValue("--el-color-primary")).toBe("#0a7d4f");
  expect(place("plain").style.getPropertyValue("--sdk-color-primary")).toBe("");
  expect(place("plain").style.getPropertyValue("--el-color-primary")).toBe("");

  document.documentElement.classList.add("dark");
  await vi.waitFor(() => expect(place("themed").style.getPropertyValue("--sdk-color-primary")).toBe("#5fd39b"));
  expect(place("themed").style.getPropertyValue("--el-color-primary")).toBe("#5fd39b");
});
