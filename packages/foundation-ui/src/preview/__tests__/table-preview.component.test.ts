import { expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ElementPlus from "element-plus";
import TablePreview from "../TablePreview.vue";
import ColumnFilter from "../ColumnFilter.vue";
import { jsonTable } from "../table-data";

const labels = { filter: (column: string) => `Filter ${column}`, search: "Search", all: "All", empty: "(empty)" };

// Numbers sort by the file's own values, filtering narrows the visible rows without altering the source table,
// and the pager only renders when the filtered rows span more than one page.
it("sorts by numeric values, filters columns, and hides pagination when rows fit on one page", async () => {
  const table = jsonTable({
    columns: [
      { key: "name", label: "Name" },
      { key: "amount", label: "Amount" },
    ],
    rows: [
      { name: "A", amount: 9 },
      { name: "B", amount: 10 },
      { name: "B", amount: 100 },
      { name: "C", amount: null },
    ],
  })!;
  const wrapper = mount(TablePreview, {
    props: { table, pageSize: 3, arrange: labels },
    global: { plugins: [ElementPlus] },
  });
  try {
    await flushPromises();
    const shown = () => wrapper.findAll("tbody tr.table-preview-row").map((row) => row.findAll("td").map((cell) => cell.text()));

    expect(wrapper.find(".el-table").exists()).toBe(false);
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.find(".table-preview-pager").exists()).toBe(true);

    await wrapper.findAll("thead th")[1]!.get(".sort-caret.descending").trigger("click");
    expect(wrapper.findAll("thead th")[1]!.attributes("aria-sort")).toBe("descending");
    expect(shown().map((row) => row[1])).toEqual(["100", "10", "9"]);

    // Clicking the heading button cycles ascending -> descending -> none.
    await wrapper.findAll("thead th")[0]!.get(".table-preview-heading-button").trigger("click");
    expect(wrapper.findAll("thead th")[0]!.attributes("aria-sort")).toBe("ascending");
    await wrapper.findAll("thead th")[0]!.get(".table-preview-heading-button").trigger("click");
    expect(wrapper.findAll("thead th")[0]!.attributes("aria-sort")).toBe("descending");
    await wrapper.findAll("thead th")[0]!.get(".table-preview-heading-button").trigger("click");
    expect(wrapper.findAll("thead th")[0]!.attributes("aria-sort")).toBe("none");

    wrapper.findAllComponents(ColumnFilter)[0]!.vm.$emit("change", new Set(["B"]));
    await nextTick();
    expect(shown()).toEqual([["B", "10"], ["B", "100"]]);
    expect(wrapper.find(".table-preview-pager").exists()).toBe(false);

    // Filtering out all rows renders the empty row while keeping headers mounted so readers can clear the filter.
    wrapper.findAllComponents(ColumnFilter)[0]!.vm.$emit("change", new Set());
    await nextTick();
    expect(wrapper.find("thead th").exists()).toBe(true);
    expect(wrapper.find(".table-preview-empty").exists()).toBe(true);
  } finally {
    wrapper.unmount();
  }
});

// Single-column tables align left even when numeric; multi-column numeric columns align right with controls to the left.
it("aligns single numeric columns left and multi-column numeric columns right", async () => {
  const single = jsonTable({
    columns: [{ key: "total", label: "Total" }],
    rows: [{ total: 3105 }],
  })!;
  const singleWrapper = mount(TablePreview, {
    props: { table: single, arrange: labels },
    global: { plugins: [ElementPlus] },
  });
  try {
    await flushPromises();
    expect(singleWrapper.find("table.table-preview-table").classes()).toContain("is-single");
    expect(singleWrapper.find("thead th").classes()).not.toContain("is-right");
    expect(singleWrapper.find("tbody td").classes()).not.toContain("is-right");
  } finally {
    singleWrapper.unmount();
  }

  const multi = jsonTable({
    columns: [
      { key: "status", label: "Status" },
      { key: "count", label: "Count" },
    ],
    rows: [
      { status: "Active", count: 3105 },
      { status: "Retired", count: 1401 },
    ],
  })!;
  const multiWrapper = mount(TablePreview, {
    props: { table: multi, arrange: labels },
    global: { plugins: [ElementPlus] },
  });
  try {
    await flushPromises();
    const headers = multiWrapper.findAll("thead th");
    const cells = multiWrapper.findAll("tbody tr")[0]!.findAll("td");
    expect(headers[0]!.classes()).not.toContain("is-right");
    expect(headers[1]!.classes()).toContain("is-right");
    expect(cells[0]!.classes()).not.toContain("is-right");
    expect(cells[1]!.classes()).toContain("is-right");
  } finally {
    multiWrapper.unmount();
  }
});

// Long cells default to single-line truncation with hover title and switch to wrapping when `wrap` is enabled.
it("exposes hover titles by default and supports wrap, height, maxHeight, and emptyText", async () => {
  const longText = "A very long description that would overflow a single line in compact tables";
  const table = jsonTable({
    columns: [
      { key: "item", label: "Item" },
      { key: "desc", label: "Description" },
    ],
    rows: [{ item: "Core", desc: longText }],
  })!;
  const compact = mount(TablePreview, {
    props: { table, height: "100%", maxHeight: 360 },
    global: { plugins: [ElementPlus] },
  });
  try {
    await flushPromises();
    expect(compact.find(".table-preview").attributes("style")).toContain("height: 100%");
    expect(compact.find(".table-preview-scroll").attributes("style")).toContain("max-height: 360px");
    expect(compact.find("table.table-preview-table").classes()).not.toContain("is-wrap");
    expect(compact.findAll(".table-preview-cell")[1]!.attributes("title")).toBe(longText);
  } finally {
    compact.unmount();
  }

  const wrapped = mount(TablePreview, {
    props: { table: { columns: ["Item"], rows: [] }, wrap: true, emptyText: "Nothing here" },
    global: { plugins: [ElementPlus] },
  });
  try {
    await flushPromises();
    expect(wrapped.find("table.table-preview-table").classes()).toContain("is-wrap");
    expect(wrapped.find(".table-preview-empty").text()).toBe("Nothing here");
  } finally {
    wrapped.unmount();
  }
});
