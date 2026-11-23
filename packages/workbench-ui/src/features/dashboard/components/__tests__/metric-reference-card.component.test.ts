import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import ChartCard from "../ChartCard.vue";
import MetricCard from "../MetricCard.vue";
import CardParameterDialog from "../CardParameterDialog.vue";
import DashboardPanel from "../DashboardPanel.vue";
import MetricSourceDialog from "../MetricSourceDialog.vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { createDashboardLoader } from "../utils/dashboardHelper";
import { chartCardTable, formatValue, type MetricCardView } from "../utils/metricCard";
import { ApiRequestError } from "../../../../utils/api";
import { workbenchI18n } from "../../../../i18n";

/**
 * A metric-reference card only presents the metric's final rows: the loader reads it by its id, the platform's chart
 * fills the card's own `.chart.json` file with that output, and the card sorts and limits only for display. A failure
 * shows the server's reason, never "no data"; the parameter form sends only edited keys. Doubles: the dashboard API
 * boundary, the platform's chart and the resize library.
 */
const api = vi.hoisted(() => ({
  cardCalls: [] as string[],
  paramFormCalls: [] as string[],
  paramFormOverride: null as ((dashboardId: string, cardId: string) => Promise<unknown>) | null,
  saved: [] as unknown[],
  saveError: null as unknown,
  chartName: null as string | null,
}));
vi.mock("../../api", async () => {
  const { ApiRequestError } = await import("../../../../utils/api");
  const file = {
    name: "revenue.chart.json",
    content: {
      dataset: [{ id: "metric", dimensions: [], source: [] }],
      series: [{ id: "revenue", type: "treemap", datasetId: "metric" }],
      ontomato: { bindings: [{ seriesId: "revenue", shape: "items", fields: { name: "region", value: "revenue", share: "revenue_share" } }] },
    },
  };
  const chart = {
    id: "c-new",
    name: "Revenue by region",
    query: { kind: "metric", metricId: "m-1", parameters: { year: 2026 } },
    chartFile: file,
    layout: { colSpan: 12, rowSpan: 1 },
  };
  const metric = { id: "n-new", name: "Total revenue", query: { kind: "metric", metricId: "m-2", parameters: {} }, valueField: "total" };
  return {
    fetchDashboardLocalDetail: async () => ({ id: "d1", groups: [{ id: "g1", title: "Sales", charts: [chart], metrics: [metric] }] }),
    queryDashboardCard: async (_dashboardId: string, cardId: string) => {
      api.cardCalls.push(cardId);
      if (cardId === "n-new")
        throw new ApiRequestError("Column total is not numeric", 422, { code: "CARD_OUTPUT_MISMATCH", error: "Column total is not numeric" });
      return {
        card: { id: chart.id, name: chart.name, query: chart.query },
        file,
        metric: { id: "m-1", name: api.chartName ?? "Revenue", revision: "r1", status: "PUBLISHED" },
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
    fetchCardParameterForm: async (dashboardId: string, cardId: string) => {
      api.paramFormCalls.push(cardId);
      if (api.paramFormOverride) return api.paramFormOverride(dashboardId, cardId);
      if (cardId === "n-new") {
        return {
          revision: "r2",
          fields: ["quarter", "currency"].map((key) => ({
            key, label: key, required: false, defaultValue: null, help: null, placeholder: null, maxLength: 200, multiline: false,
            type: "text",
          })),
          values: { quarter: "Q1", currency: "CNY" },
          readOnly: [],
        };
      }
      return {
        revision: "r1",
        fields: ["year", "region", "owner"].map((key) => ({
          key, label: key, required: false, defaultValue: null, help: null, placeholder: null, maxLength: 200, multiline: false,
          type: "text",
        })),
        values: { year: "2026", region: "", owner: "{{account.id}}" },
        readOnly: ["owner"],
      };
    },
    saveCardParameters: async (input: { cardId?: string; revision?: string } & Record<string, unknown>) => {
      api.saved.push(input);
      if (api.saveError) throw api.saveError;
      return {
        cardId: input.cardId ?? "c-new",
        query: { kind: "metric", metricId: "m-1", parameters: { year: 2025 } },
        revision: input.revision ?? "r1",
      };
    },
    prepareDashboardAgentConfirm: async () => ({
      intentId: "intent-auto",
      autoMode: true,
      questionId: null,
      label: "Save card parameters",
    }),
    renameDashboard: async () => true,
    modifyResultSetName: async () => true,
    deleteResultSet: async () => true,
    deleteDimension: async () => true,
    deleteMetric: async () => true,
    modifyDashboardLayout: async () => true,
    modifyDimensionName: async () => true,
    modifyMetricName: async () => true,
    createDimension: async () => ({ id: "g-new" }),
  };
});
/** The platform's chart, drawn from a file and this output; the double states what it was given. */
vi.mock("@ontomato/foundation-ui/chart", () => ({
  MetricChart: {
    name: "MetricChart",
    props: ["file", "metric", "height", "empty"],
    template: '<div class="drawn-chart" />',
  },
  useChartTheme: () => ({ value: {} }),
}));
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
  api.cardCalls = [];
  api.paramFormCalls = [];
  api.paramFormOverride = null;
  api.saved = [];
  api.saveError = null;
  api.chartName = null;
});

