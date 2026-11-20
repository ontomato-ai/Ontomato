import { afterEach, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * The conversation entry of a member drawn in the platform's own document (big main's ruling, 2026-11-20): the button
 * opens the page's composer with the agent and opening sentence the member's projection declares, as it does in a panel's
 * frame, and sends nothing. The projection is the platform's own read here, so its declared entry goes as it is.
 *
 * What this rules out: a conversation entry that throws in a directly rendered panel (it did, as frame-only); one that
 * opens the composer with anything but the declaration, or opens it more than once.
 */

const governance: PanelConversationEntry = {
  target: { kind: "id", id: "agent-knowledge-governance" },
  prefill: "Check this knowledge item",
};
const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const projection: ProductProjection = {
  ...record, id: "knowledge-governance", name: "Knowledge governance", componentId: "@ontomato/sdk:ConversationEntry",
  inputs: {}, outputs: {}, config: {}, data: {}, conversationEntry: governance,
};

afterEach(() => {
  document.body.innerHTML = "";
});

it("opens the page's composer with the member's declared agent and sentence, once, sending nothing", async () => {
  const expanded: PanelConversationEntry[] = [];
  const instance = createDirectPanelInstance(definePanel({
    state: {}, members: { governance: { target: { projectionId: projection.id } } }, events: {},
  }), {
    pageKey: "knowledge", url: () => "/knowledge", label: () => "Knowledge", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    expandPageComposer: (entry) => { expanded.push(entry); },
    readProjection: async () => projection,
    read: async () => { throw new Error("A conversation entry reads nothing"); },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h(PanelMember, { instance, member: "governance" }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  const button = await vi.waitFor(() => {
    const found = element.querySelector<HTMLButtonElement>("button");
    if (!found) throw new Error("The entry is not drawn yet");
    return found;
  });
  button.click();
  await vi.waitFor(() => expect(expanded).toEqual([governance]));
  expect(element.querySelector("[role=alert]")).toBeNull();
  app.unmount();
});
