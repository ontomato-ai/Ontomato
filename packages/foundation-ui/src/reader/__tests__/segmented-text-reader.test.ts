import { describe, expect, it } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { SegmentedTextReader, type SegmentedTextPage } from "../index";

describe("SegmentedTextReader", () => {
  it("opens a source, escapes segment text, shows More only when nextOffset exists, and coordinates single-open across anchors", async () => {
    const pages: Record<string, SegmentedTextPage> = {
      "s1:0": {
        sourceId: "s1",
        title: "Document A",
        items: [{ id: "p1", text: "<script>alert(1)</script> First excerpt" }],
        nextOffset: 1,
      },
      "s1:1": {
        sourceId: "s1",
        title: "Document A",
        items: [{ id: "p2", text: "Second excerpt" }],
        nextOffset: null,
      },
      "s2:0": {
        sourceId: "s2",
        title: "Document B",
        items: [{ id: "p3", text: "Other excerpt" }],
        nextOffset: null,
      },
    };

    const Host = defineComponent({
      setup() {
        const activeAnchor = ref<string | null>(null);
        const activeSourceId = ref<string | null>(null);
        const page = ref<SegmentedTextPage | null>(null);
        const open = (sourceId: string, offset: number, anchor?: string) => {
          activeAnchor.value = anchor ?? null;
          activeSourceId.value = sourceId;
          page.value = pages[`${sourceId}:${offset}`] ?? null;
        };
        const close = () => {
          activeAnchor.value = null;
          activeSourceId.value = null;
          page.value = null;
        };
        return () =>
          h("div", [
            h(SegmentedTextReader, {
              anchor: "first",
              sources: [{ id: "s1", title: "Document A" }],
              activeAnchor: activeAnchor.value,
              activeSourceId: activeSourceId.value,
              page: page.value,
              onOpen: (id: string, offset: number, anchor?: string) => open(id, offset, anchor),
              onMore: (id: string, offset: number, anchor?: string) => open(id, offset, anchor),
              onClose: close,
            }),
            h(SegmentedTextReader, {
              anchor: "second",
              sources: [{ id: "s2", title: "Document B" }],
              activeAnchor: activeAnchor.value,
              activeSourceId: activeSourceId.value,
              page: page.value,
              onOpen: (id: string, offset: number, anchor?: string) => open(id, offset, anchor),
              onMore: (id: string, offset: number, anchor?: string) => open(id, offset, anchor),
              onClose: close,
            }),
          ]);
      },
    });

    const wrapper = mount(Host);
    expect(wrapper.findAll(".fui-segmented-reader-panel")).toHaveLength(0);

    // Open source in first anchor -> renders escaped segment and More button.
    await wrapper.find('[data-anchor="first"] [data-source-id="s1"]').trigger("click");
    expect(wrapper.findAll(".fui-segmented-reader-panel")).toHaveLength(1);
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find('[data-anchor="first"] blockquote').text()).toBe("<script>alert(1)</script> First excerpt");
    expect(wrapper.find('[data-anchor="first"] .fui-segmented-reader-more').exists()).toBe(true);

    // Click More -> reads offset 1, nextOffset is null so More button hides.
    await wrapper.find('[data-anchor="first"] .fui-segmented-reader-more').trigger("click");
    expect(wrapper.find('[data-anchor="first"] blockquote').text()).toBe("Second excerpt");
    expect(wrapper.find('[data-anchor="first"] .fui-segmented-reader-more').exists()).toBe(false);

    // Open source in second anchor -> first anchor collapses so only one panel is open.
    await wrapper.find('[data-anchor="second"] [data-source-id="s2"]').trigger("click");
    expect(wrapper.findAll(".fui-segmented-reader-panel")).toHaveLength(1);
    expect(wrapper.find('[data-anchor="first"] .fui-segmented-reader-panel').exists()).toBe(false);
    expect(wrapper.find('[data-anchor="second"] blockquote').text()).toBe("Other excerpt");

    // Close -> collapses open panel.
    await wrapper.find('[data-anchor="second"] .fui-segmented-reader-close').trigger("click");
    expect(wrapper.findAll(".fui-segmented-reader-panel")).toHaveLength(0);
  });
});