describe("metric-reference cards on a dashboard", () => {
  it("reads every card by its id and draws the card's file from the metric's own values", async () => {
    const group = await load();
    expect(api.cardCalls.sort()).toEqual(["c-new", "n-new"]);

    const chart = group.charts[0];
    expect(chart.state).toBe("ready");
    expect(chart.rows).toHaveLength(3);
    expect(chart.chartFile.name).toBe("revenue.chart.json");

    const card = mount(ChartCard, { props: { chart }, global: { plugins, stubs: { EChart: true } } });
    const drawn = card.findComponent({ name: "MetricChart" });
    expect(drawn.props("file")).toEqual(chart.chartFile.content);
    expect(drawn.props("metric")).toMatchObject({ rows: chart.rows, columns: chart.columns });

    await card.find(".ai-chart-tool-btn[title='" + t("dashboard.showData") + "']").trigger("click");
    expect(card.find(".ai-chart-data-overlay").text()).toContain("Region");
  });

  it("gives the platform's chart the card's own room, not a page-sized default", async () => {
    const group = await load();
    const card = mount(ChartCard, { props: { chart: group.charts[0] }, global: { plugins, stubs: { EChart: true } } });
    // The card is one tile of the board: the chart fills it, and its own padding comes out of that height.
    expect(card.findComponent({ name: "MetricChart" }).props("height")).toBe("100%");
    expect(card.find(".chart-wrapper").exists()).toBe(true);
    card.unmount();
  });

  it("draws the rows the file sorts and limits, and no slice the metric did not give", async () => {
    const group = await load();
    const displayed = chartCardTable(
      {
        dataset: [{ id: "metric", dimensions: ["region", "revenue", "revenue_share"], source: [] }],
        series: [{ id: "revenue", type: "treemap", datasetId: "metric" }],
        ontomato: {
          bindings: [{ seriesId: "revenue", shape: "items", fields: { name: "region", value: "revenue", share: "revenue_share" } }],
          display: { sort: [{ field: "revenue", order: "desc" }], displayLimit: 2, formats: { revenue_share: { kind: "percent", scale: 100, decimals: 1 } } },
        },
      },
      { columns: [{ key: "region", label: "Region", type: null }, { key: "revenue", label: "Revenue", type: null }, { key: "revenue_share", label: "Share", type: null }], rows: group.charts[0].rows, truncation: null },
    );
    expect(displayed.columns).toEqual(["Region", "Revenue", "Share"]);
    expect(displayed.rows).toEqual([["East", "60", "60.0%"], ["West", "30", "30.0%"]]);
  });

  it("labels value-axis ticks by their own value, keeping the format's decimals for the data", async () => {
    const { fillChartFile } = await import("@ontomato/contracts/chart-data");
    const { chartFormats } = await import("@ontomato/contracts/chart-presentation");
    const file = {
      dataset: [{ id: "metric", dimensions: ["type", "count"], source: [] }],
      xAxis: { type: "category" },
      yAxis: { type: "value" },
      series: [{ id: "count", type: "bar", datasetId: "metric", encode: { x: "type", y: "count" }, label: { show: true } }],
      ontomato: { display: { formats: { count: { kind: "number", decimals: 0 } } } },
    };
    const filled = fillChartFile(file, {
      columns: [{ key: "type" }, { key: "count" }],
      rows: [{ type: "Planet", count: 3 }, { type: "Moon", count: 1 }],
    });
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    const option: any = chartFormats(filled.option, filled.presentation);
    const ticks = [0, 0.5, 1, 1.5, 2, 2.5, 3].map(option.yAxis.axisLabel.formatter);
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks[1]).toBe("0.5");
    expect(option.series[0].label.formatter({ value: 3 })).toBe("3");
  });

  it("shows a failed card's reason and clears its values instead of showing no data", async () => {
    const group = await load();
    const metric = group.metrics[0];
    expect(metric.state).toBe("error");
    expect(metric.rows).toEqual([]);
    expect(metric.error).toMatchObject({ code: "CARD_OUTPUT_MISMATCH", message: "Column total is not numeric" });

    const card = mount(MetricCard, { props: { metric }, global: { plugins } });
    const alert = card.find(".metric-error").text();
    expect(alert).toContain(t("dashboard.cardErrors.CARD_OUTPUT_MISMATCH"));
    expect(alert).toContain("Column total is not numeric");
    expect(card.text()).not.toContain(t("common.noData"));

    const chartCard = mount(ChartCard, {
      props: { chart: { ...group.charts[0], state: "error", rows: [], error: metric.error } },
      global: { plugins, stubs: { EChart: true } },
    });
    expect(chartCard.find(".chart-mask--error").text()).toContain("Column total is not numeric");
  });

  it("formats only as the card says: no format keeps the value, a real zero stays zero, a missing value is not zero", () => {
    expect(formatValue(0.1234)).toBe("0.1234");
    expect(formatValue(0, { kind: "number", decimals: 2 })).toBe("0.00");
    expect(formatValue(null, { kind: "number", decimals: 2 })).toBe("—");
    expect(formatValue(12.5, { kind: "percent", scale: 1 })).toBe("12.5%");
  });

  it("says a partial result is partial instead of saying there is no data", async () => {
    const group = await load();
    const truncation = { truncated: true, rowLimit: 100000, truncationHint: "Intermediate rows reached the processing cap." };
    const card = mount(ChartCard, {
      props: { chart: { ...group.charts[0], rows: [], state: "empty", truncation } },
      global: { plugins, stubs: { EChart: true } },
    });
    const mask = card.find(".chart-mask").text();
    expect(mask).toContain(t("chat.partialResult", { rowLimit: 100000 }));
    expect(mask).toContain(truncation.truncationHint);
    expect(mask).not.toContain(t("common.noData"));
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
    expect(wrapper.emitted("saved")?.[0]).toEqual(["c-new"]);
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

  it("fills live values through fillValues, keeps them unsaved until saveFromAction, and blocks read-only or unsaved overwrites", async () => {
    const wrapper = await openDialog();
    const vm = wrapper.vm as unknown as {
      fillValues: (values: Record<string, unknown>, overwriteUnsaved?: boolean) => Promise<unknown>;
      saveFromAction: (operation: string, agentRun: { sessionId: string; runId: string; toolCallId: string }) => Promise<unknown>;
    };
    const filled = await vm.fillValues({ year: "2024", owner: "someone" });
    await flushPromises();
    expect(filled).toEqual({
      ok: true,
      member: "card.parameters",
      filledFields: ["year"],
      rejectedFields: [{ path: "owner", reason: "read_only", message: "Parameter 'owner' is read-only." }],
    });
    expect(document.querySelector<HTMLInputElement>("[data-field='year'] input")!.value).toBe("2024");
    expect(document.body.textContent).toContain("2026");
    expect(document.body.textContent).toContain("2024");
    expect(api.saved).toEqual([]);

    const blocked = await vm.fillValues({ year: "2023" });
    expect(blocked).toMatchObject({ ok: false, reason: "blocked_unsaved", member: "card.parameters" });

    const saved = await vm.saveFromAction("card.parameters.save", { sessionId: "s1", runId: "r1", toolCallId: "t1" });
    await flushPromises();
    expect(saved).toEqual({ ok: true, kind: "executed", operation: "card.parameters.save", intentId: "intent-auto" });
    expect(api.saved).toEqual([{ dashboardId: "d1", cardId: "c-new", revision: "r1", values: { year: "2024" } }]);
    wrapper.unmount();
  });

  it("reloads the form and discards stale edits/responses when switching cards while already open", async () => {
    let resolveSlowA!: (value: unknown) => void;
    let calls = 0;
    api.paramFormOverride = (_dashboardId, cardId) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          revision: "r1",
          fields: [{ key: "year", label: "year", required: false, defaultValue: null, help: null, placeholder: null, maxLength: 200, multiline: false, type: "text" }],
          values: { year: "2026" },
          readOnly: [],
        });
      }
      if (cardId === "c-slow") {
        return new Promise((resolve) => {
          resolveSlowA = resolve;
        });
      }
      return Promise.resolve({
        revision: "r2",
        fields: [{ key: "quarter", label: "quarter", required: false, defaultValue: null, help: null, placeholder: null, maxLength: 200, multiline: false, type: "text" }],
        values: { quarter: "Q1" },
        readOnly: [],
      });
    };

    const wrapper = await openDialog();
    const inputA = document.querySelector<HTMLInputElement>("[data-field='year'] input")!;
    inputA.value = "2025";
    inputA.dispatchEvent(new Event("input"));
    await flushPromises();

    // Switch to a slow card, then immediately switch again to n-new before c-slow resolves.
    await wrapper.setProps({ card: { id: "c-slow", name: "Slow card" } });
    await wrapper.setProps({ card: { id: "n-new", name: "Total revenue" } });
    await flushPromises();

    // Even if the superseded c-slow request resolves late, it must not overwrite n-new's form.
    resolveSlowA({
      revision: "r-slow",
      fields: [{ key: "year", label: "year", required: false, defaultValue: null, help: null, placeholder: null, maxLength: 200, multiline: false, type: "text" }],
      values: { year: "1999" },
      readOnly: [],
    });
    await flushPromises();

    expect(document.querySelector("[data-field='year']")).toBeNull();
    const inputB = document.querySelector<HTMLInputElement>("[data-field='quarter'] input")!;
    expect(inputB.value).toBe("Q1");
    inputB.value = "Q4";
    inputB.dispatchEvent(new Event("input"));
    await flushPromises();

    document.querySelector<HTMLButtonElement>(".el-dialog__footer .el-button--primary")!.click();
    await flushPromises();
    expect(api.saved).toEqual([{ dashboardId: "d1", cardId: "n-new", revision: "r2", values: { quarter: "Q4" } }]);
    wrapper.unmount();
  });

  it("blocks switching to another card with unsaved edits and cleanly reloads when clean or explicitly overwritten", async () => {
    const wrapper = mount(DashboardPanel, {
      props: { dashboardId: "d1" },
      global: {
        plugins,
        stubs: {
          transition: false,
          ChartCard: { name: "ChartCard", props: ["chart"], template: "<div class='stub-chart' />" },
          MetricCard: { name: "MetricCard", props: ["metric"], template: "<div class='stub-metric' />" },
        },
      },
    });
    await flushPromises();

    const vm = wrapper.vm as unknown as {
      selectCardById: (id: string) => boolean;
      fillForm: (request: { member?: string; values: Record<string, unknown>; overwriteUnsaved?: boolean }) => Promise<unknown>;
      executeAction: (request: { operation: string; input?: Record<string, unknown>; agentRun?: { sessionId: string; runId: string; toolCallId: string } }) => Promise<unknown>;
    };
    const agentRun = { sessionId: "s1", runId: "r1", toolCallId: "t1" };

    // Open card A (c-new) and create unsaved edits.
    expect(await vm.executeAction({ operation: "card.parameters.open", input: { cardId: "c-new" } })).toEqual({
      ok: true,
      kind: "executed",
      operation: "card.parameters.open",
    });
    await flushPromises();
    expect(await vm.fillForm({ member: "card.parameters", values: { year: "2025" } })).toMatchObject({
      ok: true,
      filledFields: ["year"],
    });

    // Attempting to open card B while card A has unsaved edits must be rejected without touching A.
    const blockedOpen = await vm.executeAction({ operation: "card.parameters.open", input: { cardId: "n-new" } });
    expect(blockedOpen).toMatchObject({ ok: false, reason: "action_unavailable", operation: "card.parameters.open" });
    expect(document.querySelector<HTMLInputElement>("[data-field='year'] input")!.value).toBe("2025");

    // Selecting card B in page state and calling fillForm without overwriteUnsaved must also be blocked.
    expect(vm.selectCardById("n-new")).toBe(true);
    const blockedFill = await vm.fillForm({ member: "card.parameters", values: { quarter: "Q2" } });
    expect(blockedFill).toMatchObject({ ok: false, reason: "blocked_unsaved", member: "card.parameters" });
    expect(document.querySelector<HTMLInputElement>("[data-field='year'] input")!.value).toBe("2025");

    // Passing overwriteUnsaved: true switches to card B, loads B's form, and fills B cleanly.
    const filledB = await vm.fillForm({ member: "card.parameters", values: { quarter: "Q2" }, overwriteUnsaved: true });
    await flushPromises();
    expect(filledB).toEqual({ ok: true, member: "card.parameters", filledFields: ["quarter"] });
    expect(await vm.executeAction({ operation: "card.parameters.save", agentRun })).toEqual({
      ok: true,
      kind: "executed",
      operation: "card.parameters.save",
      intentId: "intent-auto",
    });
    expect(api.saved).toEqual([{ dashboardId: "d1", cardId: "n-new", revision: "r2", values: { quarter: "Q2" } }]);

    // When clean, opening card A then switching straight to card B reloads B and submits only B's values.
    api.saved = [];
    expect(await vm.executeAction({ operation: "card.parameters.open", input: { cardId: "c-new" } })).toEqual({
      ok: true,
      kind: "executed",
      operation: "card.parameters.open",
    });
    expect(await vm.executeAction({ operation: "card.parameters.open", input: { cardId: "n-new" } })).toEqual({
      ok: true,
      kind: "executed",
      operation: "card.parameters.open",
    });
    expect(await vm.fillForm({ member: "card.parameters", values: { quarter: "Q3" } })).toEqual({
      ok: true,
      member: "card.parameters",
      filledFields: ["quarter"],
    });
    expect(await vm.executeAction({ operation: "card.parameters.save", agentRun })).toEqual({
      ok: true,
      kind: "executed",
      operation: "card.parameters.save",
      intentId: "intent-auto",
    });
    expect(api.saved).toEqual([{ dashboardId: "d1", cardId: "n-new", revision: "r2", values: { quarter: "Q3" } }]);
    wrapper.unmount();
  });
});

