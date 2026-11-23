import { afterEach, expect, it, vi } from "vitest";
import { createApp, ref } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { AGENT_DEFINITION, MODEL_OPTION } from "@ontomato/contracts/panel-client-requests";
import { mountDirectPanel } from "../../../../../packages/apps-sdk/src/panel/direct-mount";
import { directRun, noOperations } from "./panel-frame";

/*
 * A reference whose owner names its empty choice (an agent's model following the domain default, original agent
 * settings page, 2026-11-22): held empty, the field shows that choice by its name — not an empty box a reader cannot read
 * — and choosing it again writes the owner's empty value.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const form: DirectProjection = {
  ...record, id: "agent-form", name: "Agent", componentId: "@ontomato/sdk:ObjectForm",
  inputs: { agent: { kind: "object", objectType: AGENT_DEFINITION }, values: { kind: "json" }, changedField: { kind: "scalar", type: "string" } },
  outputs: {}, config: {},
  data: { form: { source: { object: { input: "agent" } }, read: "form", params: { values: { input: "values" }, changedField: { input: "changedField" } } } },
  operations: { save: { operation: { kind: "PlatformOperation", id: `${AGENT_DEFINITION}.save` }, target: { input: "agent" } } },
};
const picker: DirectProjection = {
  ...record, id: "model-choice", name: "Model", componentId: "@ontomato/sdk:ReferencePicker",
  inputs: {}, outputs: {}, config: {},
  data: {
    options: { source: { type: { kind: "PlatformObjectType", id: MODEL_OPTION } }, read: "options", params: {} },
    selected: { source: { type: { kind: "PlatformObjectType", id: MODEL_OPTION } }, read: "resolve", params: {} },
  },
  operations: {},
};
const manifest: DirectPanelManifest = {
  state: { agent: { type: { kind: "object", objectType: AGENT_DEFINITION }, personal: false, deepLink: true, external: false } },
  members: {
    form: { target: { projectionId: form.id }, inputs: { agent: { state: "agent" } } },
    model: { target: { projectionId: picker.id }, inputs: {}, formField: { slot: "form", path: "/model" } },
  },
};
const following = { primaryKey: "@default", value: null, label: "Domain default (GPT)" };
const gpt = { primaryKey: "openai/gpt", value: "openai/gpt", label: "GPT" };
const fields = [{ path: "/model", label: "Model", required: false, readOnly: false, valueSchema: {}, control: { kind: "reference", objectType: MODEL_OPTION, multiple: false } }];
const save = { kind: "form.save", handlerRef: `${AGENT_DEFINITION}.save`, label: "Save", effect: "write", target: { source: "input", input: "agent" }, inputSchema: {}, resultSchema: {}, batch: false };

afterEach(() => {
  document.body.innerHTML = "";
});

function open(options: unknown[], held: unknown[]) {
  const mount = mountDirectPanel({
    manifest,
    run: directRun({ pageKey: "agents", url: () => "/agents", label: () => "Agents", initial: { agent: { className: AGENT_DEFINITION, primaryKey: "a-1" } } }),
    messages: {}, locale: ref("en"), defaultLocale: "en",
    requests: { request: async (path: string) => Response.json({ projection: path.includes(picker.id) ? picker : form }) },
    use: { applicationId: "app", useId: "agents" },
    expandPageComposer: noOperations.expandPageComposer, navigate: noOperations.navigate, nested: noOperations.nested,
    confirmOperation: noOperations.confirmOperation,
    read: async (request): Promise<ProductPanelReadResponse> => {
      if ("operations" in request) return { status: "ready", value: { save } as never };
      if (request.dataName === "options") return { status: "ready", value: { options } as never };
      if (request.dataName === "selected") return { status: "ready", value: { options: held } as never };
      return { status: "ready", value: { fields, values: { model: null }, errors: [], revision: 1, save: { method: "PUT", path: "/agents/:id", bodySchema: {}, draftOperation: "agent.update" } } as never };
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => [mount.member("form"), mount.member("model")] });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { mount, app, element };
}

it("shows a held empty reference as the owner's named empty choice", async () => {
  const { mount, app, element } = open([following, gpt], [following]);
  await vi.waitFor(() => expect(element.querySelector('[data-field="/model"] .el-select__selected-item:not(.is-hidden)')?.textContent?.trim()).toBe(following.label));
  app.unmount();
  mount.dispose();
});

// Choices an owner describes are offered with what each does (a skill, 原页面对照《智能体设置》 #22): a reader judges
// a choice by its description, not by its name alone.
it("offers each choice with the description its owner gives", async () => {
  const sql = { primaryKey: "sql", value: "sql", label: "SQL", description: "Queries the ontology's tables" };
  const { mount, app, element } = open([following, sql], [following]);
  await vi.waitFor(() => expect(element.querySelector('[data-field="/model"] .el-select__wrapper')).not.toBeNull());
  element.querySelector<HTMLElement>('[data-field="/model"] .el-select__wrapper')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const item = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".el-select-dropdown__item")].find((option) => option.textContent?.includes("SQL"));
    if (!found) throw new Error("SQL is not offered");
    return found;
  });
  expect(item.querySelector(".sdk-reference-option-label")?.textContent?.trim()).toBe("SQL");
  expect(item.querySelector(".sdk-reference-option-description")?.textContent?.trim()).toBe("Queries the ontology's tables");
  app.unmount();
  mount.dispose();
});
