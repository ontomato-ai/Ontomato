import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import ChartCard from "../ChartCard.vue";
import MetricCard from "../MetricCard.vue";
import CardParameterDialog from "../CardParameterDialog.vue";
import { createDashboardLoader } from "../utils/dashboardHelper";
import { formatValue, metricChartOption } from "../utils/metricCard";
import { ApiRequestError } from "../../../../utils/api";
import { workbenchI18n } from "../../../../i18n";

/**
 * A metric-reference card only presents the metric's final rows: the loader sends it to query-card by id while a
 * legacy card on the same board keeps its DSL path; the chart draws the rows' own values after the card's sort and
 * display limit; a failure shows the server's reason, never "no data"; the parameter form sends only edited keys.
 * Doubles: the dashboard API boundary, the chart drawing and the resize library.
 */
const api = vi.hoisted(() => ({
  legacyCalls: 0,
  cardCalls: [] as string[],
  saved: [] as unknown[],
  saveError: null as unknown,
}));
vi.mock("../../api", async () => {
  const { ApiRequestError } = await import("../../../../utils/api");
  const chart = {
    id: "c-new",
    name: "Revenue by region",
    query: { kind: "metric", metricId: "m-1", parameters: { year: 2026 } },
    chartType: "pie",
    fields: { name: "region", value: "revenue", share: "revenue_share" },
    sort: [{ field: "revenue", order: "desc" }],
    displayLimit: 2,
    formats: { revenue_share: { kind: "percent", scale: 100, decimals: 1 } },
  };
  const metric = { id: "n-new", name: "Total revenue", query: { kind: "metric", metricId: "m-2", parameters: {} }, valueField: "total" };
  return {
    fetchDashboardLocalDetail: async () => ({
      groups: [
        {
          id: "g1",
          title: "Sales",
          charts: [chart, { id: "c-old", name: "Old", chartType: "bar", dsl: { a: 1 }, conditions: [], fields: {} }],
          metrics: [metric],
        },
      ],
    }),
    getAnswerByDslConditionParam: async () => {
      api.legacyCalls += 1;
      return { data: [], rawData: [], fields: {}, dsl: {} };
    },
    getConditionsFromDsl: async () => [],
    queryDashboardCard: async (_dashboardId: string, cardId: string) => {
      api.cardCalls.push(cardId);
      if (cardId === "n-new")
        throw new ApiRequestError("Column total is not numeric", 422, { code: "CARD_OUTPUT_MISMATCH", error: "Column total is not numeric" });
      return {
        card: chart,
        metric: { id: "m-1", name: "Revenue", revision: "r1", status: "PUBLISHED" },
        columns: [
          { key: "region", label: "Region", type: null },
          { key: "revenue", label: "Revenue", type: null },
          { key: "revenue_share", label: "Share", type: null },
        ],
        rows: [
          { region: "North", revenue: 10, revenue_share: 0.1 },
          { region: "East", revenue: 60, revenue_share: 0.6 },
          { region: "West", revenue: 30, revenue_share: 0.3 },
        ],
        truncation: null,
      };
    },
    fetchCardParameterForm: async () => ({
      revision: "r1",
      fields: ["year", "region", "owner"].map((key) => ({
        type: "text", key, label: key, required: false, defaultValue: null, help: null, multiline: false, placeholder: null, maxLength: 200,
      })),
      values: { year: "2026", region: "", owner: "{{account.id}}" },
      readOnly: ["owner"],
    }),
    saveCardParameters: async (input: unknown) => {
      api.saved.push(input);
      if (api.saveError) throw api.saveError;
      return { cardId: "c-new", query: { kind: "metric", metricId: "m-1", parameters: { year: 2025 } }, revision: "r1" };
    },
  };
});
vi.mock("interactjs", () => ({
  default: Object.assign(() => ({ resizable: () => ({ unset: () => {} }) }), {
    modifiers: { restrictSize: () => ({}) },
  }),
}));

const i18n = workbenchI18n();
const t = i18n.global.t;
const plugins = [i18n, ElementPlus];

async function load() {
  let groups: any[] = [];
  await createDashboardLoader().loadDashboardById("d1", (next: any) => {
    groups = typeof next === "function" ? next(groups) : next;
  });
  return groups[0];
}

afterEach(() => {
  document.body.innerHTML = "";
  api.legacyCalls = 0;
  api.cardCalls = [];
  api.saved = [];
  api.saveError = null;
});

