import { afterEach, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * A new object's form for a reader who may not create (the line's main control, 2026-11-21): with nothing chosen the
 * form is a new object's, and the owner's create form is read as the reader; the owner refuses it, and the form says so
 * where it would have been — never an empty form to fill in only to be refused when it is saved.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const creating: DirectProjection = {
  ...record, id: "agent-create", name: "New agent", componentId: "@ontomato/sdk:ObjectForm",
  inputs: {}, outputs: {}, config: {},
  data: { createForm: { source: { type: { kind: "PlatformObjectType", id: AGENT_DEFINITION } }, read: "createForm", params: {} } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` } } },
};

afterEach(() => {
  document.body.innerHTML = "";
});

it("shows the owner's refusal of the create form instead of an empty form", async () => {
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(definePanel({
    state: {}, members: { form: { target: { projectionId: creating.id } } }, commands: {},
  }), {
    pageKey: "agents", url: () => "/agents", label: () => "Agents", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => creating,
    read: async (request) => {
      reads.push(request);
      // The owner admits no save to this reader, and refuses them its create form.
      return request.operations ? { status: "ready", value: {} as never } : { status: "forbidden" };
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h(PanelMember, { instance, member: "form" }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);

  await vi.waitFor(() => expect(element.textContent).toContain(publicEn.platform.dataForbidden));
  expect(reads.filter((read) => read.dataName)).toEqual([{ memberPath: [{ member: "form" }], dataName: "createForm", inputs: {} }]);
  // Nothing to fill in: no field and no save is drawn.
  expect(element.querySelector("[data-field]")).toBeNull();
  expect(element.querySelector(".sdk-owner-form-actions")).toBeNull();
  app.unmount();
});
