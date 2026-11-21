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
/** Each skill's package, by the skill's key. */
const packages: Record<string, string[]> = { "sk-1": ["SKILL.md", "references/a.md", "references/b.md"], "sk-2": ["scripts/client.mjs", "SKILL.md"] };

function mount(config: Record<string, RuntimeJsonValue>, initial: Record<string, RuntimeJsonValue> = {}) {
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(definePanel({
    state: { skill: { type: { kind: "object", objectType: SKILL } }, file: { type: { kind: "scalar", type: "string" } } },
    members: { tree: { target: { projectionId: tree.id }, inputs: { skill: { state: "skill" } }, outputs: { selected: { state: "file" } } } },
    commands: {},
  }), {
    pageKey: "p", url: () => "/p", label: () => "P", initial: { skill, ...initial },
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => ({ ...tree, config }),
    read: async (request) => {
      reads.push(request);
      return request.operations ? { status: "ready", value: {} as never }
        : { status: "ready", value: packages[(request.inputs.skill as { primaryKey: string }).primaryKey]!.map(file) as never };
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

it("falls to the new package's first file when another skill is chosen and its package lacks the file selected", async () => {
  const { instance } = mount({ fallbackToFirst: true }, { file: "references/a.md" });
  await vi.waitFor(() => expect(instance.state.values.value.file).toBe("references/a.md"));
  instance.state.set("skill", { className: SKILL, primaryKey: "sk-2" });
  // The first in tree order, folders first.
  await vi.waitFor(() => expect(instance.state.values.value.file).toBe("scripts/client.mjs"));
});

it("keeps the file selected when the new package has it too, and clears it when there is nothing to fall to", async () => {
  const kept = mount({ fallbackToFirst: true }, { file: "SKILL.md" });
  await vi.waitFor(() => expect(kept.reads.filter((read) => read.dataName)).toHaveLength(1));
  kept.instance.state.set("skill", { className: SKILL, primaryKey: "sk-2" });
  await vi.waitFor(() => expect(kept.reads.filter((read) => read.dataName)).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(kept.instance.state.values.value.file).toBe("SKILL.md");

  const cleared = mount({}, { file: "references/a.md" });
  await vi.waitFor(() => expect(cleared.reads.filter((read) => read.dataName)).toHaveLength(1));
  cleared.instance.state.set("skill", { className: SKILL, primaryKey: "sk-2" });
  await vi.waitFor(() => expect(cleared.instance.state.values.value.file).toBeNull());
});
