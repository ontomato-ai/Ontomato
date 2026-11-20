import { afterEach, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { KNOWLEDGE_GOVERNANCE_RECORD, SKILL } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

/*
 * An object's text read only in a panel the platform runs (the line's main control, 2026-11-21): a governance record's
 * sources read page by page through the owner's reads — chips from `sources`, the chosen source's text from `page`, the
 * next page by its cursor — and a skill file's whole text from `record`, its line breaks kept. Every read goes through
 * the platform's one read entry; the chosen source and the cursor are the reader's own run-time values.
 *
 * What this rules out: a reader that reads through the old frame's resource modules (it had none here, and drew
 * nothing); a page read without its source; "more" that reads the first page again instead of the next.
 */

const base = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const recordOf = (input: string) => ({ object: { input } });
const governed = { className: KNOWLEDGE_GOVERNANCE_RECORD, primaryKey: "g-1" };

function mount(projection: DirectProjection, inputs: Record<string, RuntimeJsonValue>, answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse) {
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(definePanel({
    state: {}, members: { reader: { target: { projectionId: projection.id }, inputs: Object.fromEntries(Object.entries(inputs).map(([name, literal]) => [name, { literal }])) } }, events: {},
  }), {
    pageKey: "p", url: () => "/p", label: () => "P", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => projection,
    read: async (request) => {
      reads.push(request);
      return request.operations ? { status: "ready", value: {} as never } : answer(request);
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  const app = createApp({ render: () => h(PanelMember, { instance, member: "reader" }) });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  return { element, reads: () => reads.filter((read) => read.dataName), unmount: () => app.unmount() };
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("reads a governance record's sources page by page through the owner's reads", async () => {
  const projection: DirectProjection = {
    ...base, id: "sources", name: "Sources", componentId: "@ontomato/sdk:ObjectTextReader",
    inputs: { record: { kind: "object", objectType: KNOWLEDGE_GOVERNANCE_RECORD } }, outputs: {}, config: {},
    data: {
      sources: { source: recordOf("record"), read: "sources", params: {} },
      page: { source: recordOf("record"), read: "sourcePage", params: {} },
    },
  };
  const { element, reads } = mount(projection, { record: governed }, (request) => {
    if (request.dataName === "sources")
      return { status: "ready", value: [{ primaryKey: "s-1", label: "Policy memo", fields: { kind: "Document", target: "memo", excerpt: "…" } }] as never };
    const cursor = request.runtimeParams?.cursor;
    return { status: "ready", value: {
      rows: [{ primaryKey: `s-1:${cursor ?? 0}`, label: "Policy memo", fields: { text: cursor ? "Second part." : "First part.", start: String(cursor ?? 0), end: "12", totalChars: "24" } }],
      ...(cursor ? {} : { nextCursor: "12" }),
    } as never };
  });
  const chip = await vi.waitFor(() => {
    const found = [...element.querySelectorAll<HTMLButtonElement>(".fui-segmented-reader-chip")].find((button) => button.textContent?.trim() === "Policy memo");
    if (!found) throw new Error("No chip yet");
    return found;
  });
  chip.click();
  await vi.waitFor(() => expect(element.querySelector(".fui-segmented-reader-segment")?.textContent).toBe("First part."));
  expect(reads().at(-1)).toMatchObject({ dataName: "page", inputs: { record: governed }, runtimeParams: { source: "s-1" } });

  element.querySelector<HTMLButtonElement>(".fui-segmented-reader-more")!.click();
  await vi.waitFor(() => expect(element.querySelector(".fui-segmented-reader-segment")?.textContent).toBe("Second part."));
  expect(reads().at(-1)).toMatchObject({ dataName: "page", runtimeParams: { source: "s-1", cursor: "12" } });
  expect(element.querySelector(".fui-segmented-reader-more")).toBeNull();
});

it("shows one object's whole text from its record, with its line breaks", async () => {
  const projection: DirectProjection = {
    ...base, id: "file", name: "File", componentId: "@ontomato/sdk:ObjectTextReader",
    inputs: { skill: { kind: "object", objectType: SKILL }, path: { kind: "scalar", type: "string" } }, outputs: {}, config: {},
    data: { record: { source: recordOf("skill"), read: "file", params: { path: { input: "path" } } } },
  };
  const { element, reads } = mount(projection, { skill: { className: SKILL, primaryKey: "sk-1" }, path: "SKILL.md" }, () =>
    ({ status: "ready", value: { primaryKey: "SKILL.md", label: "SKILL.md", fields: { content: "# Skill\nLine two" } } as never }));
  await vi.waitFor(() => expect(element.querySelector(".sdk-object-text-reader-whole")?.textContent).toBe("# Skill\nLine two"));
  expect(reads()).toEqual([expect.objectContaining({ dataName: "record", inputs: { skill: { className: SKILL, primaryKey: "sk-1" }, path: "SKILL.md" } })]);
});
