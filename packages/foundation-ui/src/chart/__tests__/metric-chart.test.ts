import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import MetricChart from "../MetricChart.vue";

/**
 * The platform chart reports what the boundary said. For this test the chart element itself is stubbed: it is the
 * platform's ECharts instance, while the state a reader sees belongs to this component.
 */
const stub = { EChart: { props: ["option"], template: '<div class="drawn" />' } };

const file = {
  dataset: [{ id: "metric", dimensions: ["kind", "amount"], source: [] }],
  xAxis: { type: "category" },
  yAxis: { type: "value" },
  series: [{ id: "series-0", type: "bar", datasetId: "metric", encode: { x: "kind", y: "amount" } }],
  ontomato: { display: { formats: { amount: { kind: "number" } } } },
};

const columns = [{ key: "kind", label: "种类", type: "string" }, { key: "amount", label: "金额", type: "number" }];

it("lists the columns a metric output is missing instead of drawing an empty chart", () => {
  const wrapper = mount(MetricChart, {
    props: { file, metric: { columns: [columns[1]!], rows: [{ amount: 20 }] } },
    global: { stubs: stub },
  });
  expect(wrapper.text()).toContain("CARD_OUTPUT_MISMATCH");
  expect(wrapper.text()).toContain("kind");
  expect(wrapper.find(".drawn").exists()).toBe(false);
});

it("shows a result with no rows as empty, and a partial result's own hint", () => {
  const empty = mount(MetricChart, { props: { file, metric: { columns, rows: [] }, empty: "No rows to draw." }, global: { stubs: stub } });
  expect(empty.text()).toContain("No rows to draw.");
  expect(empty.find(".drawn").exists()).toBe(false);

  const partial = mount(MetricChart, {
    props: { file, metric: { columns, rows: [{ kind: "甲", amount: 20 }], truncation: { truncationHint: "Only the first 100 rows are shown." } } },
    global: { stubs: stub },
  });
  expect(partial.text()).toContain("Only the first 100 rows are shown.");
  expect(partial.find(".drawn").exists()).toBe(true);
});

it("fills the file from its own snapshot rows when no metric output is given", () => {
  const snapshot = { ...file, dataset: [{ id: "metric", dimensions: ["kind", "amount"], source: [{ kind: "甲", amount: 20 }] }] };
  const wrapper = mount(MetricChart, { props: { file: snapshot }, global: { stubs: stub } });
  const option = wrapper.findComponent(stub.EChart).props("option") as { series: { data?: unknown[] }[] };
  expect(option.series[0].data).toBeUndefined();
  expect(wrapper.find(".drawn").exists()).toBe(true);
});

it("states a file the boundary rejects rather than drawing it", () => {
  const wrapper = mount(MetricChart, { props: { file: { series: [] } }, global: { stubs: stub } });
  expect(wrapper.text()).toContain("INVALID_CHART_FILE");
  expect(wrapper.find(".drawn").exists()).toBe(false);
});
