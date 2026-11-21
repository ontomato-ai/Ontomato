import { afterEach, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { BUSINESS_KNOWLEDGE } from "@ontomato/contracts/platform-object-types";
import type { DirectPanelMount } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { panelModuleFor } from "../../../../../packages/apps-sdk/src/panel/direct-run";
import { noOperations } from "./panel-frame";

/*
 * What a panel's template places in a member's slots reaches the member's component (M7's business knowledge page,
 * 2026-11-21): the batch buttons go in the list's `batch-actions`, beside what is checked, as other members'
 * `<projection>`s; they were dropped, and the page moved them to its header.
 */

const meta = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const item = (primaryKey: string) => ({ className: BUSINESS_KNOWLEDGE, primaryKey });
const projections: Record<string, DirectProjection> = {
  list: {
    ...meta, id: "list", name: "Knowledge", componentId: "@ontomato/sdk:ObjectList", inputs: {},
    outputs: { checked: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } }, config: {},
    data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
  },
  ask: {
    ...meta, id: "ask", name: "Ask about these", componentId: "@ontomato/sdk:ConversationEntry", inputs: {}, outputs: {}, config: {}, data: {},
    conversationEntry: { target: { kind: "page-default" } },
  },
};
const manifest: DirectPanelManifest = {
  state: { checked: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } }, personal: false, deepLink: false, external: false } },
  members: {
    list: { target: { projectionId: "list" }, outputs: { checked: { state: "checked" } } },
    ask: { target: { projectionId: "ask" } },
  },
  commands: {},
};

afterEach(() => {
  document.body.innerHTML = "";
});

it("draws another member placed in a member's slot, where the component puts that slot", async () => {
  const element = document.createElement("div");
  document.body.append(element);
  let mounted!: (mount: DirectPanelMount) => void;
  const mount = new Promise<DirectPanelMount>((resolve) => { mounted = resolve; });
  const module = panelModuleFor({
    mounted, element,
    template: `<projection slot="list"><template #batch-actions="{ checked }"><span class="checked">{{ checked.length }}</span><projection slot="ask"></projection></template></projection>`,
    install: (app) => { app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })); },
    manifest,
    run: {
      pageKey: "knowledge", url: () => "/knowledge", label: () => "Knowledge", initial: { checked: [item("k-1")] } as never,
      state: () => {}, context: () => {}, operations: () => {}, dirty: () => {}, draftSettled: () => {}, draftRefused: () => {}, draftOpened: () => {},
      failed: (reason) => { throw reason; },
    },
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string) => Response.json({ projection: projections[path.split("/").at(-1)!] }) },
    use: { applicationId: "app-knowledge", useId: "knowledge" },
    expandPageComposer: noOperations.expandPageComposer, confirmOperation: noOperations.confirmOperation,
    navigate: noOperations.navigate, nested: noOperations.nested,
    read: async (request): Promise<ProductPanelReadResponse> => ({ status: "ready", value: (request.operations ? {} : {
      rows: [{ primaryKey: "k-1", label: "Refund policy", fields: {} }, { primaryKey: "k-2", label: "Return window", fields: {} }],
    }) as never }),
  });
  await module.mountPanel({ setup: () => ({}) });
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-batch-actions .checked")?.textContent).toBe("1"));
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-list-batch-actions [data-member='ask'] button")?.textContent?.trim()).toBe("Ask about these"));
  (await mount).dispose();
});
