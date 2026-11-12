import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { EditorView } from "@codemirror/view";
import { CodeEditor } from "../index";

const viewOf = (wrapper: ReturnType<typeof mount>) =>
  EditorView.findFromDOM(wrapper.get(".cm-content").element as HTMLElement)!;

afterEach(() => document.documentElement.classList.remove("dark"));

it.each(["markdown", "javascript"] as const)("keeps %s hints out of edited content", (language) => {
  const hint = "## Title\nWrite content here";
  const wrapper = mount(CodeEditor, { props: { modelValue: "", placeholder: hint, language } });
  try {
    const view = viewOf(wrapper);
    expect(view.state.doc.toString()).toBe("");
    expect(wrapper.get(".cm-placeholder").text()).toBe(hint);
    view.dispatch({ changes: { from: 0, insert: "user content" } });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["user content"]);
    expect(wrapper.find(".cm-placeholder").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});

it("lets read-only text take the focus that keyboard search needs", () => {
  const wrapper = mount(CodeEditor, { props: { modelValue: '{"region": "华东"}', language: "json", readonly: true } });
  try {
    expect(viewOf(wrapper).state.readOnly).toBe(true);
    // The test DOM focuses any element; in a browser only a tab stop lets text that is not editable take the focus.
    expect((wrapper.get(".cm-content").element as HTMLElement).tabIndex).toBe(0);
  } finally {
    wrapper.unmount();
  }
});

// Read-only or editable, Ctrl/Cmd-F opens the one search panel: at the top, prompting in the host's Element Plus words.
it.each([true, false])("opens the same search panel from the keyboard (read-only: %s)", async (readonly) => {
  const wrapper = mount(CodeEditor, {
    props: { modelValue: '{"region": "华东"}', language: "json", readonly },
    global: { plugins: [[ElementPlus, { locale: zhCn }]] },
  });
  try {
    const content = wrapper.get(".cm-content").element;
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "f", keyCode: 70, ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(wrapper.find(".cm-panels-bottom .cm-search").exists()).toBe(false);
    expect(wrapper.get(".cm-panels-top .cm-search input[name=search]").attributes("placeholder")).toBe("请输入搜索内容");
  } finally {
    wrapper.unmount();
  }
});

// A page whose own controls float over the editor's foot says how much room to keep there; the editor adds it to its
// own bottom padding, so the last line scrolls above them and nothing is left when nothing floats.
it.each([
  ["readonly", true, "var(--pane-dock-space, 0px)"],
  ["editable", false, "40px"],
])("takes the room the page names into the padding after the last line when %s", (_, readonly, space) => {
  const wrapper = mount(CodeEditor, { props: { modelValue: "line", language: "text", readonly, contentEndSpace: space } });
  try {
    const root = wrapper.get(".code-editor").element as HTMLElement;
    expect(root.style.getPropertyValue("--code-editor-end-space")).toBe(space);
  } finally {
    wrapper.unmount();
  }
});

it("adds that room to the bottom padding it already had, in both modes", () => {
  const source = readFileSync("src/code/CodeEditor.vue", "utf8");
  expect(source).toContain("padding: 8px 0 calc(8px + var(--code-editor-end-space, 0px));");
  expect(source).toContain("padding: 12px 0 calc(12px + var(--code-editor-end-space, 0px));");
});

it("follows the page's dark mode", async () => {
  const wrapper = mount(CodeEditor, { props: { modelValue: "SELECT 1", language: "text" } });
  try {
    expect(viewOf(wrapper).state.facet(EditorView.darkTheme)).toBe(false);
    document.documentElement.classList.add("dark");
    await new Promise((resolve) => setTimeout(resolve));
    await nextTick();
    expect(viewOf(wrapper).state.facet(EditorView.darkTheme)).toBe(true);
  } finally {
    wrapper.unmount();
  }
});
