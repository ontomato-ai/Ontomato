import { afterEach, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import { noOperations } from "./panel-frame";

/*
 * An application's icon in a panel (2026-11-21 acceptance L-01): a panel names an application by its icon key, as the
 * catalogue stores it, and draws the platform's own icon for it from its SDK module — the same one the platform's
 * navigation draws, an unknown key the platform's fallback — never the key as text and never a copy of the platform's map.
 */

const manifest: DirectPanelManifest = { state: {}, members: {}, commands: {} };

afterEach(() => {
  document.body.innerHTML = "";
});

it("draws the platform's application icon for a key from the panel's own module", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element,
    template: `<p><component v-for="key in keys" :key="key" :is="appIcon(key)" :data-icon="key" :size="16"></component></p>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: {
      pageKey: "apps", url: () => "/apps", label: () => "Apps", initial: {},
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async () => Response.json({}) },
    use: { applicationId: "app-apps", useId: "apps" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async () => ({ status: "ready", value: {} as never }),
  });
  await module.mountPanel({ setup: () => ({ keys: ["agents", "ontology", "no-such-app"], appIcon: module.appIcon }) });
  await mount;
  const icon = (key: string) => element.querySelector(`[data-icon="${key}"]`);
  await vi.waitFor(() => expect(icon("agents")?.tagName.toLowerCase()).toBe("svg"));
  expect(icon("agents")!.classList.contains("lucide-sparkles-icon") || icon("agents")!.classList.contains("lucide-sparkles")).toBe(true);
  expect(icon("ontology")!.classList.contains("lucide-waypoints-icon") || icon("ontology")!.classList.contains("lucide-waypoints")).toBe(true);
  expect(icon("no-such-app")!.classList.contains("lucide-circle-icon") || icon("no-such-app")!.classList.contains("lucide-circle")).toBe(true);
  expect(element.textContent).not.toContain("agents");
});
