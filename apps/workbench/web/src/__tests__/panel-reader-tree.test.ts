import { afterEach, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges,
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelRecord, panelUse, registered, writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * U8 ObjectTree (PathTree) and ObjectTextReader (SegmentedTextReader) through the platform's real host and bridge:
 * - ObjectTree renders a folder-first, name-sorted, default-expanded tree from a child type's path list, highlights the
 *   current selected panel state, toggles folders without selecting, and selects owner defaultPrimaryKey or first file.
 * - ObjectTextReader reads segmented text by offset from the resource adapter, shows "More" while nextOffset exists,
 *   supports closing, and keeps only one anchor expanded across multiple placements on the same page.
 */

const SKILL = "test:Skill";
const SKILL_FILE = "test:SkillFile";
const RECORD = "test:ReportRecord";
const SOURCE = "test:ReportSource";

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};

const projection = (
  id: string,
  componentId: "ObjectTree" | "ObjectTextReader",
  binding: string,
  display: Record<string, unknown>,
  inputs: ProductProjection["inputs"] = {},
): ProductProjection => ({
  ...current, id, name: id, description: "", componentId,
  binding: { kind: "PlatformObjectType", id: binding }, inputs, display,
});

function hostWith(projections: Record<string, ProductProjection>) {
  return (request: Sent) => {
    const match = /^\/api\/product-projections\/(.+)$/.exec(request.path);
    if (match && projections[match[1]!]) return Response.json({ projection: projections[match[1]!] });
    return nothingAt(request);
  };
}

afterEach(() => {
  leaveFrame();
  vi.resetModules();
});

it("renders ObjectTree from child paths, selects defaultPrimaryKey or first file, and toggles folders without selecting", async () => {
  const projections = {
    "skill-files": projection("skill-files", "ObjectTree", SKILL_FILE, {
      parentInput: "skill",
      pathField: "path",
      fallbackToFirst: true,
      label: "Skill package files",
    }, { skill: { kind: "object", objectType: SKILL } }),
  };
  const manifest = definePanel({
    state: {
      selectedSkill: { kind: "object", objectType: SKILL, deepLink: true },
      selectedFile: { kind: "object", objectType: SKILL_FILE, deepLink: true },
    },
    slots: {
      files: {
        projectionId: "skill-files",
        inputs: { skill: { state: "selectedSkill" } },
        outputs: { selected: { state: "selectedFile" } },
      },
    },
    operations: [],
  });
  const panel = panelRecord("panel-skill-tree", "Skill tree", manifest);
  panel.content.html = `<div id="app"><Projection slot="files"></Projection></div>`;
  const use = panelUse("use-skill-tree", "skill-tree-test", panel.id, "/applications/app-test/skill-tree");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  const initialPath = `${use.path}?state=${encodeURIComponent(JSON.stringify({ selectedSkill: { className: SKILL, primaryKey: "skill-1" } }))}`;
  writePanelDocument(registered("app-test", use, panel), initialPath, panelAddressState(initialPath));
  inside(frame);

  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  registerPlatformObjectAdapter({
    objectType: SKILL_FILE,
    query: async (q) => {
      if (q.parent?.primaryKey === "skill-1") {
        return {
          items: [
            { primaryKey: "opaque:s1:notes.txt", label: "notes.txt", fields: { path: "notes.txt" } },
            { primaryKey: "opaque:s1:scripts/run.py", label: "scripts/run.py", fields: { path: "scripts/run.py" } },
            { primaryKey: "opaque:s1:SKILL.md", label: "SKILL.md", fields: { path: "SKILL.md" } },
            { primaryKey: "opaque:s1:docs/guide.md", label: "docs/guide.md", fields: { path: "docs/guide.md" } },
          ],
          total: 4,
          defaultPrimaryKey: "opaque:s1:SKILL.md",
        };
      }
      if (q.parent?.primaryKey === "skill-2") {
        return {
          items: [
            { primaryKey: "opaque:s2:zeta.txt", label: "zeta.txt", fields: { path: "zeta.txt" } },
            { primaryKey: "opaque:s2:alpha/first.py", label: "alpha/first.py", fields: { path: "alpha/first.py" } },
          ],
          total: 2,
        };
      }
      return { items: [], total: 0 };
    },
  });

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const mounted = await mountPanel({});

  // Default SKILL.md is selected and highlighted; folders appear before files in name order, all expanded.
  await vi.waitFor(() => expect(mounted.context.instance.state.values.value.selectedFile).toEqual({
    className: SKILL_FILE, primaryKey: "opaque:s1:SKILL.md",
  }));
  const paths = [...document.querySelectorAll('[role="treeitem"]')].map((el) => el.getAttribute("data-path"));
  expect(paths).toEqual(["docs", "docs/guide.md", "scripts", "scripts/run.py", "SKILL.md", "notes.txt"]);
  expect(document.querySelector('[data-path="SKILL.md"]')?.getAttribute("aria-selected")).toBe("true");

  // Clicking a folder only collapses it and keeps selectedFile unchanged.
  document.querySelector<HTMLButtonElement>('[data-path="scripts"] > button')!.click();
  await nextTick();
  expect(document.querySelector('[data-path="scripts"]')?.getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector('[data-path="scripts/run.py"]')).toBeNull();
  expect(mounted.context.instance.state.values.value.selectedFile).toEqual({
    className: SKILL_FILE, primaryKey: "opaque:s1:SKILL.md",
  });

  // Clicking a file writes its opaque primaryKey to panel state and highlights that row.
  document.querySelector<HTMLButtonElement>('[data-path="docs/guide.md"] > button')!.click();
  await nextTick();
  expect(mounted.context.instance.state.values.value.selectedFile).toEqual({
    className: SKILL_FILE, primaryKey: "opaque:s1:docs/guide.md",
  });
  expect(document.querySelector('[data-path="docs/guide.md"]')?.getAttribute("aria-selected")).toBe("true");

  // Switching parent skill atomically clears child and falls back to first file in tree order (alpha/first.py).
  mounted.context.instance.state.setState({
    selectedSkill: { className: SKILL, primaryKey: "skill-2" },
    selectedFile: null,
  });
  await vi.waitFor(() => expect(mounted.context.instance.state.values.value.selectedFile).toEqual({
    className: SKILL_FILE, primaryKey: "opaque:s2:alpha/first.py",
  }));
});

