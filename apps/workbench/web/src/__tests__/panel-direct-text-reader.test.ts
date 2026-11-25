import { afterEach, expect, it, vi } from "vitest";
import { createApp, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { SKILL } from "@ontomato/contracts/platform-object-types";

vi.mock("@ontomato/contracts/panel-projection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ontomato/contracts/panel-projection")>();
  return {
    ...actual,
    directReadDeclaration(projection: Parameters<typeof actual.directReadDeclaration>[0], data: Parameters<typeof actual.directReadDeclaration>[1]) {
      if (data.read === "sources")
        return { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" } as const;
      if (data.read === "sourcePage")
        return { source: "object", parameterMode: "fixed", params: { source: "keyword", cursor: "cursor" }, requiredParams: ["source"], result: "panelRecordQuery" } as const;
      return actual.directReadDeclaration(projection, data);
    },
  };
});

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
const documentRef = { className: "Document", primaryKey: "doc-1" };

function mount(projection: DirectProjection, inputs: Record<string, RuntimeJsonValue>, answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse) {
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(definePanel({
    state: {}, members: { reader: { target: { projectionId: projection.id }, inputs: Object.fromEntries(Object.entries(inputs).map(([name, literal]) => [name, { literal }])) } },
  }), {
    pageKey: "p", url: () => "/p", label: () => "P", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations,
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

it("reads a record's sources page by page through the owner's reads", async () => {
  const projection: DirectProjection = {
    ...base, id: "sources", name: "Sources", componentId: "@ontomato/sdk:ObjectTextReader",
    inputs: { record: { kind: "object", objectType: "Document" } }, outputs: {}, config: {},
    data: {
      sources: { source: recordOf("record"), read: "sources", params: {} },
      page: { source: recordOf("record"), read: "sourcePage", params: {} },
    },
  };
  const { element, reads } = mount(projection, { record: documentRef }, (request) => {
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
  expect(reads().at(-1)).toMatchObject({ dataName: "page", inputs: { record: documentRef }, runtimeParams: { source: "s-1" } });

  element.querySelector<HTMLButtonElement>(".fui-segmented-reader-more")!.click();
  await vi.waitFor(() => expect(element.querySelector(".fui-segmented-reader-segment")?.textContent).toBe("Second part."));
  expect(reads().at(-1)).toMatchObject({ dataName: "page", runtimeParams: { source: "s-1", cursor: "12" } });
  expect(element.querySelector(".fui-segmented-reader-more")).toBeNull();
});

it("shows plain preformatted text when format is plain or when the record path has no file extension", async () => {
  const plainProjection: DirectProjection = {
    ...base, id: "file-plain", name: "File", componentId: "@ontomato/sdk:ObjectTextReader",
    inputs: { skill: { kind: "object", objectType: SKILL }, path: { kind: "scalar", type: "string" } }, outputs: {}, config: { format: "plain" },
    data: { record: { source: recordOf("skill"), read: "file", params: { path: { input: "path" } } } },
  };
  const plain = mount(plainProjection, { skill: { className: SKILL, primaryKey: "sk-1" }, path: "SKILL.md" }, () =>
    ({ status: "ready", value: { primaryKey: "SKILL.md", label: "SKILL.md", fields: { content: "# Skill\nLine two" } } as never }));
  await vi.waitFor(() => expect(plain.element.querySelector(".sdk-object-text-reader-whole")?.textContent).toBe("# Skill\nLine two"));
  expect(plain.reads()).toEqual([expect.objectContaining({ dataName: "record", inputs: { skill: { className: SKILL, primaryKey: "sk-1" }, path: "SKILL.md" } })]);
  plain.unmount();

  const noExtProjection: DirectProjection = { ...plainProjection, id: "file-noext", config: {} };
  const noExt = mount(noExtProjection, { skill: { className: SKILL, primaryKey: "sk-1" }, path: "README" }, () =>
    ({ status: "ready", value: { primaryKey: "README", label: "README", fields: { content: "Plain notes\nLine two" } } as never }));
  await vi.waitFor(() => expect(noExt.element.querySelector(".sdk-object-text-reader-whole")?.textContent).toBe("Plain notes\nLine two"));
  noExt.unmount();
});

it("renders Markdown with separated YAML frontmatter when auto-detected or forced", async () => {
  const projection: DirectProjection = {
    ...base, id: "file-md", name: "File", componentId: "@ontomato/sdk:ObjectTextReader",
    inputs: { skill: { kind: "object", objectType: SKILL }, path: { kind: "scalar", type: "string" } }, outputs: {}, config: {},
    data: { record: { source: recordOf("skill"), read: "file", params: { path: { input: "path" } } } },
  };
  const content = "---\nname: demo-skill\ndescription: Demo description\n---\n# Heading\n\nBody **bold** text.";
  const { element, unmount } = mount(projection, { skill: { className: SKILL, primaryKey: "sk-1" }, path: "SKILL.md" }, () =>
    ({ status: "ready", value: { primaryKey: "SKILL.md", label: "SKILL.md", fields: { content } } as never }));
  await vi.waitFor(() => {
    expect(element.querySelector(".sdk-object-text-reader-frontmatter")?.textContent).toContain("name: demo-skill");
    expect(element.querySelector(".markdown-view")?.textContent).toContain("Heading");
    expect(element.querySelector(".markdown-view")?.textContent).toContain("Body bold text.");
  });
  expect(element.querySelector(".sdk-object-text-reader-whole")).toBeNull();
  unmount();

  const noFrontmatter = mount(projection, { skill: { className: SKILL, primaryKey: "sk-1" }, path: "notes.md" }, () =>
    ({ status: "ready", value: { primaryKey: "notes.md", label: "notes.md", fields: { content: "## Plain Markdown\nHello" } } as never }));
  await vi.waitFor(() => {
    expect(noFrontmatter.element.querySelector(".markdown-view")?.textContent).toContain("Plain Markdown");
  });
  expect(noFrontmatter.element.querySelector(".sdk-object-text-reader-frontmatter")).toBeNull();
  noFrontmatter.unmount();
});

it("renders non-Markdown files with a read-only CodeEditor and honors pathField", async () => {
  const projection: DirectProjection = {
    ...base, id: "file-code", name: "File", componentId: "@ontomato/sdk:ObjectTextReader",
    inputs: { skill: { kind: "object", objectType: SKILL }, path: { kind: "scalar", type: "string" } }, outputs: {}, config: { pathField: "filePath" },
    data: { record: { source: recordOf("skill"), read: "file", params: { path: { input: "path" } } } },
  };
  const { element, unmount } = mount(projection, { skill: { className: SKILL, primaryKey: "sk-1" }, path: "scripts/run.py" }, () =>
    ({
      status: "ready",
      value: {
        primaryKey: "file-1",
        label: "Runner",
        fields: { filePath: "scripts/run.py", content: "def main():\n    return 42\n" },
      } as never,
    }));
  await vi.waitFor(() => {
    const editor = element.querySelector(".sdk-object-text-reader-code .cm-content");
    expect(editor).not.toBeNull();
    expect(editor?.textContent).toContain("def main():");
    expect(editor?.getAttribute("contenteditable")).toBe("false");
  });
  expect(element.querySelector(".sdk-object-text-reader-whole")).toBeNull();
  expect(element.querySelector(".markdown-view")).toBeNull();
  unmount();
});

it("renders unified diffs with file summary, per-file cards, line numbers, binary notices, and empty states", async () => {
  const diffProjection: DirectProjection = {
    ...base, id: "file-diff", name: "Diff", componentId: "@ontomato/sdk:ObjectTextReader",
    inputs: { skill: { kind: "object", objectType: SKILL }, path: { kind: "scalar", type: "string" } }, outputs: {},
    config: { format: "diff" },
    data: { record: { source: recordOf("skill"), read: "file", params: { path: { input: "path" } } } },
  };
  const patch = [
    "diff --git a/src/hello.ts b/src/hello.ts",
    "index 1111111..2222222 100644",
    "--- a/src/hello.ts",
    "+++ b/src/hello.ts",
    "@@ -1,2 +1,3 @@",
    " const who = 'world';",
    "-console.log('hi');",
    "+console.log('hello');",
    "+console.log(who);",
    "\\ No newline at end of file",
    "diff --git a/docs/new.md b/docs/new.md",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/docs/new.md",
    "@@ -0,0 +1 @@",
    "+# New doc",
    "diff --git a/old.txt b/old.txt",
    "deleted file mode 100644",
    "--- a/old.txt",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-retired",
    "diff --git a/assets/icon.png b/assets/icon.png",
    "Binary files a/assets/icon.png and b/assets/icon.png differ",
  ].join("\n");

  const populated = mount(diffProjection, { skill: { className: SKILL, primaryKey: "sk-1" }, path: "changes.diff" }, () =>
    ({ status: "ready", value: { primaryKey: "diff-1", label: "Changes", fields: { content: patch } } as never }));
  await vi.waitFor(() => {
    expect(populated.element.querySelector(".sdk-object-text-reader-diff-summary")?.textContent).toContain("4 files");
  });
  const summaryText = populated.element.querySelector(".sdk-object-text-reader-diff-summary")?.textContent ?? "";
  expect(summaryText).toContain("+3");
  expect(summaryText).toContain("−2");

  const cards = [...populated.element.querySelectorAll(".sdk-object-text-reader-diff-file")];
  expect(cards).toHaveLength(4);
  expect(cards[0]!.querySelector(".sdk-object-text-reader-diff-path")?.textContent).toBe("src/hello.ts");
  expect(cards[0]!.querySelector(".sdk-object-text-reader-diff-kind")?.textContent?.trim()).toBe("Modified");
  expect(cards[0]!.querySelector(".sdk-object-text-reader-diff-line-hunk .sdk-object-text-reader-diff-text")?.textContent).toBe("@@ -1,2 +1,3 @@");
  const removeRow = cards[0]!.querySelector(".sdk-object-text-reader-diff-line-remove")!;
  expect([...removeRow.querySelectorAll("td")].map((td) => td.textContent?.trim())).toEqual(["2", "", "−", "console.log('hi');"]);
  const addRows = [...cards[0]!.querySelectorAll(".sdk-object-text-reader-diff-line-add")];
  expect([...addRows[0]!.querySelectorAll("td")].map((td) => td.textContent?.trim())).toEqual(["", "2", "+", "console.log('hello');"]);
  expect([...addRows[1]!.querySelectorAll("td")].map((td) => td.textContent?.trim())).toEqual(["", "3", "+", "console.log(who);"]);
  expect(cards[0]!.querySelector(".sdk-object-text-reader-diff-line-note .sdk-object-text-reader-diff-text")?.textContent).toBe("\\ No newline at end of file");

  expect(cards[1]!.querySelector(".sdk-object-text-reader-diff-kind")?.textContent?.trim()).toBe("New file");
  expect(cards[2]!.querySelector(".sdk-object-text-reader-diff-kind")?.textContent?.trim()).toBe("Deleted");
  expect(cards[3]!.querySelector(".sdk-object-text-reader-diff-binary")?.textContent?.trim()).toBe("Binary file changed");
  expect(populated.element.querySelector(".sdk-object-text-reader-whole")).toBeNull();
  populated.unmount();

  const empty = mount(diffProjection, { skill: { className: SKILL, primaryKey: "sk-1" }, path: "empty.diff" }, () =>
    ({ status: "ready", value: { primaryKey: "diff-2", label: "Changes", fields: { content: "" } } as never }));
  await vi.waitFor(() => {
    expect(empty.element.querySelector(".sdk-object-text-reader-diff-empty")?.textContent?.trim()).toBe("No file changed");
  });
  expect(empty.element.querySelectorAll(".sdk-object-text-reader-diff-file")).toHaveLength(0);
  empty.unmount();

  const unparseable = mount(diffProjection, { skill: { className: SKILL, primaryKey: "sk-1" }, path: "plain.diff" }, () =>
    ({ status: "ready", value: { primaryKey: "diff-3", label: "Changes", fields: { content: "Just a note without diff headers" } } as never }));
  await vi.waitFor(() => {
    expect(unparseable.element.querySelector(".sdk-object-text-reader-diff-empty")?.textContent?.trim()).toBe("No file changed");
  });
  unparseable.unmount();
});

/*
 * Two readers on one page, each with its anchor, sharing the source open and the reader open through the panel's state
 * (M7's governance report: the sources an issue cites, and all of the record's): the page's code opens a source by
 * writing them, and only the reader the anchor names reads and shows it.
 */
it("opens the source the page writes, in the reader its anchor names, and reads its first page", async () => {
  const reader = (id: string, anchor: string): DirectProjection => ({
    ...base, id, name: id, componentId: "@ontomato/sdk:ObjectTextReader",
    inputs: { record: { kind: "object", objectType: "Document" } },
    outputs: { activeSourceId: { kind: "scalar", type: "string" }, activeAnchor: { kind: "scalar", type: "string" } }, config: { anchor },
    data: {
      sources: { source: recordOf("record"), read: "sources", params: {} },
      page: { source: recordOf("record"), read: "sourcePage", params: {} },
    },
  });
  const projections: Record<string, DirectProjection> = { "issue-sources": reader("issue-sources", "issue"), "all-sources": reader("all-sources", "all") };
  const shared = { record: { literal: documentRef } };
  const opened = { activeSourceId: { state: "openSource" }, activeAnchor: { state: "openReader" } };
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(definePanel({
    state: { openSource: { type: { kind: "scalar", type: "string" } }, openReader: { type: { kind: "scalar", type: "string" } } },
    members: {
      issue: { target: { projectionId: "issue-sources" }, inputs: shared, outputs: opened },
      all: { target: { projectionId: "all-sources" }, inputs: shared, outputs: opened },
    },
  }), {
    pageKey: "p", url: () => "/p", label: () => "P", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations,
    readProjection: async (id) => projections[id]!,
    read: async (request) => {
      reads.push(request);
      if (request.operations) return { status: "ready", value: {} as never };
      if (request.dataName === "sources") return { status: "ready", value: [
        { primaryKey: "s-1", label: "Policy memo", fields: {} }, { primaryKey: "s-2", label: "Audit note", fields: {} },
      ] as never };
      const source = String(request.runtimeParams?.source);
      return { status: "ready", value: { rows: [{ primaryKey: `${source}:0`, label: source, fields: { text: `Text of ${source}` } }] } as never };
    },
  });
  const element = document.createElement("div");
  document.body.append(element);
  createApp({ render: () => h("div", [
    h("section", { class: "issue" }, [h(PanelMember, { instance, member: "issue" })]),
    h("section", { class: "all" }, [h(PanelMember, { instance, member: "all" })]),
  ]) }).use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(element);
  const shown = (where: string) => element.querySelector(`.${where} .fui-segmented-reader-segment`)?.textContent ?? null;
  const pageReads = () => reads.filter((read) => read.dataName === "page").map((read) => [read.memberPath[0]!.member, read.runtimeParams?.source]);
  await vi.waitFor(() => expect(element.querySelectorAll(".fui-segmented-reader-chip")).toHaveLength(4));

  // The page opens the issue's source: only the issue's reader reads it.
  instance.state.setState({ openReader: "issue", openSource: "s-2" });
  await vi.waitFor(() => expect(shown("issue")).toBe("Text of s-2"));
  expect(shown("all")).toBeNull();
  expect(pageReads()).toEqual([["issue", "s-2"]]);

  // The same source in the other reader: the first closes, the second reads it.
  instance.state.set("openReader", "all");
  await vi.waitFor(() => expect(shown("all")).toBe("Text of s-2"));
  expect(shown("issue")).toBeNull();
  expect(pageReads()).toEqual([["issue", "s-2"], ["all", "s-2"]]);

  // A chip in the issue's reader writes both, and the page's state follows.
  [...element.querySelectorAll<HTMLButtonElement>(".issue .fui-segmented-reader-chip")].find((chip) => chip.textContent?.trim() === "Policy memo")!.click();
  await vi.waitFor(() => expect(shown("issue")).toBe("Text of s-1"));
  expect(instance.state.values.value).toMatchObject({ openReader: "issue", openSource: "s-1" });
  expect(shown("all")).toBeNull();
});
