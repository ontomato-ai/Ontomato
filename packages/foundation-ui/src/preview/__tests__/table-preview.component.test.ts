import { expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ElementPlus from "element-plus";
import TablePreview from "../TablePreview.vue";
import ColumnFilter from "../ColumnFilter.vue";
import { jsonTable } from "../table-data";

const labels = { filter: (column: string) => `Filter ${column}`, search: "Search", all: "All", empty: "(empty)" };

// A conversation continues from chosen rows by their numbers in the immutable source file, so sorting and filtering
// what the reader sees must never change which records a choice names. Numbers sort by the file's own values.
it("keeps choosing rows by their index in the source after the reader sorts and filters", async () => {
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
    props: { table, pageSize: 10, selected: [], arrange: labels },
    global: { plugins: [ElementPlus] },
  });
  try {
    await flushPromises();
    const shown = () => wrapper.findAll(".el-table__body tr").map((row) => row.findAll("td").map((cell) => cell.text()).slice(1));

    await wrapper.findAll(".el-table__header th")[2]!.get(".caret-wrapper .descending").trigger("click");
    expect(shown().map((row) => row[1])).toEqual(["100", "10", "9", ""]);

    wrapper.findAllComponents(ColumnFilter)[0]!.vm.$emit("change", new Set(["B"]));
    await nextTick();
    expect(shown()).toEqual([["B", "100"], ["B", "10"]]);

    await wrapper.findAll(".el-table__body tr")[0]!.get("input[type=checkbox]").setValue(true);
    expect(wrapper.emitted("update:selected")?.at(-1)).toEqual([[2]]);
  } finally {
    wrapper.unmount();
  }
});
