import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import ElementPlus from "element-plus";
import type { DisplayPageController } from "@ontomato/agent-shell-ui";
import { MetricChart } from "@ontomato/foundation-ui/chart";
import DashboardHome from "../DashboardHome.vue";
import { workbenchI18n } from "../../../../i18n";

const api = vi.hoisted(() => ({
  renameBoard: [] as unknown[],
  renameGroup: [] as unknown[],
  renameChart: [] as unknown[],
  renameMetric: [] as unknown[],
  layouts: [] as unknown[],
  savedParams: [] as unknown[],
  confirmCalls: [] as Array<Record<string, unknown>>,
  confirmMode: { autoMode: false, nextSeq: 1 },
  detailReads: 0,
  listReads: 0,
}));

const savedChartFile = {
  name: "revenue-bar.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["region", "revenue"], source: [] }],
    series: [{ id: "revenue", type: "bar", datasetId: "metric", encode: { x: "region", y: "revenue" } }],
    ontomato: {},
  },
};

const lineChartFile = {
  name: "revenue-line.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["region", "revenue"], source: [] }],
    series: [{ id: "revenue", type: "line", datasetId: "metric", encode: { x: "region", y: "revenue" } }],
    ontomato: {},
  },
};

const board = {
  id: "d1",
  ownerId: "u1",
  name: "Sales",
  createdAt: 0,
  updatedAt: 0,
  groups: [
    {
      id: "g1",
      title: "Overview",
      charts: [
        {
          id: "c1",
          name: "Revenue by region",
          query: { kind: "metric", metricId: "m-1", parameters: {} },
          chartFile: savedChartFile,
          layout: { colSpan: 12, rowSpan: 1 },
        },
      ],
      metrics: [
        {
          id: "n1",
          name: "Total revenue",
          query: { kind: "metric", metricId: "m-2", parameters: {} },
          valueField: "total",
          unit: "CNY",
          layout: { colSpan: 4, rowSpan: 1 },
        },
      ],
    },
  ],
};

vi.mock("../../api", () => ({
  fetchDashboardList: async () => {
    api.listReads += 1;
    return [{ id: "d1", name: "Sales", createdAt: 0, updatedAt: 0 }];
  },
  fetchDashboardLocalDetail: async () => {
    api.detailReads += 1;
    return structuredClone(board);
  },
  queryDashboardCard: async (_dashboardId: string, cardId: string) =>
    cardId === "c1"
      ? {
          card: { id: "c1", name: "Revenue by region", query: { kind: "metric", metricId: "m-1", parameters: {} } },
          file: savedChartFile,
          metric: { id: "m-1", name: "Revenue", revision: "r1", status: "PUBLISHED" },
          columns: [
            { key: "region", label: "Region", type: null },
            { key: "revenue", label: "Revenue", type: null },
          ],
          rows: [{ region: "East", revenue: 60 }],
          truncation: null,
        }
      : {
          card: { id: "n1", name: "Total revenue", query: { kind: "metric", metricId: "m-2", parameters: {} }, valueField: "total" },
          metric: { id: "m-2", name: "Total", revision: "r1", status: "PUBLISHED" },
          columns: [{ key: "total", label: "Total", type: null }],
          rows: [{ total: 60 }],
          truncation: null,
        },
  renameDashboard: async (...args: unknown[]) => { api.renameBoard.push(args); return true; },
  modifyDimensionName: async (...args: unknown[]) => { api.renameGroup.push(args); return true; },
  modifyResultSetName: async (...args: unknown[]) => { api.renameChart.push(args); return true; },
  modifyMetricName: async (...args: unknown[]) => { api.renameMetric.push(args); return true; },
  modifyDashboardLayout: async (...args: unknown[]) => { api.layouts.push(args); return true; },
  fetchCardParameterForm: async () => ({
    revision: "r1",
    fields: [
      { key: "year", label: "Year", required: false, defaultValue: null, help: null, placeholder: null, maxLength: 200, multiline: false, type: "text" },
    ],
    values: { year: "2026" },
    readOnly: [],
  }),
  saveCardParameters: async (input: unknown) => {
    api.savedParams.push(input);
    return { cardId: "c1", query: { kind: "metric", metricId: "m-1", parameters: {} }, revision: "r1" };
  },
  prepareDashboardAgentConfirm: async (input: Record<string, unknown>) => {
    api.confirmCalls.push(input);
    const seq = api.confirmMode.nextSeq++;
    const label = input.operation === "board.save" ? "Save dashboard changes" : "Save card parameters";
    return {
      intentId: `intent-${seq}`,
      autoMode: api.confirmMode.autoMode,
      questionId: api.confirmMode.autoMode ? null : `question-${seq}`,
      label,
    };
  },
  createDimension: async () => true,
  deleteDimension: async () => true,
  deleteMetric: async () => true,
}));