describe("view metric", () => {
  it("reads as the metric's name, localized status and parameter values, and opens the metric", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { render: () => null } },
        { ...platformRoutes.metric, component: { render: () => null } },
      ],
    });
    await router.push("/");
    const card = {
      id: "c-new",
      name: "Revenue by region",
      title: "Revenue by region",
      query: { kind: "metric", metricId: "m-1", parameters: { year: 2026, region: null } },
      chartFile: { name: "revenue.chart.json", content: {} },
      metric: { id: "m-1", name: "Revenue", revision: "rev-internal-42", status: "PENDING_REVIEW" },
    };
    const wrapper = mount(MetricSourceDialog, {
      props: { modelValue: true, card: card as unknown as MetricCardView },
      global: { plugins: [...plugins, router], stubs: { transition: false } },
    });
    await flushPromises();
    const text = document.querySelector(".el-dialog")!.textContent!;
    expect(text).toContain("Revenue");
    expect(text).toContain(t("dashboard.metricStatus.PENDING_REVIEW"));
    expect(text).toContain("2026");
    expect(text).toContain("—");
    expect(text).not.toContain("rev-internal-42");
    expect(text).not.toContain("{");

    document.querySelector<HTMLButtonElement>(".el-dialog__footer .el-button--primary")!.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe(platformRoutes.metric.name);
    expect(router.currentRoute.value.params.id).toBe("m-1");
    wrapper.unmount();
  });
});