it("reads segmented text by offset via ObjectTextReader and keeps only one anchor open across two placements", async () => {
  const projections = {
    "source-reader": projection("source-reader", "ObjectTextReader", SOURCE, {
      parentInput: "record",
    }, { record: { kind: "object", objectType: RECORD } }),
  };
  const manifest = definePanel({
    state: {
      selectedRecord: { kind: "object", objectType: RECORD, deepLink: true },
    },
    slots: {
      itemSources: { projectionId: "source-reader", inputs: { record: { state: "selectedRecord" } } },
      allSources: { projectionId: "source-reader", inputs: { record: { state: "selectedRecord" } } },
    },
    operations: [],
  });
  const panel = panelRecord("panel-reader", "Segmented reader", manifest);
  panel.content.html = `
    <div id="app">
      <Projection slot="itemSources" anchor="item-1" :sources="itemSources" v-model:active-anchor="openAnchor" v-model:active-source-id="openSource"></Projection>
      <Projection slot="allSources" anchor="all" v-model:active-anchor="openAnchor" v-model:active-source-id="openSource"></Projection>
    </div>`;
  const use = panelUse("use-reader", "reader-test", panel.id, "/applications/app-test/reader");

  installPlatform(hostWith(projections));
  const frame = panelFrame();
  platformPanelHost("app-test", use, ignoreChanges).frame(frame, registered("app-test", use, panel), true);
  const initialPath = `${use.path}?state=${encodeURIComponent(JSON.stringify({ selectedRecord: { className: RECORD, primaryKey: "rec-1" } }))}`;
  writePanelDocument(registered("app-test", use, panel), initialPath, panelAddressState(initialPath));
  inside(frame);

  const { registerPlatformObjectAdapter } = await import("../../../../../packages/apps-sdk/src/panel/platform-objects");
  const segmentCalls: unknown[] = [];
  registerPlatformObjectAdapter({
    objectType: SOURCE,
    query: async (q) => ({
      items: q.parent?.primaryKey === "rec-1"
        ? [
            { primaryKey: "src-1", label: "Source One", fields: {} },
            { primaryKey: "src-2", label: "Source Two", fields: {} },
          ]
        : [],
      total: q.parent?.primaryKey === "rec-1" ? 2 : 0,
    }),
    readSegment: async (q) => {
      segmentCalls.push(q);
      if (q.sourceId === "src-1" && q.offset === 0) {
        return { sourceId: "src-1", title: "Source One", items: [{ id: "a", text: "Chunk 1" }], nextOffset: 2 };
      }
      if (q.sourceId === "src-1" && q.offset === 2) {
        return { sourceId: "src-1", title: "Source One", items: [{ id: "b", text: "Chunk 2" }], nextOffset: null };
      }
      return { sourceId: q.sourceId, title: "Source Two", items: [{ id: "c", text: "Other chunk" }], nextOffset: null };
    },
  });

  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const openAnchor = ref<string | null>(null);
  const openSource = ref<string | null>(null);
  const mounted = await mountPanel({
    setup: () => ({
      openAnchor,
      openSource,
      itemSources: [{ id: "src-1", title: "Source One" }],
    }),
  });

  await vi.waitFor(() => expect(document.querySelectorAll('[data-anchor="all"] [data-source-id]').length).toBe(2));

  // Click Source One under item-1 -> reads offset 0 and shows More.
  document.querySelector<HTMLButtonElement>('[data-anchor="item-1"] [data-source-id="src-1"]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-anchor="item-1"] blockquote')?.textContent).toBe("Chunk 1"));
  expect(segmentCalls[0]).toEqual({ parent: { className: RECORD, primaryKey: "rec-1" }, sourceId: "src-1", offset: 0 });
  expect(document.querySelectorAll(".fui-segmented-reader-panel").length).toBe(1);

  // Click More -> reads offset 2 and hides More (nextOffset: null).
  document.querySelector<HTMLButtonElement>('[data-anchor="item-1"] .fui-segmented-reader-more')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-anchor="item-1"] blockquote')?.textContent).toBe("Chunk 2"));
  expect(segmentCalls[1]).toEqual({ parent: { className: RECORD, primaryKey: "rec-1" }, sourceId: "src-1", offset: 2 });
  expect(document.querySelector('[data-anchor="item-1"] .fui-segmented-reader-more')).toBeNull();

  // Click Source Two under "all" -> opens "all" and closes "item-1" (only 1 expanded at a time).
  document.querySelector<HTMLButtonElement>('[data-anchor="all"] [data-source-id="src-2"]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-anchor="all"] blockquote')?.textContent).toBe("Other chunk"));
  expect(document.querySelectorAll(".fui-segmented-reader-panel").length).toBe(1);
  expect(document.querySelector('[data-anchor="item-1"] .fui-segmented-reader-panel')).toBeNull();

  // Close collapses it; switching parent record also ensures closed state.
  document.querySelector<HTMLButtonElement>('[data-anchor="all"] .fui-segmented-reader-close')!.click();
  await nextTick();
  expect(document.querySelectorAll(".fui-segmented-reader-panel").length).toBe(0);
  expect(openAnchor.value).toBeNull();

  // Re-open, then switch parent record -> reader closes cleanly.
  document.querySelector<HTMLButtonElement>('[data-anchor="all"] [data-source-id="src-2"]')!.click();
  await vi.waitFor(() => expect(document.querySelectorAll(".fui-segmented-reader-panel").length).toBe(1));
  mounted.context.instance.state.set("selectedRecord", { className: RECORD, primaryKey: "rec-2" });
  await vi.waitFor(() => expect(document.querySelectorAll(".fui-segmented-reader-panel").length).toBe(0));
});
