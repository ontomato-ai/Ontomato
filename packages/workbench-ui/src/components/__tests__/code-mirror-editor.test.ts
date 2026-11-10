import { expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { EditorView } from "@codemirror/view";
import { workbenchI18n } from "../../i18n";
import CodeMirrorEditor from "../CodeMirrorEditor.vue";

it.each(["markdown", "javascript"] as const)("keeps %s hints out of edited content", (language) => {
  const hint = "## Title\nWrite content here";
  const wrapper = mount(CodeMirrorEditor, {
    props: { modelValue: "", placeholder: hint, language },
    global: { plugins: [workbenchI18n()] },
  });
  try {
    const view = EditorView.findFromDOM(wrapper.get(".cm-content").element as HTMLElement)!;
    expect(view.state.doc.toString()).toBe("");
    expect(wrapper.get(".cm-placeholder").text()).toBe(hint);
    view.dispatch({ changes: { from: 0, insert: "user content" } });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["user content"]);
    expect(wrapper.find(".cm-placeholder").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});
