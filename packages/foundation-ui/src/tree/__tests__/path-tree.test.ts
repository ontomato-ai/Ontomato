import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { buildParentTree, buildPathTree, filterHierarchyTree, filterPathTree, firstTreeNode, PathTree } from "../index";

describe("buildPathTree", () => {
  it("groups paths into folders before files, sorted by name at every level", () => {
    const tree = buildPathTree([
      "z.txt",
      "src/b.ts",
      "SKILL.md",
      "src/a.ts",
      "docs/intro.md",
      "src/sub/deep.ts",
    ]);
    expect(tree.map((node) => `${node.kind}:${node.label}`)).toEqual([
      "folder:docs",
      "folder:src",
      "file:SKILL.md",
      "file:z.txt",
    ]);
    const src = tree[1]!;
    expect(src.children?.map((node) => `${node.kind}:${node.label}`)).toEqual([
      "folder:sub",
      "file:a.ts",
      "file:b.ts",
    ]);
  });
});

describe("PathTree", () => {
  it("expands all folders by default, toggles folders without selecting, and highlights the selected file", async () => {
    const wrapper = mount(PathTree, {
      props: {
        label: "Package files",
        items: [
          { key: "k-readme", path: "README.md" },
          { key: "k-run", path: "scripts/run.py" },
          { key: "k-skill", path: "SKILL.md" },
        ],
        selectedKey: "k-skill",
      },
    });

    // Folder first, then files in alphabetical order; folder expanded by default so scripts/run.py is visible.
    const nodes = wrapper.findAll('[role="treeitem"]');
    expect(nodes.map((el) => el.attributes("data-path"))).toEqual([
      "scripts",
      "scripts/run.py",
      "README.md",
      "SKILL.md",
    ]);
    expect(wrapper.find('[data-path="SKILL.md"]').attributes("aria-selected")).toBe("true");
    expect(wrapper.find('[data-path="scripts"]').attributes("aria-expanded")).toBe("true");

    // Clicking a folder collapses it and emits no selection.
    await wrapper.find('[data-path="scripts"] > button').trigger("click");
    expect(wrapper.find('[data-path="scripts"]').attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-path="scripts/run.py"]').exists()).toBe(false);
    expect(wrapper.emitted("select")).toBeUndefined();

    // Clicking again re-expands; clicking the file emits select + update:selectedKey.
    await wrapper.find('[data-path="scripts"] > button').trigger("click");
    await wrapper.find('[data-path="scripts/run.py"] > button').trigger("click");
    expect(wrapper.emitted("update:selectedKey")).toEqual([["k-run"]]);
    expect(wrapper.emitted("select")?.[0]?.[0]).toEqual({ key: "k-run", path: "scripts/run.py", label: "run.py" });

    // External selectedKey change updates the highlighted row.
    await wrapper.setProps({ selectedKey: "k-readme" });
    expect(wrapper.find('[data-path="README.md"]').attributes("aria-selected")).toBe("true");
    expect(wrapper.find('[data-path="SKILL.md"]').attributes("aria-selected")).toBe("false");
  });

  it("filters tree items locally when searchable and emits search updates", async () => {
    const wrapper = mount(PathTree, {
      props: {
        items: [
          { key: "index.md", path: "index.md" },
          { key: "ops/guide.md", path: "ops/guide.md" },
          { key: "ops/logs.md", path: "ops/logs.md" },
        ],
        searchable: true,
        search: "",
        searchPlaceholder: "Search files",
        noMatchText: "No matching files",
      },
    });

    const input = wrapper.find('input[type="search"]');
    expect(input.exists()).toBe(true);
    await input.setValue("guide");
    expect(wrapper.emitted("update:search")).toEqual([["guide"]]);

    await wrapper.setProps({ search: "guide" });
    expect(wrapper.findAll('[role="treeitem"]').map((el) => el.attributes("data-path"))).toEqual([
      "ops",
      "ops/guide.md",
    ]);

    await wrapper.setProps({ search: "missing-term" });
    expect(wrapper.find('[role="tree"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("No matching files");
  });

  it("opens a folder's direct index file or toggles and clears selection when directoryIndexFile is set", async () => {
    const wrapper = mount(PathTree, {
      props: {
        items: [
          { key: "k-guide-index", path: "guide/index.md" },
          { key: "k-guide-intro", path: "guide/intro.md" },
          { key: "k-notes-sub-index", path: "notes/sub/index.md" },
          { key: "k-notes-readme", path: "notes/readme.md" },
        ],
        defaultExpandAll: false,
        selectedKey: "k-guide-intro",
        directoryIndexFile: "index.md",
      },
    });

    // Clicking a collapsed folder with a direct index.md expands it and selects that index file.
    expect(wrapper.find('[data-path="guide"]').attributes("aria-expanded")).toBe("false");
    await wrapper.find('[data-path="guide"] > button').trigger("click");
    expect(wrapper.find('[data-path="guide"]').attributes("aria-expanded")).toBe("true");
    expect(wrapper.emitted("update:selectedKey")).toEqual([["k-guide-index"]]);
    expect(wrapper.emitted("select")).toEqual([[{ key: "k-guide-index", path: "guide/index.md", label: "index.md" }]]);

    // Clicking an already-expanded folder with an index file keeps it expanded and selects the index file again.
    await wrapper.find('[data-path="guide"] > button').trigger("click");
    expect(wrapper.find('[data-path="guide"]').attributes("aria-expanded")).toBe("true");
    expect(wrapper.emitted("update:selectedKey")).toEqual([["k-guide-index"], ["k-guide-index"]]);

    // Clicking a folder without a direct index file (nested notes/sub/index.md does not count) toggles it and clears selection.
    expect(wrapper.find('[data-path="notes"]').attributes("aria-expanded")).toBe("false");
    await wrapper.find('[data-path="notes"] > button').trigger("click");
    expect(wrapper.find('[data-path="notes"]').attributes("aria-expanded")).toBe("true");
    expect(wrapper.emitted("update:selectedKey")).toEqual([["k-guide-index"], ["k-guide-index"], [null]]);
    expect(wrapper.emitted("select")).toHaveLength(2);
  });

  it("supports selectableFolders in path mode with independent chevron folding", async () => {
    const wrapper = mount(PathTree, {
      props: {
        items: [
          { key: "rec-docs", path: "docs", label: "Docs" },
          { key: "rec-intro", path: "docs/intro.md", label: "intro.md" },
        ],
        selectableFolders: true,
        selectedKey: "rec-intro",
      },
    });

    const docsItem = wrapper.find('[data-path="docs"]');
    expect(docsItem.attributes("aria-expanded")).toBe("true");
    expect(docsItem.attributes("aria-selected")).toBe("false");

    // Clicking chevron collapses folder without changing selection.
    await docsItem.find(".fui-path-tree-toggle").trigger("click");
    expect(wrapper.find('[data-path="docs"]').attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-path="docs/intro.md"]').exists()).toBe(false);
    expect(wrapper.emitted("update:selectedKey")).toBeUndefined();

    // Clicking the record-backed folder body selects it using its record key without toggling collapse.
    await wrapper.find('[data-path="docs"] .fui-path-tree-body').trigger("click");
    expect(wrapper.find('[data-path="docs"]').attributes("aria-expanded")).toBe("false");
    expect(wrapper.emitted("update:selectedKey")).toEqual([["rec-docs"]]);
    expect(wrapper.emitted("select")).toEqual([[{ key: "rec-docs", path: "docs", label: "Docs" }]]);
  });
});

describe("buildParentTree", () => {
  it("builds a hierarchy preserving caller sibling order and handles children listed before parents", () => {
    const tree = buildParentTree([
      { key: "org-z", parentKey: "org-hq", label: "Zebra Team" },
      { key: "org-hq", parentKey: null, label: "Headquarters", subtitle: "HQ" },
      { key: "org-a", parentKey: "org-hq", label: "Alpha Team" },
      { key: "org-sub", parentKey: "org-z", label: "Subgroup" },
      { key: "org-branch", parentKey: undefined, label: "Branch Office" },
    ]);

    expect(tree.map((node) => node.key)).toEqual(["org-hq", "org-branch"]);
    expect(tree[0]!.subtitle).toBe("HQ");
    expect(tree[0]!.children?.map((node) => node.key)).toEqual(["org-z", "org-a"]);
    expect(tree[0]!.children?.[0]!.children?.map((node) => node.key)).toEqual(["org-sub"]);
    expect(firstTreeNode(tree)).toEqual({ key: "org-hq", path: "org-hq", label: "Headquarters" });
  });

  it("treats unknown parents, self-cycles, and multi-node cycles safely as roots without dropping items", () => {
    const tree = buildParentTree([
      { key: "orphan", parentKey: "missing-parent", label: "Orphan" },
      { key: "self", parentKey: "self", label: "Self Cycle" },
      { key: "cyc-a", parentKey: "cyc-b", label: "Cycle A" },
      { key: "cyc-b", parentKey: "cyc-c", label: "Cycle B" },
      { key: "cyc-c", parentKey: "cyc-a", label: "Cycle C" },
    ]);

    const collectKeys = (nodes: readonly { key: string; children?: readonly any[] }[]): string[] =>
      nodes.flatMap((node) => [node.key, ...(node.children ? collectKeys(node.children) : [])]);

    expect(tree.map((node) => node.key)).toEqual(["orphan", "self", "cyc-c"]);
    expect(collectKeys(tree)).toEqual(["orphan", "self", "cyc-c", "cyc-b", "cyc-a"]);
  });

  it("filters hierarchy nodes by label, subtitle, and key while preserving ancestor chains", () => {
    const tree = buildParentTree([
      { key: "hq", parentKey: null, label: "Headquarters" },
      { key: "rd", parentKey: "hq", label: "R&D", subtitle: "Engineering" },
      { key: "plat", parentKey: "rd", label: "Platform" },
      { key: "sales", parentKey: "hq", label: "Sales" },
    ]);

    const byLabel = filterHierarchyTree(tree, "platform");
    expect(byLabel.map((n) => n.key)).toEqual(["hq"]);
    expect(byLabel[0]!.children?.map((n) => n.key)).toEqual(["rd"]);
    expect(byLabel[0]!.children?.[0]!.children?.map((n) => n.key)).toEqual(["plat"]);

    const bySubtitle = filterHierarchyTree(tree, "engineering");
    expect(bySubtitle[0]!.children?.map((n) => n.key)).toEqual(["rd"]);

    const byKey = filterHierarchyTree(tree, "sales");
    expect(byKey[0]!.children?.map((n) => n.key)).toEqual(["sales"]);

    // Synthetic folder keys ("folder:...") must not match when filtering path trees.
    const pathTree = buildPathTree(["src/main.ts"]);
    expect(filterPathTree(pathTree, "folder")).toEqual([]);
  });
});

describe("PathTree hierarchy mode", () => {
  it("renders selectable parent/leaf nodes with independent chevron toggle, clean rows, and search auto-expand", async () => {
    const wrapper = mount(PathTree, {
      props: {
        mode: "hierarchy",
        label: "Organization units",
        items: [
          { key: "org-1", parentKey: null, label: "Headquarters", subtitle: "HQ" },
          { key: "org-2", parentKey: "org-1", label: "Engineering" },
          { key: "org-3", parentKey: "org-2", label: "Platform" },
          { key: "org-4", parentKey: "org-1", label: "Sales" },
        ],
        selectedKey: "org-3",
        searchable: true,
        search: "",
      },
    });

    // Clean hierarchy mode omits file/folder icons and expands all nodes by default.
    expect(wrapper.findAll(".fui-path-tree-icon")).toHaveLength(0);
    expect(wrapper.findAll('[role="treeitem"]').map((el) => el.attributes("data-key"))).toEqual([
      "org-1",
      "org-2",
      "org-3",
      "org-4",
    ]);
    expect(wrapper.find('[data-key="org-3"]').attributes("aria-selected")).toBe("true");
    expect(wrapper.find('[data-key="org-2"]').attributes("aria-expanded")).toBe("true");

    // Clicking parent chevron collapses children without changing selection.
    await wrapper.find('[data-key="org-2"] .fui-path-tree-toggle').trigger("click");
    expect(wrapper.find('[data-key="org-2"]').attributes("aria-expanded")).toBe("false");
    expect(wrapper.find('[data-key="org-3"]').exists()).toBe(false);
    expect(wrapper.emitted("update:selectedKey")).toBeUndefined();
    expect(wrapper.emitted("select")).toBeUndefined();

    // Clicking the parent node body selects the parent node without expanding it.
    await wrapper.find('[data-key="org-2"] .fui-path-tree-body').trigger("click");
    expect(wrapper.find('[data-key="org-2"]').attributes("aria-expanded")).toBe("false");
    expect(wrapper.emitted("update:selectedKey")).toEqual([["org-2"]]);
    expect(wrapper.emitted("select")).toEqual([[{ key: "org-2", path: "org-2", label: "Engineering" }]]);

    // Active search auto-expands collapsed ancestors to reveal matched descendants.
    await wrapper.setProps({ search: "Platform" });
    expect(wrapper.findAll('[role="treeitem"]').map((el) => el.attributes("data-key"))).toEqual([
      "org-1",
      "org-2",
      "org-3",
    ]);
  });
});
