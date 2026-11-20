import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { englishMessages, managerMessageTree } from "@ontomato/ontology-manager/i18n";
import { dashboardChartFileSchema } from "@ontomato/contracts/dashboard";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { projectionKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { panelMemberKey, type PanelMemberContext } from "../../../../../packages/apps-sdk/src/panel/member";
import type { MemberDataState } from "../../../../../packages/apps-sdk/src/panel/direct";
import MetricChart from "../../../../../packages/apps-sdk/src/base/MetricChart.vue";

/*
 * MetricChart as a member of a directly rendered panel: the platform supplies its `template` (the source card's chart
 * file) and its `result` (the MetricView's output, the card's owner laying the bound values over the card's saved
 * parameters), and the chart draws them, or shows the state of whichever is not ready in the product's one
 * presentation. It sends no request of its own and never draws a chart without both.
 *
 * The mistakes this catches: the member reading through the frame's chart client (which a directly rendered panel has
 * none of); a chart drawn from the drawing alone, or from an earlier output once the output is not ready; an owner's
 * empty answer, refusal or reason shown as anything but its one presentation.
 */

// The platform's ECharts instance is the chart element's own; here it shows what it was asked to draw.
vi.mock("../../../../../packages/foundation-ui/src/chart/EChart.vue", () => ({
  default: defineComponent({ props: ["option"], setup: (props) => () => h("div", { class: "drawn", "data-rows": JSON.stringify(props.option.dataset?.[0]?.source ?? []) }) }),
}));

const chartFile = dashboardChartFileSchema.parse({
  name: "enrolment.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["term", "students"], source: [] }],
    xAxis: { type: "category" },
    yAxis: { type: "value" },
    series: [{ id: "series-0", type: "bar", datasetId: "metric", encode: { x: "term", y: "students" } }],
    ontomato: { display: { formats: { students: { kind: "number" } } } },
  },
});
const output = {
  columns: [{ key: "term", label: "Term", type: "string" }, { key: "students", label: "Students", type: "number" }],
  rows: [{ term: "2025 autumn", students: 31 }, { term: "2026 spring", students: 28 }],
  truncation: null,
};

function mounted() {
  const template = shallowRef<MemberDataState>({ status: "loading" });
  const result = shallowRef<MemberDataState>({ status: "loading" });
  const used: string[] = [];
  const projection = { id: "enrolment-chart", componentId: "@ontomato/sdk:MetricChart" } as unknown as DirectProjection;
  const member: PanelMemberContext = {
    key: "chart",
    projection,
    inputs: computed(() => ({})),
    // A chart offers no operation.
    operations: computed(() => ({ status: "ready" as const, value: {} })),
    data: {
      use(name) {
        used.push(name);
        if (name === "template") return computed(() => template.value);
        if (name === "result") return computed(() => result.value);
        throw new Error(`MetricChart reads no datum '${name}'`);
      },
      read: () => { throw new Error("MetricChart asks for no read of its own"); },
    },
  };
  const element = document.createElement("div");
  document.body.append(element);
  createApp({
    setup() {
      return () => h(MetricChart);
    },
  })
    .provide(projectionKey, { slot: "chart", projection: projection as never, inputs: {} })
    .provide(panelMemberKey, () => member)
    .use(createI18n({ legacy: false, locale: "en", messages: { en } }))
    .use(ElementPlus)
    .mount(element);
  return { element, template, result, used };
}

/** The page's words as the shell gives them: the platform's and the manager's, in one tree. */
const en = { ...publicEn, ...managerMessageTree(englishMessages) };

const drawnRows = (element: HTMLElement) => JSON.parse(element.querySelector(".drawn")?.getAttribute("data-rows") ?? "null");

afterEach(() => {
  document.body.innerHTML = "";
});

it("draws the card's chart file with the output the platform supplies, once both are ready", async () => {
  const { element, template, result, used } = mounted();
  expect(used).toEqual(["template", "result"]);
  await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).not.toBeNull());

  template.value = { status: "ready", value: { chartFile, parameters: { term: "2025 autumn" } } };
  await vi.waitFor(() => expect(element.querySelector('[aria-busy="true"]')).not.toBeNull());
  expect(element.querySelector(".drawn")).toBeNull();

  result.value = { status: "ready", value: output };
  await vi.waitFor(() => expect(drawnRows(element)).toEqual(output.rows), { timeout: 5000 });

  // A new output on its way: the earlier one is not drawn meanwhile.
  result.value = { status: "loading" };
  await vi.waitFor(() => expect(element.querySelector(".drawn")).toBeNull());
});

it("shows the owner's empty answer, a refusal and a reason in the product's one presentation, never a chart", async () => {
  const { element, template, result } = mounted();
  template.value = { status: "ready", value: { chartFile, parameters: {} } };

  result.value = { status: "empty" };
  await vi.waitFor(() => expect(element.querySelector('[data-state="empty"]')?.textContent).toBe(englishMessages.ontology.ovNoChartData));
  expect(element.querySelector(".drawn")).toBeNull();

  result.value = { status: "error", message: "Parameter term is required" };
  await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent).toBe("Parameter term is required"));

  // The card itself unreadable: its state stands for the chart, whatever the output is.
  result.value = { status: "ready", value: output };
  template.value = { status: "forbidden" };
  await vi.waitFor(() => expect(element.querySelector('[data-state="forbidden"]')?.textContent).toBe(publicEn.platform.dataForbidden));
  expect(element.querySelector(".drawn")).toBeNull();
});

it("draws a cut output with the owner's note", async () => {
  const { element, template, result } = mounted();
  template.value = { status: "ready", value: { chartFile, parameters: {} } };
  result.value = { status: "ready", value: { ...output, truncation: { truncated: true, rowLimit: 2, truncationHint: "Only the first 2 rows are shown" } } };
  await vi.waitFor(() => expect(element.querySelector('[role="note"]')?.textContent).toBe("Only the first 2 rows are shown"), { timeout: 5000 });
  expect(drawnRows(element)).toEqual(output.rows);
});
