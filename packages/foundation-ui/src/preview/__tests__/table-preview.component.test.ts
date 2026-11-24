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
    const shown = () => wrapper.findAll(".el-table__body tr").map((row) => row.findAll("td").map((cell) => cell.text()));

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    expect(wrapper.find(".table-preview-pager").exists()).toBe(true);

    await wrapper.findAll(".el-table__header th")[1]!.get(".caret-wrapper .descending").trigger("click");
    expect(shown().map((row) => row[1])).toEqual(["100", "10", "9"]);

    wrapper.findAllComponents(ColumnFilter)[0]!.vm.$emit("change", new Set(["B"]));
    await nextTick();
    expect(shown()).toEqual([["B", "100"], ["B", "10"]]);
    expect(wrapper.find(".table-preview-pager").exists()).toBe(false);
  } finally {
    wrapper.unmount();
  }
});