vi.mock("interactjs", () => ({
  default: Object.assign(() => ({ resizable: () => ({ unset: () => {} }) }), {
    modifiers: { restrictSize: () => ({}) },
  }),
}));

const agentRun = { sessionId: "sess-1", runId: "run-1", toolCallId: "tc-1" };

async function mountDashboardHome(query: Record<string, string> = { dashboardId: "d1", cardId: "c1" }) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  await router.push({ path: "/", query });
  await router.isReady();
  let controller: DisplayPageController | null = null;
  const dirtyEvents: boolean[] = [];
  const wrapper = mount(DashboardHome, {
    props: {
      registerPageController(next: DisplayPageController) {
        controller = next;
        return () => { controller = null; };
      },
      onDisplayDirty(dirty: boolean) {
        dirtyEvents.push(dirty);
      },
    },
    global: {
      plugins: [workbenchI18n(), createPinia(), router, ElementPlus],
      stubs: { EChart: true, transition: false },
    },
  });
  await flushPromises();
  return { wrapper, router, controller: controller!, dirtyEvents };
}

afterEach(() => {
  api.renameBoard = [];
  api.renameGroup = [];
  api.renameChart = [];
  api.renameMetric = [];
  api.layouts = [];
  api.savedParams = [];
  api.confirmCalls = [];
  api.confirmMode = { autoMode: false, nextSeq: 1 };
  api.detailReads = 0;
  api.listReads = 0;
  document.body.innerHTML = "";
});

