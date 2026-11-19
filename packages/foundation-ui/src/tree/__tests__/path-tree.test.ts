import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { buildPathTree, PathTree } from "../index";

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
});
