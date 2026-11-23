import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { AGENT_DEFINITION, SKILL } from "@ontomato/contracts/platform-object-types";
import { lightAvatarColorOptions } from "../../../../../packages/agent-shell-ui/src/avatar";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * Every control an owner's form names is drawn, or says it cannot be edited here (the agent settings page, redone
 * 2026-11-21): an avatar is chosen as the platform's avatars are — one of its icons on one of its swatches, stored as the
 * owner stores it — and a reference that no member of the panel draws is named with that note, never silently left out.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const agent = { className: AGENT_DEFINITION, primaryKey: "a-1" };
const projection: DirectProjection = {
  ...record, id: "agent-form", name: "Agent", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { agent: { kind: "object", objectType: AGENT_DEFINITION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "agent" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
};
const manifest: DirectPanelManifest = {
  state: { agent: { type: { kind: "object", objectType: AGENT_DEFINITION }, personal: false, deepLink: true, external: false } },
  members: { form: { target: { projectionId: projection.id }, inputs: { agent: { state: "agent" } } } },
};
const field = (path: string, label: string, control: Record<string, unknown>) => ({ path, label, control, valueSchema: {}, required: false, readOnly: false });
const description = {
  fields: [field("/name", "Name", { kind: "text" }), field("/icon", "Avatar", { kind: "avatar" }), field("/skills", "Skills", { kind: "reference", objectType: SKILL, multiple: true })],
  values: { name: "Analyst", icon: null, skills: [] }, errors: [], revision: 1,
  save: { method: "PUT", path: "/agents/:id", bodySchema: {}, draftOperation: "agent.save" },
};
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

afterEach(() => {
  document.body.innerHTML = "";
});

it("chooses an avatar's icon and swatch as the owner stores it, and names a reference nothing here draws", async () => {
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "agents", url: () => "/agents", label: () => "Agents", initial: { agent },
    text: createPanelText({}, ref("en"), "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => (request.operations ? ready({}) : ready(description)),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h(PanelMember, { instance, member: "form" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const avatar = await vi.waitFor(() => {
    const found = element.querySelector('[data-field="/icon"]');
    if (!found) throw new Error("The avatar is not drawn");
    return found;
  });
  avatar.querySelector<HTMLButtonElement>('button[aria-label="Sparkles"]')!.click();
  await nextTick();
  avatar.querySelector<HTMLButtonElement>(`button[aria-label="${publicEn.platform.formAvatarColorOption.replace("{index}", "3")}"]`)!.click();
  await nextTick();
  const form = instance.forms.handle("form")!;
  expect(JSON.parse(form.values.value.icon as string)).toEqual({ key: "Sparkles", color: lightAvatarColorOptions[2] });
  expect(avatar.querySelector('button[aria-label="Sparkles"]')?.getAttribute("aria-pressed")).toBe("true");

  // No member of this panel draws the skills: the form names the field and says it cannot be edited here.
  expect(element.querySelector('[data-field="/skills"]')?.textContent).toContain(publicEn.platform.formControlUnavailable);
});