describe("metric-reference cards on a dashboard", () => {
  it("are read by id beside a legacy card, drawn from the metric's own values after sort and limit", async () => {
    const group = await load();
    expect(api.cardCalls.sort()).toEqual(["c-new", "n-new"]);
    expect(api.legacyCalls).toBe(1);

    const chart = group.charts[0];
    expect(chart.rows).toHaveLength(3);
    const series = chart.option.series[0];
    // No "others" slice, no recomputed totals: the two largest rows as the metric gave them.
    expect(series.data.map((d: any) => [d.name, d.value, d.share])).toEqual([
      ["East", 60, 0.6],
      ["West", 30, 0.3],
    ]);
    const tooltip = chart.option.tooltip.formatter({ name: "East", data: series.data[0] });
    expect(tooltip).toContain("Share: 60.0%");

    const card = mount(ChartCard, { props: { chart }, global: { plugins, stubs: { EChart: true } } });
    await card.find(".ai-chart-tool-btn[title='" + t("dashboard.showData") + "']").trigger("click");
    expect(card.find(".ai-chart-data-overlay").text()).toContain("Region");
  });

  it("shows a failed card's reason and clears its values instead of showing no data", async () => {
    const group = await load();
    const metric = group.metrics[0];
    expect(metric.state).toBe("error");
    expect(metric.rows).toEqual([]);
    expect(metric.error).toEqual({ code: "CARD_OUTPUT_MISMATCH", message: "Column total is not numeric" });

    const card = mount(MetricCard, { props: { metric }, global: { plugins } });
    const alert = card.find(".metric-error").text();
    expect(alert).toContain(t("dashboard.cardErrors.CARD_OUTPUT_MISMATCH"));
    expect(alert).toContain("Column total is not numeric");
    expect(card.text()).not.toContain(t("common.noData"));

    const chartCard = mount(ChartCard, {
      props: { chart: { ...group.charts[0], option: { __ragchatState: "error" }, rows: [], error: metric.error } },
      global: { plugins, stubs: { EChart: true } },
    });
    expect(chartCard.find(".chart-mask--error").text()).toContain("Column total is not numeric");
  });

  it("labels value-axis ticks by their own value, keeping the format's decimals for the data", () => {
    const option: any = metricChartOption(
      {
        id: "c",
        name: "Bodies by type",
        query: { kind: "metric", metricId: "m", parameters: {} },
        chartType: "bar",
        fields: { xAxis: "type", yAxis: "count" },
        formats: { count: { kind: "number", decimals: 0 }, share: { kind: "percent", scale: 100, decimals: 0 } },
      },
      { columns: [], rows: [{ type: "Planet", count: 3 }, { type: "Moon", count: 1 }] },
    );
    const ticks = [0, 0.5, 1, 1.5, 2, 2.5, 3].map(option.yAxis.axisLabel.formatter);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks[1]).toBe("0.5");
    expect(option.series[0].label.formatter({ value: 3 })).toBe("3");

    const scatter: any = metricChartOption(
      {
        id: "s",
        name: "Share",
        query: { kind: "metric", metricId: "m", parameters: {} },
        chartType: "scatter",
        fields: { xAxis: "count", yAxis: "share" },
        formats: { count: { kind: "number", decimals: 0 }, share: { kind: "percent", scale: 100, decimals: 0 } },
      },
      { columns: [], rows: [{ count: 1, share: 0.25 }] },
    );
    expect(scatter.xAxis.axisLabel.formatter(0.5)).toBe("0.5");
    expect(scatter.yAxis.axisLabel.formatter(0.025)).toBe("2.5%");
  });

  it("formats only as the card says: no format keeps the value, a missing value is not zero", () => {
    expect(formatValue(0.1234)).toBe("0.1234");
    expect(formatValue(null, { kind: "number", decimals: 2 })).toBe("—");
    expect(formatValue(12.5, { kind: "percent", scale: 1 })).toBe("12.5%");
  });
});

describe("the card parameter form", () => {
  async function openDialog() {
    const wrapper = mount(CardParameterDialog, {
      props: { modelValue: false, dashboardId: "d1", card: { id: "c-new", name: "Revenue by region" } },
      global: { plugins, stubs: { transition: false } },
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    return wrapper;
  }

  it("sends only the keys the reader edited, never the read-only ones", async () => {
    const wrapper = await openDialog();
    expect(document.body.textContent).toContain("{{account.id}}");
    const input = document.querySelector<HTMLInputElement>("[data-field='year'] input")!;
    input.value = "2025";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLButtonElement>(".el-dialog__footer .el-button--primary")!.click();
    await flushPromises();
    expect(api.saved).toEqual([{ dashboardId: "d1", cardId: "c-new", revision: "r1", values: { year: "2025" } }]);
    expect(wrapper.emitted("saved")?.[0]).toEqual(["c-new", { kind: "metric", metricId: "m-1", parameters: { year: 2025 } }]);
    wrapper.unmount();
  });

  it("puts the metric's field errors on their fields", async () => {
    api.saveError = new ApiRequestError("Invalid parameters", 422, {
      code: "METRIC_PARAMETERS_INVALID",
      error: "Invalid parameters",
      details: { errors: [{ field: "/values/year", code: "invalid_number", message: "Not a year" }] },
    });
    const wrapper = await openDialog();
    const input = document.querySelector<HTMLInputElement>("[data-field='year'] input")!;
    input.value = "abc";
    input.dispatchEvent(new Event("input"));
    await flushPromises();
    document.querySelector<HTMLButtonElement>(".el-dialog__footer .el-button--primary")!.click();
    await flushPromises();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-field='year'] .el-form-item__error")?.textContent).toContain("Not a year"),
    );
    expect(wrapper.emitted("saved")).toBeUndefined();
    wrapper.unmount();
  });
});
