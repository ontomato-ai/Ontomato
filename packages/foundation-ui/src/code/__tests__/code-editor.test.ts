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

it("searches read-only text from the keyboard, in the words of the host's Element Plus locale", async () => {
  const wrapper = mount(CodeEditor, {
    props: { modelValue: '{"region": "华东"}', language: "json", readonly: true },
    global: { plugins: [[ElementPlus, { locale: zhCn }]] },
  });
  try {
    const content = wrapper.get(".cm-content").element as HTMLElement;
    expect(viewOf(wrapper).state.readOnly).toBe(true);
    // The test DOM focuses any element; in a browser only a tab stop lets text that is not editable take the focus.
    expect(content.tabIndex).toBe(0);
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "f", keyCode: 70, ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(wrapper.get(".cm-search input[name=search]").attributes("placeholder")).toBe("请输入搜索内容");
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
