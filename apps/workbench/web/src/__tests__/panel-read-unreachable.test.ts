import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, h, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { panelModuleFor, type DirectPanelMount } from "../../../../../packages/apps-sdk/src/direct";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations, directRun } from "./panel-frame";

/*
 * A read the platform never answered (the page reached nothing: the network dropped, the service was being replaced —
 * 2026-11-21 acceptance, a relation list showing "Failed to fetch") is said in the reader's language, with a way to read
 * again, in the SDK's lists and in a panel's own code alike; a reason the owner or the platform gave is still its own.
 */

const base = { domainId: "d", ownerId: "o", createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "", revision: 1 };
const relations: DirectProjection = {
  ...base, id: "relations", name: "Relations", componentId: "@ontomato/sdk:ObjectList",
  inputs: {}, outputs: {}, config: {},
  data: { rows: { source: { type: { kind: "PlatformObjectType", id: RELATIONSHIP } }, read: "list", params: {} } },
};
const relationData: DirectProjection = { ...relations, id: "relation-data", componentId: "@ontomato/sdk:PanelData" };
const manifest: DirectPanelManifest = {
  state: {},
  members: { list: { target: { projectionId: relations.id } }, data: { target: { projectionId: relationData.id } } },
};
const rows = [{ primaryKey: "holds", label: "Holds role", fields: {} }];
const unreachable = publicEn.platform.dataUnreachable;

afterEach(() => {
  document.body.innerHTML = "";
});

/** The host's read port: it fails to reach the platform until `reachable` is set, as a request does while 3000 restarts. */
function port() {
  const state = { reachable: false };
  const read = async (request: { operations?: true }): Promise<ProductPanelReadResponse> => {
    if (request.operations) return { status: "ready", value: {} as never };
    if (!state.reachable) throw new TypeError("Failed to fetch");
    return { status: "ready", value: rows as never };
  };
  return { state, read };
}

it("says in the reader's language that a list could not be read, and reads it again on request", async () => {
  const { state, read } = port();
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "relations", url: () => "/relations", label: () => "Relations", initial: {},
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async (id) => (id === relations.id ? relations : relationData), read,
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "list" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  await vi.waitFor(() => expect(element.textContent).toContain(unreachable));
  expect(element.textContent).not.toContain("Failed to fetch");
  const retry = [...element.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === publicEn.common.retry)!;
  state.reachable = true;
  retry.click();
  await vi.waitFor(() => expect(element.textContent).toContain("Holds role"));
});

it("hands a panel's own code the same words and a way to read again", async () => {
  const { state, read } = port();
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element,
    template: `<p class="shown">{{ shown }}</p><button class="again" @click="again">again</button>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: directRun({
      pageKey: "relations", url: () => "/relations", label: () => "Relations", initial: {},
      failed: (reason) => { throw reason; },
    }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string) => Response.json({ projection: path.endsWith(relations.id) ? relations : relationData }) },
    use: { applicationId: "app-relations", useId: "relations" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read,
  });
  await module.mountPanel({
    setup() {
      const data = module.usePanelData("data", "rows");
      return {
        shown: computed(() => (data.value.status === "error" ? data.value.message : data.value.status)),
        again: () => { if (data.value.status === "error") data.value.retry?.(); },
      };
    },
  });
  await mount;
  await vi.waitFor(() => expect(element.querySelector(".shown")?.textContent).toBe(unreachable));
  state.reachable = true;
  element.querySelector<HTMLButtonElement>(".again")!.click();
  await vi.waitFor(() => expect(element.querySelector(".shown")?.textContent).toBe("ready"));
});
