import { expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { MarkdownView } from "../index";

// markstream gives a table's column resize handles a fixed English name though they answer only to a pointer; the
// product's Markdown keeps them away from screen readers and out of the tab order, in any language.
it("keeps a table's pointer-only resize handles away from screen readers", async () => {
  const wrapper = mount(MarkdownView, { props: { content: "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n" } });
  try {
    await flushPromises();
    const handles = wrapper.findAll(".table-node__resize-handle");
    expect(handles.length).toBe(2);
    for (const handle of handles) {
      expect(handle.attributes("aria-hidden")).toBe("true");
      expect(handle.attributes("aria-label")).toBeUndefined();
      expect(handle.attributes("tabindex")).toBe("-1");
    }
  } finally {
    wrapper.unmount();
  }
});
