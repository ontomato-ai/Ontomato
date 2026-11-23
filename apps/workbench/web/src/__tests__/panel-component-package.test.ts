import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ComponentPackageResponse } from "@ontomato/contracts/component-packages";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * A component a deployment installed from a third party's package (product-layer standard, component packages) is drawn
 * where a projection names it, as an official one is: its release's module, run against the platform's own Vue, with the
 * release's styles, and what it fetches relative to itself fetched from the release. Nothing approves it first.
 */

const name = "@example/testing";
const root = "/apps-sdk/component-packages/example-testing/1.0.0-abc/";
const release: ComponentPackageResponse = {
  name, version: "1.0.0", author: "Example", digest: "a".repeat(64), artifactRoot: root,
  components: [{
    componentId: `${name}:Example`, module: name, exportName: "Example", role: "presentation", meaning: "Test component",
    data: {}, ports: { props: [], events: [], slots: [] },
  }] as never,
  entries: { [name]: "dist/entry.mjs" },
  styles: ["dist/theme.css"],
};
const files: Record<string, string> = {
  [`${root}dist/entry.mjs`]: 'export { Example } from "./chunk.mjs";',
  [`${root}dist/chunk.mjs`]: [
    'import { h } from "vue";',
    'export const Example = { setup: () => () => h("p", { class: "package-example", "data-icon": new URL("./icon.svg", import.meta.url).href }, "From the package") };',
  ].join("\n"),
};

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projection: DirectProjection = {
  ...record, id: "package-example", name: "Example", componentId: `${name}:Example`,
  inputs: {}, outputs: {}, config: {}, data: {},
};
const manifest: DirectPanelManifest = { state: {}, members: { example: { target: { projectionId: projection.id } } } };

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.head.querySelectorAll("link[data-component-package]").forEach((link) => link.remove());
});

it("draws an installed package's component from its release, with the platform's Vue and the release's styles", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const path = new URL(String(input), location.origin).pathname;
    return files[path] === undefined ? new Response("missing", { status: 404 }) : new Response(files[path], { headers: { "content-type": "text/javascript" } });
  }));
  const readComponentPackage = vi.fn(async () => release);
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "example", url: () => "/example", label: () => "Example", initial: {},
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection, readComponentPackage,
    read: async () => ({ status: "ready", value: {} as never }),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "example" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).mount(element);

  const drawn = await vi.waitFor(() => {
    const found = element.querySelector<HTMLElement>(".package-example");
    if (!found) throw new Error("The package's component is not drawn");
    return found;
  }, { timeout: 5000 });
  expect(drawn.textContent).toBe("From the package");
  // What it names relative to itself is the release's, at the address the platform serves it.
  expect(drawn.dataset.icon).toBe(new URL(`${root}dist/icon.svg`, location.origin).href);
  expect([...document.head.querySelectorAll<HTMLLinkElement>("link[data-component-package]")].map((link) => link.getAttribute("href")))
    .toEqual([new URL(`${root}dist/theme.css`, location.origin).href]);
  expect(readComponentPackage).toHaveBeenCalledWith(name);
});

it("gives component packages @ontomato/sdk/ui with untouched primitive identity and rejects direct element-plus imports", async () => {
  const { packageComponent } = await import("../../../../../packages/apps-sdk/src/panel/component-packages");
  const { ElButton } = await import("element-plus");
  const uiRoot = "/apps-sdk/component-packages/example-ui/1.0.0-def/";
  const uiRelease: ComponentPackageResponse = {
    name: "@example/ui-pkg", version: "1.0.0", author: "Example", digest: "b".repeat(64), artifactRoot: uiRoot,
    components: [
      { componentId: "@example/ui-pkg:SdkBtn", module: "@example/ui-pkg/good", exportName: "SdkBtn", role: "presentation", meaning: "Good", data: {}, ports: { props: [], events: [], slots: [] } },
      { componentId: "@example/ui-pkg:LegacyBtn", module: "@example/ui-pkg/bad", exportName: "LegacyBtn", role: "presentation", meaning: "Bad", data: {}, ports: { props: [], events: [], slots: [] } },
    ] as never,
    entries: { "@example/ui-pkg/good": "dist/good.mjs", "@example/ui-pkg/bad": "dist/bad.mjs" },
    styles: [],
  };
  const pkgFiles: Record<string, string> = {
    [`${uiRoot}dist/good.mjs`]: 'import { SdkButton, vSdkLoading } from "@ontomato/sdk/ui"; export const SdkBtn = { button: SdkButton, loading: vSdkLoading };',
    [`${uiRoot}dist/bad.mjs`]: 'import { ElButton } from "element-plus"; export const LegacyBtn = ElButton;',
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const path = new URL(String(input), location.origin).pathname;
    return pkgFiles[path] === undefined ? new Response("missing", { status: 404 }) : new Response(pkgFiles[path], { headers: { "content-type": "text/javascript" } });
  }));

  const loaded = await packageComponent("@example/ui-pkg:SdkBtn", async () => uiRelease) as unknown as { button: typeof ElButton; loading: unknown };
  expect(loaded.button).toBe(ElButton);
  expect(loaded.button.name).toBe("ElButton");
  expect(loaded.loading).toBeTruthy();

  await expect(packageComponent("@example/ui-pkg:LegacyBtn", async () => uiRelease))
    .rejects.toThrow(/imports 'element-plus'/u);
});
