import { afterEach, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { SKILL } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * A skill package's files as a tree in a panel the platform runs (the line's main control, 2026-11-21): the owner's
 * `files` read, one record per file keyed by its path; a click selects the file, writing its key to the panel state the
 * placement binds, for another member to read the file by. Nothing is read through the old frame's resource modules.
 */

const base = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const skill = { className: SKILL, primaryKey: "sk-1" };
const tree: DirectProjection = {
  ...base, id: "files", name: "Files", componentId: "@ontomato/sdk:ObjectTree",
  inputs: { skill: { kind: "object", objectType: SKILL } }, outputs: { selected: { kind: "scalar", type: "string" } }, config: {},
  data: { files: { source: { object: { input: "skill" } }, read: "files", params: {} } },
};
const file = (path: string) => ({ primaryKey: path, label: path, fields: { size: "12" } });

function mount(config: Record<string, RuntimeJsonValue>) {
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(definePanel({
    state: { file: { type: { kind: "scalar", type: "string" } } },
    members: { tree: { target: { projectionId: tree.id }, inputs: { skill: { literal: skill } }, outputs: { selected: { state: "file" } } } },
    events: {},
  }), {
    pageKey: "p", url: () => "/p", label: () => "P", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => ({ ...tree, config }),
    read: async (request) => {
      reads.push(request);
      return request.operations ? { status: "ready", value: {} as never }
        : { status: "ready", value: [file("SKILL.md"), file("references/a.md"), file("references/b.md")] as never };
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h(PanelMember, { instance, member: "tree" }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { instance, element, reads };
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("draws the owner's files as a tree and selects the file clicked into the panel's state", async () => {
  const { instance, element, reads } = mount({});
  const leaf = await vi.waitFor(() => {
    const found = element.querySelector<HTMLElement>("[role='treeitem'][data-path='references/a.md'] > button");
    if (!found) throw new Error(`The tree is not drawn yet: ${element.innerHTML}`);
    return found;
  });
  expect(reads.filter((read) => read.dataName)).toEqual([{ memberPath: [{ member: "tree" }], dataName: "files", inputs: { skill } }]);
  expect(instance.state.values.value.file).toBeNull();
  leaf.click();
  await vi.waitFor(() => expect(instance.state.values.value.file).toBe("references/a.md"));
});

it("selects the first file in tree order when asked to and nothing is selected", async () => {
  const { instance } = mount({ fallbackToFirst: true });
  await vi.waitFor(() => expect(instance.state.values.value.file).not.toBeNull());
  expect(["SKILL.md", "references/a.md"]).toContain(instance.state.values.value.file);
});
