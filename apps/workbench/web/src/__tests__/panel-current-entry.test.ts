import { afterEach, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { ApplicationEntryMenu, CurrentApplicationEntry } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { DirectPanelRun } from "@ontomato/platform-shell";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import { noOperations } from "./panel-frame";

/*
 * An application's own frame (product-layer standard, the frame): the frame panel declares where the entry the reader
 * opened goes, a member whose target is the platform's current entry, and draws it with the official CurrentEntry. What
 * is drawn there is the content the host already admitted and runs — placed, never started again, with nothing the frame
 * could swap — and the frame reads which entry that is, and the menu the same answer gave, to mark it. Outside a frame
 * the place says so.
 */

const frame = (template: string): DirectPanelManifest => ({
  state: {},
  members: { content: { target: { fromPlatform: "currentEntry", candidates: { rule: "applicationEntry" } } } },
  commands: {},
});
const entry: CurrentApplicationEntry = { applicationId: "app-school", useId: "orders", pageKey: "orders", panelId: "panel-orders", path: "/applications/app-school/orders" };
const menu = { groups: [], entries: [] } as unknown as ApplicationEntryMenu;

afterEach(() => {
  document.body.innerHTML = "";
});

async function run(template: string, currentEntry?: DirectPanelRun["currentEntry"]) {
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const failed = vi.fn();
  const module = panelModuleFor({
    mounted, element, template,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest: frame(template),
    run: {
      pageKey: "frame", url: () => "/applications/app-school/orders", label: () => "School", initial: {},
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {}, draftRefused: () => {}, draftOpened: () => {}, failed,
      ...(currentEntry ? { currentEntry } : {}),
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({}) },
    use: { applicationId: "app-school", useId: "frame" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (): Promise<ProductPanelReadResponse> => ({ status: "ready", value: {} as never }),
  });
  return { element, module, mount, failed };
}

it("places the content the host admitted where the frame draws CurrentEntry, and tells the frame which entry it is", async () => {
  const content = document.createElement("section");
  content.className = "admitted-content";
  const dispose = vi.fn();
  const place = vi.fn((into: HTMLElement) => { into.append(content); return { dispose }; });
  const shown = ref(entry);
  const { element, module, mount } = await run(
    `<nav class="frame-menu">{{ current?.pageKey }} · {{ entries }}</nav><current-entry member="content"></current-entry>`,
    { entry: shown, menu: ref(menu), place },
  );
  await module.mountPanel({
    setup() {
      const panel = module.usePanelContext();
      return { current: panel.currentEntry, entries: computed(() => (panel.entryMenu.value ? "menu" : "none")) };
    },
  });
  await mount;
  await vi.waitFor(() => expect(element.querySelector(".admitted-content")).not.toBeNull());
  // The host's own instance, placed once in the member's place: no second content was started.
  expect(place).toHaveBeenCalledTimes(1);
  expect(element.querySelector('[data-member="content"] .admitted-content')).toBe(content);
  expect(element.querySelector(".frame-menu")?.textContent).toBe("orders · menu");
  // Another entry of the same application: the frame stays, and reads the new one.
  shown.value = { ...entry, useId: "students", pageKey: "students", path: "/applications/app-school/students" };
  await vi.waitFor(() => expect(element.querySelector(".frame-menu")?.textContent).toBe("students · menu"));
  expect(place).toHaveBeenCalledTimes(1);
});

it("says where the content would go when the panel does not run as an application's frame", async () => {
  const { element, module, mount } = await run(`<current-entry member="content"></current-entry>`);
  await module.mountPanel({});
  await mount;
  await vi.waitFor(() => expect(element.textContent).toContain(publicEn.platform.currentEntryOutsideFrame));
});

it("refuses, in its place, a member that is not the platform's current entry, naming it", async () => {
  const { element, module, mount } = await run(`<current-entry member="elsewhere"></current-entry>`, { entry: ref(entry), menu: ref(menu), place: () => ({ dispose() {} }) });
  await module.mountPanel({});
  await mount;
  await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent).toContain("'elsewhere'"));
});
