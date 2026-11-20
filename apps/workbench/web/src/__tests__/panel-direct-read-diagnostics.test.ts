import { afterEach, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { AGENT_DEFINITION, SKILL } from "@ontomato/contracts/panel-client-requests";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * What an owner says about a partial answer (the skill catalogue's stage two, 2026-11-21): a list read or a choice read
 * may carry `diagnostics`, plain text the owner localized — a skill source that did not answer, a manifest that could
 * not be read. The component shows them beside what did come back, as the owner wrote them, and still shows the rest.
 *
 * The mistakes these catch: diagnostics dropped, so a reader takes a partial catalogue for the whole one; a partial
 * answer drawn as a failure, hiding the skills that did come back; a held value's notice lost because only the
 * catalogue's read was looked at.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const skill = (name: string) => ({ namespace: { kind: "domain", domainId: "d" }, name });
const agent = { className: AGENT_DEFINITION, primaryKey: "a-1" };
const skillType = { type: { kind: "PlatformObjectType" as const, id: SKILL } };
const projections: Record<string, DirectProjection> = {
  "skill-list": {
    ...record, id: "skill-list", name: "Skills", componentId: "@ontomato/sdk:ObjectList", inputs: {}, outputs: {}, config: {},
    data: { rows: { source: skillType, read: "query", params: {} } },
  },
  "agent-form": {
    ...record, id: "agent-form", name: "Agent", componentId: "@ontomato/sdk:ObjectForm",
    inputs: { agent: { kind: "object", objectType: AGENT_DEFINITION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
    outputs: {}, config: {},
    data: { form: { source: { object: { input: "agent" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
  },
  "agent-skills": {
    ...record, id: "agent-skills", name: "Agent skills", componentId: "@ontomato/sdk:ReferencePicker",
    inputs: { values: { kind: "json" } }, outputs: {}, config: {},
    data: {
      options: { source: skillType, read: "options", params: {} },
      selected: { source: skillType, read: "resolve", params: { values: { input: "values" } } },
    },
  },
};
const manifest: DirectPanelManifest = {
  state: { agent: { type: { kind: "object", objectType: AGENT_DEFINITION }, personal: false, deepLink: true, external: false } },
  members: {
    list: { target: { projectionId: "skill-list" } },
    form: { target: { projectionId: "agent-form" }, inputs: { agent: { state: "agent" } } },
    skills: { target: { projectionId: "agent-skills" }, formField: { slot: "form", path: "/skills" } },
  },
  events: {},
};
const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });
const option = (name: string, more = {}) => ({ primaryKey: name, value: skill(name), label: name, ...more });
const agentForm = {
  fields: [{ path: "/skills", label: "Skills", control: { kind: "reference", objectType: SKILL, multiple: true }, valueSchema: {}, required: false, readOnly: false }],
  values: { skills: [skill("sql"), skill("vendor")] }, errors: [], revision: 1,
  save: { method: "PUT", path: "/agents/:id", bodySchema: {}, draftOperation: "agent.save" },
};

function answer(request: PanelMemberReadRequest): ProductPanelReadResponse {
  if (request.operations) return ready({});
  if (request.dataName === "rows") return ready({ rows: [{ primaryKey: "sql", label: "SQL", fields: {} }], diagnostics: ["The vendor skill source did not answer."] });
  if (request.dataName === "form") return ready(agentForm);
  if (request.dataName === "options") return ready({ options: [option("sql")], diagnostics: ["Some skills of the vendor source are not listed."] });
  if (request.dataName === "selected")
    return ready({ options: [option("sql"), option("vendor", { unavailable: { reason: "Its source did not answer" } })], diagnostics: ["A chosen skill could not be checked."] });
  throw new Error(`Nothing answers ${request.dataName}`);
}

function open(...members: string[]) {
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "p", url: () => "/p", label: () => "P", initial: { agent },
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async (id) => projections[id]!,
    read: async (request) => answer(request),
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h("div", members.map((member) => h(PanelMember, { instance, member })) ) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("shows a list's diagnostics beside the rows that did come back", async () => {
  const element = open("list");
  await vi.waitFor(() => expect(element.textContent).toContain("SQL"));
  expect(element.textContent).toContain("The vendor skill source did not answer.");
});

it("shows a choice's diagnostics, the catalogue's and the held values', beside the choices", async () => {
  const element = open("form", "skills");
  await vi.waitFor(() => expect(element.querySelector('[data-field="/skills"]')?.textContent).toContain("Some skills of the vendor source are not listed."));
  await vi.waitFor(() => expect(element.querySelector('[data-field="/skills"]')?.textContent).toContain("A chosen skill could not be checked."));
});