describe("dashboard whole-board live preview and confirmed remote control", () => {
  it("overlays unsaved whole-board preview (rename, chartFile, layout), protects unsaved edits, and supports human save/discard", async () => {
    const { wrapper, controller, dirtyEvents } = await mountDashboardHome();

    // 1. Rejects unknown group/chart/metric IDs cleanly.
    const rejected = await controller.fillForm!({
      member: "board",
      values: {
        groupNames: { missingGroup: "X" },
        cardNames: { missingCard: "Y" },
      },
    });
    expect(rejected).toMatchObject({
      ok: false,
      reason: "all_fields_rejected",
      member: "board",
      rejectedFields: [
        expect.objectContaining({ path: "groupNames.missingGroup", reason: "unknown_field" }),
        expect.objectContaining({ path: "cardNames.missingCard", reason: "unknown_field" }),
      ],
    });
    expect(wrapper.find(".board-preview-bar").exists()).toBe(false);

    // 2. Applies flat fields including dashboard name, layout, and chartFile replacement.
    const filled = await controller.fillForm!({
      member: "board",
      values: {
        name: "Q4 Sales",
        groups: [
          {
            id: "g1",
            title: "Q4 Overview",
            charts: [
              { id: "c1", name: "Revenue Trend", layout: { colSpan: 24, rowSpan: 2 }, chartFile: lineChartFile },
            ],
            metrics: [
              { id: "n1", name: "Q4 Total", layout: { colSpan: 6, rowSpan: 1 } },
            ],
          },
        ],
      },
    });
    await flushPromises();
    expect(filled).toEqual({ ok: true, member: "board", filledFields: ["name", "groups"] });
    expect(dirtyEvents.at(-1)).toBe(true);
    expect(wrapper.find(".board-preview-bar").exists()).toBe(true);
    expect(wrapper.find(".group-title").text()).toBe("Q4 Overview");
    expect(wrapper.find(".chart-container h3").text()).toBe("Revenue Trend");
    expect(wrapper.find(".metric-container .title").text()).toBe("Q4 Total");
    // Chart renders the new chartFile using the card's existing live queried rows.
    const metricChart = wrapper.findComponent(MetricChart);
    expect(metricChart.props("file")).toEqual(lineChartFile.content);
    expect(metricChart.props("metric").rows).toEqual([{ region: "East", revenue: 60 }]);
    // Nothing written to backend yet.
    expect(api.renameBoard).toEqual([]);
    expect(api.layouts).toEqual([]);

    // 3. Protects existing unsaved preview unless overwriteUnsaved is true.
    const blocked = await controller.fillForm!({
      member: "board",
      values: { operation: "dashboard.rename", name: "Another Name" },
    });
    expect(blocked).toMatchObject({ ok: false, reason: "blocked_unsaved", member: "board" });

    // 4. Human clicks Cancel on the preview banner: discards preview and reloads saved board.
    const readsBeforeDiscard = api.detailReads;
    const cancelBtn = wrapper.findAll(".board-preview-bar__actions button")[0]!;
    await cancelBtn.trigger("click");
    await flushPromises();
    expect(wrapper.find(".board-preview-bar").exists()).toBe(false);
    expect(dirtyEvents.at(-1)).toBe(false);
    expect(api.detailReads).toBeGreaterThan(readsBeforeDiscard);
    expect(wrapper.find(".chart-container h3").text()).toBe("Revenue by region");

    // 5. Single operation shape + human clicking Save writes via page API and clears dirty state.
    const opFill = await controller.fillForm!({
      member: "board",
      values: { operation: "dashboard.chart.rename", chartId: "c1", resultSetName: "Renamed Chart" },
    });
    await flushPromises();
    expect(opFill).toEqual({ ok: true, member: "board", filledFields: ["cardNames.c1"] });
    expect(wrapper.find(".chart-container h3").text()).toBe("Renamed Chart");

    const saveBtn = wrapper.findAll(".board-preview-bar__actions button")[1]!;
    await saveBtn.trigger("click");
    await flushPromises();
    expect(api.renameChart).toEqual([["d1", "c1", "Renamed Chart"]]);
    expect(wrapper.find(".board-preview-bar").exists()).toBe(false);
    expect(dirtyEvents.at(-1)).toBe(false);

    wrapper.unmount();
  });

  it("requires confirmation for board.save in default mode, omits field values from summary, detects staleness, and persists on approval", async () => {
    const { wrapper, controller, dirtyEvents } = await mountDashboardHome();

    await controller.fillForm!({
      member: "board",
      values: { name: "Secret Board Name", groupNames: { g1: "Secret Group" } },
    });
    await flushPromises();

    // Default confirm mode: returns awaiting_confirmation without writing.
    const pending = await controller.executeAction!({ operation: "board.save", agentRun });
    expect(pending.ok).toBe(true);
    if (!pending.ok || pending.kind !== "awaiting_confirmation") throw new Error("Expected awaiting_confirmation");
    expect(pending.intentId).toBe("intent-1");
    expect(pending.questionId).toBe("question-1");
    expect(api.renameBoard).toEqual([]);
    expect(api.renameGroup).toEqual([]);
    // Confirmation impactSummary must list object/field names only — NEVER the new edited values.
    const confirmInput = api.confirmCalls[0]!;
    expect(String(confirmInput.impactSummary)).toContain("Dashboard name");
    expect(String(confirmInput.impactSummary)).toContain("Overview (title)");
    expect(String(confirmInput.impactSummary)).not.toContain("Secret Board Name");
    expect(String(confirmInput.impactSummary)).not.toContain("Secret Group");

    // Mutating the preview before confirmation makes the pending confirmation stale.
    const overwritten = await controller.fillForm!({
      member: "board",
      values: { name: "Updated Board Name" },
      overwriteUnsaved: true,
    });
    expect(overwritten.ok).toBe(true);
    expect(pending.confirmation.isStillValid()).toMatchObject({ ok: false, reason: "stale" });
    const staleResult = await pending.confirmation.dispatch();
    expect(staleResult).toMatchObject({ ok: false, intentId: "intent-1", reason: "stale" });
    expect(api.renameBoard).toEqual([]);

    // Request a fresh confirmation for the updated preview and approve it.
    const fresh = await controller.executeAction!({ operation: "form.save", agentRun });
    if (!fresh.ok || fresh.kind !== "awaiting_confirmation") throw new Error("Expected awaiting_confirmation");
    expect(fresh.confirmation.isStillValid()).toEqual({ ok: true });
    const dispatched = await fresh.confirmation.dispatch();
    await flushPromises();
    expect(dispatched).toMatchObject({ ok: true, intentId: "intent-2" });
    expect(api.renameBoard).toEqual([["d1", "Updated Board Name"]]);
    expect(dirtyEvents.at(-1)).toBe(false);
    expect(wrapper.find(".board-preview-bar").exists()).toBe(false);

    wrapper.unmount();
  });

  it("executes board.save directly in auto mode and supports board.discard", async () => {
    api.confirmMode.autoMode = true;
    const { wrapper, controller } = await mountDashboardHome();

    await controller.fillForm!({
      member: "board",
      values: { operation: "dashboard.metric.rename", metricId: "n1", metricName: "Auto Metric" },
    });
    await flushPromises();

    const discarded = await controller.executeAction!({ operation: "board.discard", agentRun });
    await flushPromises();
    expect(discarded).toEqual({ ok: true, kind: "executed", operation: "board.discard" });
    expect(wrapper.find(".board-preview-bar").exists()).toBe(false);

    await controller.fillForm!({
      member: "board",
      values: { operation: "dashboard.metric.rename", metricId: "n1", metricName: "Auto Metric" },
    });
    await flushPromises();

    const executed = await controller.executeAction!({ operation: "board.save", agentRun });
    await flushPromises();
    expect(executed).toEqual({ ok: true, kind: "executed", operation: "board.save", intentId: "intent-1" });
    expect(api.renameMetric).toEqual([["d1", "n1", "Auto Metric"]]);

    wrapper.unmount();
  });

  it("requires confirmation for card.parameters.save in default mode, detects stale edits, and saves on approval", async () => {
    const { wrapper, controller } = await mountDashboardHome();

    const filled = await controller.fillForm!({
      member: "card.parameters",
      values: { year: "2025-secret" },
    });
    await flushPromises();
    expect(filled).toEqual({ ok: true, member: "card.parameters", filledFields: ["year"] });

    // Default confirm mode: returns awaiting_confirmation without calling saveCardParameters.
    const pending = await controller.executeAction!({ operation: "card.parameters.save", agentRun });
    expect(pending.ok).toBe(true);
    if (!pending.ok || pending.kind !== "awaiting_confirmation") throw new Error("Expected awaiting_confirmation");
    expect(api.savedParams).toEqual([]);
    // Privacy check: summary names field label only, never the edited value.
    expect(String(api.confirmCalls[0]!.impactSummary)).toBe("Fields: Year");
    expect(String(api.confirmCalls[0]!.impactSummary)).not.toContain("2025-secret");

    // Modifying the parameter value before approval invalidates the pending confirmation.
    const editedAgain = await controller.fillForm!({
      member: "card.parameters",
      values: { year: "2024" },
      overwriteUnsaved: true,
    });
    expect(editedAgain.ok).toBe(true);
    expect(pending.confirmation.isStillValid()).toMatchObject({ ok: false, reason: "stale" });
    const stale = await pending.confirmation.dispatch();
    expect(stale).toMatchObject({ ok: false, intentId: "intent-1", reason: "stale" });
    expect(api.savedParams).toEqual([]);

    // Request a fresh confirmation and cancel it: writes nothing.
    const toCancel = await controller.executeAction!({ operation: "card.parameters.save", agentRun });
    if (!toCancel.ok || toCancel.kind !== "awaiting_confirmation") throw new Error("Expected awaiting_confirmation");
    await toCancel.confirmation.cancel({ code: "USER_CANCELLED", message: "User declined confirmation." });
    expect(await toCancel.confirmation.dispatch()).toMatchObject({ ok: false, reason: "stale" });
    expect(api.savedParams).toEqual([]);

    // Request a fresh confirmation and approve it: persists the current edited value.
    const approved = await controller.executeAction!({ operation: "card.parameters.save", agentRun });
    if (!approved.ok || approved.kind !== "awaiting_confirmation") throw new Error("Expected awaiting_confirmation");
    const result = await approved.confirmation.dispatch();
    await flushPromises();
    expect(result).toMatchObject({ ok: true, intentId: "intent-3" });
    expect(api.savedParams).toEqual([{ dashboardId: "d1", cardId: "c1", revision: "r1", values: { year: "2024" } }]);

    wrapper.unmount();
  });
});
