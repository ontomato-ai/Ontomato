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

// Read-only or editable, Ctrl/Cmd-F opens the one search panel, at the top.
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
    expect(wrapper.find(".cm-panels-top .cm-search input[name=search]").exists()).toBe(true);
  } finally {
    wrapper.unmount();
  }
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
