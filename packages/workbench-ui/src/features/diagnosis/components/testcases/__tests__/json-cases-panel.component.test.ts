import { afterEach, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../../../i18n";
import JsonCasesPanel from "../JsonCasesPanel.vue";

afterEach(() => {
  document.body.innerHTML = "";
});

// The test-case page leaves the JSON text alone while it is being edited and writes the cases back when the editing
// ends, so only focus leaving the whole editor ends it: its own search box is still inside.
it("keeps editing the JSON while the focus is in the editor's search box, and ends it when the focus leaves", async () => {
  const outside = document.body.appendChild(document.createElement("button"));
  const wrapper = mount(JsonCasesPanel, {
    props: { collapsed: false, width: 360, casesCount: 1, jsonText: '[{"caseId":"1","question":"q"}]', jsonError: "" },
    global: { plugins: [workbenchI18n(), ElementPlus] },
    attachTo: document.body,
  });
  try {
    const content = wrapper.get(".cm-content").element as HTMLElement;
    content.focus();
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "f", keyCode: 70, ctrlKey: true, bubbles: true }));
    await nextTick();
    (wrapper.get(".cm-search input[name=search]").element as HTMLInputElement).focus();
    expect(wrapper.emitted("json-focus")).toBeTruthy();
    expect(wrapper.emitted("json-blur")).toBeUndefined();

    outside.focus();
    expect(wrapper.emitted("json-blur")).toHaveLength(1);
  } finally {
    wrapper.unmount();
  }
});
