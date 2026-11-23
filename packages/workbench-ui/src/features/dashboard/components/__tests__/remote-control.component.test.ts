import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import ElementPlus, { ElMessageBox } from "element-plus";
import type { DisplayPageController } from "@ontomato/agent-shell-ui";
import { MetricChart } from "@ontomato/foundation-ui/chart";
import { FormFields } from "@ontomato/foundation-ui/form";
import DashboardHome from "../DashboardHome.vue";
import ChartCard from "../ChartCard.vue";
import DropdownMenu from "../DropdownMenu.vue";
import { BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE } from "../../board-preview";
import { useDashboardStore } from "../../stores/dashboard";
import { workbenchI18n } from "../../../../i18n";

const api = vi.hoisted(() => ({
  renameBoard: [] as unknown[],
  renameGroup: [] as unknown[],
  renameChart: [] as unknown[],
  renameMetric: [] as unknown[],
  layouts: [] as unknown[],
  savedParams: [] as unknown[],
  createdBoards: [] as string[],
  confirmCalls: [] as Array<Record<string, unknown>>,
  confirmMode: { autoMode: false, nextSeq: 1 },
  detailReads: 0,
  listReads: 0,
  failLayoutMessage: null as string | null,
  failGroupRenameMessage: null as string | null,
  failDetailAfterReads: null as number | null,
  boardOverride: null as null | typeof board,
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
    const currentD1 = api.boardOverride ?? board;
    return [
      { id: "d1", name: currentD1.name, createdAt: 0, updatedAt: 0 },
      { id: "d2", name: "Operations", createdAt: 0, updatedAt: 0 },
    ];
  },
  fetchDashboardLocalDetail: async () => {
    api.detailReads += 1;
    if (api.failDetailAfterReads !== null && api.detailReads > api.failDetailAfterReads) {
      throw new Error("Reload network timeout");
    }
    return structuredClone(api.boardOverride ?? board);
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
  createDashboard: async (name: string) => {
    api.createdBoards.push(name);
    return { id: "d-new", name };
  },
  deleteDashboard: async () => true,
  renameDashboard: async (...args: unknown[]) => { api.renameBoard.push(args); return true; },
  modifyDimensionName: async (...args: unknown[]) => {
    api.renameGroup.push(args);
    if (api.failGroupRenameMessage) throw new Error(api.failGroupRenameMessage);
    return true;
  },
  modifyResultSetName: async (...args: unknown[]) => { api.renameChart.push(args); return true; },
  modifyMetricName: async (...args: unknown[]) => { api.renameMetric.push(args); return true; },
  modifyDashboardLayout: async (...args: unknown[]) => {
    api.layouts.push(args);
    if (api.failLayoutMessage) throw new Error(api.failLayoutMessage);
    return true;
  },
  fetchCardParameterForm: async () => ({
    revision: "r1",
    fields: [
      { key: "year", label: "Year", required: false, defaultValue: null, help: null, placeholder: null, maxLength: 200, multiline: false, type: "text" },
      { key: "region", label: "Region", required: false, defaultValue: null, help: null, placeholder: null, maxLength: 200, multiline: false, type: "text" },
    ],
    values: { year: "2026", region: "East" },
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
  api.createdBoards = [];
  api.confirmCalls = [];
  api.confirmMode = { autoMode: false, nextSeq: 1 };
  api.detailReads = 0;
  api.listReads = 0;
  api.failLayoutMessage = null;
  api.failGroupRenameMessage = null;
  api.failDetailAfterReads = null;
  api.boardOverride = null;
  vi.restoreAllMocks();
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

    // 3. Consecutive agent board fills merge onto the active preview instead of rejecting or dropping prior fields.
    const merged = await controller.fillForm!({
      member: "board",
      values: { operation: "dashboard.rename", name: "Q4 Sales Final" },
    });
    await flushPromises();
    expect(merged).toEqual({ ok: true, member: "board", filledFields: ["name"] });
    // Previous layout/chartFile edits remain intact alongside the updated board name.
    expect(wrapper.find(".group-title").text()).toBe("Q4 Overview");
    expect(wrapper.find(".chart-container h3").text()).toBe("Revenue Trend");
    expect(wrapper.find(".board-preview-bar__text").text()).toContain("Q4 Sales Final");

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
    expect(api.renameGroup).toEqual([["d1", "g1", "Secret Group"]]);
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

  it("disables direct board-write entries with a reason while a board preview is active, while keeping read-only controls and Save/Cancel usable", async () => {
    const { wrapper, controller } = await mountDashboardHome();

    // Before preview: menus are unlocked.
    const menusBefore = wrapper.findAllComponents(DropdownMenu);
    expect(menusBefore.length).toBeGreaterThanOrEqual(3);
    expect(menusBefore.every((menu) => (menu.props() as Record<string, unknown>).boardLocked === false)).toBe(true);

    await controller.fillForm!({
      member: "board",
      values: { name: "Preview Name" },
    });
    await flushPromises();

    // Direct write menus (dimension, metric, chart) are locked with an explicit reason.
    const menusLocked = wrapper.findAllComponents(DropdownMenu);
    for (const menu of menusLocked) {
      const menuProps = menu.props() as Record<string, unknown>;
      expect(menuProps.boardLocked).toBe(true);
      expect(String(menuProps.lockReason)).toContain("Save or discard");
    }

    // Group drag handle and card resize handles carry disabled state and lock reason title.
    expect(wrapper.find(".group-drag-handle").classes()).toContain("is-disabled");
    expect(wrapper.find(".group-drag-handle").attributes("title")).toContain("Save or discard");
    for (const handle of wrapper.findAll(".resize-handle")) {
      expect(handle.classes()).toContain("is-disabled");
      expect(handle.attributes("title")).toContain("Save or discard");
    }

    // Read-only chart toolbar buttons (zoom & toggle data) stay enabled, as do preview Save/Cancel buttons.
    const toolButtons = wrapper.findAll("button.ai-chart-tool-btn");
    expect(toolButtons.length).toBeGreaterThanOrEqual(2);
    expect(toolButtons[0]!.attributes("disabled")).toBeUndefined();
    expect(toolButtons[1]!.attributes("disabled")).toBeUndefined();
    const previewButtons = wrapper.findAll(".board-preview-bar__actions button");
    expect(previewButtons).toHaveLength(2);
    expect(previewButtons[0]!.attributes("disabled")).toBeUndefined();
    expect(previewButtons[1]!.attributes("disabled")).toBeUndefined();

    // Active board tab dropdown items are disabled with reason; other board tabs stay enabled.
    const activeTabDropdown = wrapper.findAll(".tab")[0]!;
    expect(activeTabDropdown.classes()).toContain("active");
    const tabMoreBtn = activeTabDropdown.find("button.tab-more");
    await tabMoreBtn.trigger("click");
    await flushPromises();
    const lockHints = [...document.querySelectorAll(".tab-preview-lock-hint")];
    expect(lockHints.some((el) => el.textContent?.includes("Save or discard"))).toBe(true);

    wrapper.unmount();
  });

  it("blocks cross-board navigation via blocksNavigation/applyState and confirms before creating a new board when dirty", async () => {
    const { wrapper, controller, router } = await mountDashboardHome();

    await controller.fillForm!({
      member: "board",
      values: { name: "Unsaved Draft" },
    });
    await flushPromises();

    // blocksNavigation blocks switching to another board (by address or state) AND bare /dashboards without dashboardId,
    // while allowing same-board navigation or a bare cardId-only state patch.
    expect(controller.blocksNavigation?.({ address: "/dashboards?dashboardId=d2" })).toBe(true);
    expect(controller.blocksNavigation?.({ address: "/dashboards", state: { dashboardId: "d2" } })).toBe(true);
    expect(controller.blocksNavigation?.({ address: "/dashboards" })).toBe(true);
    expect(controller.blocksNavigation?.({ address: "/dashboards", state: {} })).toBe(true);
    expect(controller.blocksNavigation?.({ address: "/dashboards?cardId=n1" })).toBe(true);
    expect(controller.blocksNavigation?.({ address: "/dashboards", state: { dashboardId: "" } })).toBe(true);
    expect(controller.blocksNavigation?.({ address: "/dashboards?dashboardId=d1" })).toBe(false);
    expect(controller.blocksNavigation?.({ address: "/dashboards?dashboardId=d1&cardId=n1" })).toBe(false);
    expect(controller.blocksNavigation?.({ address: "/dashboards", state: { cardId: "n1" } })).toBe(false);

    // applyState also refuses switching to another board while dirty.
    controller.applyState({ dashboardId: "d2" });
    await flushPromises();
    expect(router.currentRoute.value.query.dashboardId).toBe("d1");
    expect(wrapper.find(".board-preview-bar").exists()).toBe(true);

    // Clicking "Create dashboard" asks confirmDiscardUnsaved first; cancelling keeps the current board and preview intact.
    const confirmSpy = vi.spyOn(ElMessageBox, "confirm").mockRejectedValueOnce("cancel");
    const promptSpy = vi.spyOn(ElMessageBox, "prompt").mockResolvedValue({ value: "New Board", action: "confirm" } as never);
    await wrapper.find("button.create").trigger("click");
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy).not.toHaveBeenCalled();
    expect(api.createdBoards).toEqual([]);
    expect(wrapper.find(".board-preview-bar").exists()).toBe(true);

    // Confirming discard allows creating the new dashboard.
    confirmSpy.mockResolvedValueOnce("confirm" as never);
    await wrapper.find("button.create").trigger("click");
    await flushPromises();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(api.createdBoards).toEqual(["New Board"]);

    wrapper.unmount();
  });

  it("merges consecutive agent and non-conflicting user parameter edits, and blocks only conflicting user-edited keys", async () => {
    const { wrapper, controller } = await mountDashboardHome();

    // 1. Consecutive agent fills merge cleanly without blocked_unsaved.
    expect(await controller.fillForm!({
      member: "card.parameters",
      values: { year: "2025" },
    })).toEqual({ ok: true, member: "card.parameters", filledFields: ["year"] });
    await flushPromises();

    expect(await controller.fillForm!({
      member: "card.parameters",
      values: { region: "West" },
    })).toEqual({ ok: true, member: "card.parameters", filledFields: ["region"] });
    await flushPromises();

    // Agent can also refine its own previously filled key.
    expect(await controller.fillForm!({
      member: "card.parameters",
      values: { year: "2024" },
    })).toEqual({ ok: true, member: "card.parameters", filledFields: ["year"] });
    await flushPromises();

    // 2. User manually edits 'year'; agent fills non-conflicting 'region' -> merges both without blocked_unsaved.
    const formFields = wrapper.findComponent(FormFields);
    formFields.vm.$emit("input", "year", "2023-manual");
    await flushPromises();

    expect(await controller.fillForm!({
      member: "card.parameters",
      values: { region: "North" },
    })).toEqual({ ok: true, member: "card.parameters", filledFields: ["region"] });
    await flushPromises();

    // 3. Agent attempts to overwrite user-edited 'year' without overwriteUnsaved -> blocked_unsaved naming 'year'.
    const blocked = await controller.fillForm!({
      member: "card.parameters",
      values: { year: "2022" },
    });
    expect(blocked).toMatchObject({
      ok: false,
      reason: "blocked_unsaved",
      member: "card.parameters",
    });
    expect(blocked.ok ? "" : blocked.message).toContain("year");

    // 4. User reverts 'year' back to baseline ('2026') -> removed from userEditedKeys -> agent can fill 'year' again.
    formFields.vm.$emit("input", "year", "2026");
    await flushPromises();
    expect(await controller.fillForm!({
      member: "card.parameters",
      values: { year: "2022" },
    })).toEqual({ ok: true, member: "card.parameters", filledFields: ["year"] });
    await flushPromises();

    // Approve save and confirm both merged parameters are sent.
    api.confirmMode.autoMode = true;
    const saved = await controller.executeAction!({ operation: "card.parameters.save", agentRun });
    expect(saved).toMatchObject({ ok: true, kind: "executed" });
    expect(api.savedParams).toEqual([
      { dashboardId: "d1", cardId: "c1", revision: "r1", values: { year: "2022", region: "North" } },
    ]);

    wrapper.unmount();
  });

  it("reports multi-step partial save truthfully, reports success when only final reload fails, and rejects stale deleted targets", async () => {
    // 1. Multi-step partial save: renameDashboard succeeds, modifyDimensionName fails.
    api.failGroupRenameMessage = "Group write failed";
    const { wrapper, controller } = await mountDashboardHome();

    await controller.fillForm!({
      member: "board",
      values: { name: "Renamed Board", groupNames: { g1: "Renamed Group" } },
    });
    await flushPromises();

    const pending = await controller.executeAction!({ operation: "board.save", agentRun });
    if (!pending.ok || pending.kind !== "awaiting_confirmation") throw new Error("Expected awaiting_confirmation");
    const dispatched = await pending.confirmation.dispatch();
    await flushPromises();

    // Never disguised as blanket failure or not_executed: truthfully reports succeeded & failed steps.
    expect(dispatched).toMatchObject({
      ok: true,
      intentId: "intent-1",
      outcome: {
        dashboardId: "d1",
        partial: true,
        succeeded: ["rename dashboard"],
        failed: [{ label: 'rename group "Overview"', error: "Group write failed" }],
      },
    });
    if (dispatched.ok) {
      expect(dispatched.summary).toContain("rename dashboard");
      expect(dispatched.summary).toContain("Group write failed");
    }
    // Banner remains visible with only the failed item's error, and succeeded step was removed from preview.
    expect(wrapper.find(".board-preview-bar__failure").text()).toContain("rename dashboard");
    expect(wrapper.find(".board-preview-bar__failure").text()).toContain("Group write failed");
    wrapper.unmount();

    // 2. All writes succeed, only final reload fails -> clears preview, preserves rendered board, and reports reloadFailed: true.
    api.failGroupRenameMessage = null;
    api.confirmMode = { autoMode: true, nextSeq: 1 };
    api.detailReads = 0;
    const second = await mountDashboardHome();
    // Allow the pre-save freshness check (+1 read), then fail the first post-save reload detail read.
    api.failDetailAfterReads = api.detailReads + 1;

    await second.controller.fillForm!({
      member: "board",
      values: { name: "Saved Despite Reload Failure" },
    });
    await flushPromises();

    const executed = await second.controller.executeAction!({ operation: "board.save", agentRun });
    await flushPromises();
    expect(executed).toMatchObject({
      ok: true,
      kind: "executed",
      operation: "board.save",
      outcome: {
        dashboardId: "d1",
        reloadFailed: true,
      },
    });
    expect(second.wrapper.find(".board-preview-bar").exists()).toBe(false);
    expect(second.dirtyEvents.at(-1)).toBe(false);
    expect(second.wrapper.findAll(".chart-container")).toHaveLength(1);
    expect(second.wrapper.findAll(".metric-container")).toHaveLength(1);
    second.wrapper.unmount();

    // 3. Target card deleted before approval -> isStillValid() and dispatch() reject as stale with zero writes.
    api.failDetailAfterReads = null;
    api.confirmMode = { autoMode: false, nextSeq: 1 };
    api.renameChart = [];
    const third = await mountDashboardHome();

    await third.controller.fillForm!({
      member: "board",
      values: { operation: "dashboard.chart.rename", chartId: "c1", resultSetName: "Ghost Chart" },
    });
    await flushPromises();

    const pendingChart = await third.controller.executeAction!({ operation: "board.save", agentRun });
    if (!pendingChart.ok || pendingChart.kind !== "awaiting_confirmation") throw new Error("Expected awaiting_confirmation");

    // Simulate chart c1 disappearing from the loaded board before confirmation approval.
    third.wrapper.findComponent(ChartCard).vm.$emit("chart-deleted", { chartId: "c1" });
    await flushPromises();

    expect(pendingChart.confirmation.isStillValid()).toMatchObject({ ok: false, reason: "stale" });
    const staleResult = await pendingChart.confirmation.dispatch();
    expect(staleResult).toMatchObject({ ok: false, reason: "stale" });
    expect(api.renameChart).toEqual([]);
    third.wrapper.unmount();
  });

  it("rejects preview save (manual, auto, confirmed) and follow-up fills with zero writes when the formal board changed after preview creation", async () => {
    const { wrapper, controller } = await mountDashboardHome();

    // 1. Create a whole-board preview from the initial formal board.
    const initialFill = await controller.fillForm!({
      member: "board",
      values: {
        name: "Q4 Sales",
        groups: [
          {
            id: "g1",
            title: "Q4 Overview",
            charts: [{ id: "c1", name: "Revenue Trend", chartFile: lineChartFile }],
            metrics: [{ id: "n1", name: "Q4 Total" }],
          },
        ],
      },
    });
    await flushPromises();
    expect(initialFill).toEqual({ ok: true, member: "board", filledFields: ["name", "groups"] });

    // Prepare a confirmation while the board is still fresh.
    const pendingConfirm = await controller.executeAction!({ operation: "board.save", agentRun });
    if (!pendingConfirm.ok || pendingConfirm.kind !== "awaiting_confirmation") {
      throw new Error("Expected awaiting_confirmation");
    }

    // 2. Simulate external server mutation (e.g., conversation artifact "Add to dashboard" or another tab added a new card).
    const mutatedBoard = structuredClone(board);
    mutatedBoard.groups[0]!.charts.push({
      id: "c-added-by-artifact",
      name: "Added From Chat",
      query: { kind: "metric", metricId: "m-9", parameters: {} },
      chartFile: savedChartFile,
      layout: { colSpan: 12, rowSpan: 1 },
    });
    api.boardOverride = mutatedBoard;

    // 2a. Manual click on banner Save -> rejected, zero writes, preview preserved with clear stale message.
    const saveBtn = wrapper.findAll(".board-preview-bar__actions button")[1]!;
    await saveBtn.trigger("click");
    await flushPromises();
    expect(api.renameBoard).toEqual([]);
    expect(api.layouts).toEqual([]);
    expect(wrapper.find(".board-preview-bar").exists()).toBe(true);
    expect(wrapper.find(".board-preview-bar__failure").text()).toContain(BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE);

    // 2b. Confirmed dispatch -> rejected as stale with zero writes, preview preserved.
    const confirmedResult = await pendingConfirm.confirmation.dispatch();
    await flushPromises();
    expect(confirmedResult).toMatchObject({
      ok: false,
      reason: "stale",
      message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE,
    });
    expect(api.renameBoard).toEqual([]);
    expect(api.layouts).toEqual([]);
    expect(wrapper.find(".board-preview-bar").exists()).toBe(true);

    // 2c. Auto-mode save -> rejected as stale with zero writes, preview preserved.
    api.confirmMode = { autoMode: true, nextSeq: 10 };
    const autoResult = await controller.executeAction!({ operation: "board.save", agentRun });
    await flushPromises();
    expect(autoResult).toMatchObject({
      ok: false,
      reason: "stale",
      operation: "board.save",
      message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE,
    });
    expect(api.renameBoard).toEqual([]);
    expect(api.layouts).toEqual([]);
    expect(wrapper.find(".board-preview-bar").exists()).toBe(true);

    // 2d. Follow-up append fill on the stale preview -> rejected as stale without clobbering existing preview.
    const appendResult = await controller.fillForm!({
      member: "board",
      values: { groupNames: { g1: "Another Name" } },
    });
    await flushPromises();
    expect(appendResult).toMatchObject({
      ok: false,
      reason: "stale",
      member: "board",
      message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE,
    });
    expect(wrapper.find(".group-title").text()).toBe("Q4 Overview");

    wrapper.unmount();

    // 3. Pending drag/resize auto-save rejects incoming whole-board fillForm instead of overwriting with stale order.
    api.boardOverride = null;
    const dragCase = await mountDashboardHome();
    dragCase.wrapper.findComponent(ChartCard).vm.$emit("layout-change", { colSpan: 24, rowSpan: 2 });
    await flushPromises();

    const blockedDuringDragSave = await dragCase.controller.fillForm!({
      member: "board",
      values: {
        groups: [
          {
            id: "g1",
            title: "Overview",
            charts: [{ id: "c1", chartFile: lineChartFile }],
            metrics: [{ id: "n1" }],
          },
        ],
      },
    });
    expect(blockedDuringDragSave).toMatchObject({
      ok: false,
      reason: "stale",
      member: "board",
    });
    expect(dragCase.wrapper.find(".board-preview-bar").exists()).toBe(false);
    dragCase.wrapper.unmount();
  });

  it("preserves prior groupNames/cardNames when a follow-up groups layout swaps a chart, and respects active inline edits with overwriteUnsaved", async () => {
    const { wrapper, controller } = await mountDashboardHome();

    // 1. Consecutive fill: groupNames + cardNames first, then full groups carrying stale baseline names + new chartFile.
    expect(await controller.fillForm!({
      member: "board",
      values: {
        groupNames: { g1: "Q4 Overview" },
        cardNames: { c1: "Revenue Trend", n1: "Q4 Total" },
      },
    })).toEqual({ ok: true, member: "board", filledFields: ["groupNames.g1", "cardNames.c1", "cardNames.n1"] });
    await flushPromises();

    expect(await controller.fillForm!({
      member: "board",
      values: {
        groups: [
          {
            id: "g1",
            title: "Overview",
            charts: [{ id: "c1", name: "Revenue by region", chartFile: lineChartFile }],
            metrics: [{ id: "n1", name: "Total revenue" }],
          },
        ],
      },
    })).toEqual({ ok: true, member: "board", filledFields: ["groups"] });
    await flushPromises();

    expect(wrapper.find(".group-title").text()).toBe("Q4 Overview");
    expect(wrapper.find(".chart-container h3").text()).toBe("Revenue Trend");
    expect(wrapper.find(".metric-container .title").text()).toBe("Q4 Total");
    expect(wrapper.findComponent(MetricChart).props("file")).toEqual(lineChartFile.content);

    // Save and confirm the persisted layout keeps the earlier group/card renames alongside the swapped chartFile.
    api.confirmMode = { autoMode: true, nextSeq: 1 };
    const saved = await controller.executeAction!({ operation: "board.save", agentRun });
    await flushPromises();
    expect(saved).toMatchObject({ ok: true, kind: "executed", operation: "board.save" });
    expect(api.layouts).toEqual([
      [
        "d1",
        [
          {
            id: "g1",
            title: "Q4 Overview",
            charts: [{ id: "c1", name: "Revenue Trend", chartFile: lineChartFile }],
            metrics: [{ id: "n1", name: "Q4 Total" }],
          },
        ],
      ],
    ]);
    wrapper.unmount();

    // 2. Active inline board-name edit: non-conflicting field passes, conflicting field requires overwriteUnsaved: true.
    const inlineCase = await mountDashboardHome();
    const store = useDashboardStore();
    store.startDashboardRename({ id: "d1", name: "Sales" });
    await flushPromises();
    expect(store.editingDashboardId).toBe("d1");

    const nonConflicting = await inlineCase.controller.fillForm!({
      member: "board",
      values: { groupNames: { g1: "Non-Conflicting Group" } },
    });
    expect(nonConflicting).toEqual({ ok: true, member: "board", filledFields: ["groupNames.g1"] });
    expect(store.editingDashboardId).toBe("d1");

    const blockedBoard = await inlineCase.controller.fillForm!({
      member: "board",
      values: { name: "Agent Board Name" },
    });
    expect(blockedBoard).toMatchObject({ ok: false, reason: "blocked_unsaved", member: "board" });
    expect(store.editingDashboardId).toBe("d1");

    const overwrittenBoard = await inlineCase.controller.fillForm!({
      member: "board",
      values: { name: "Agent Board Name" },
      overwriteUnsaved: true,
    });
    await flushPromises();
    expect(overwrittenBoard).toEqual({ ok: true, member: "board", filledFields: ["name"] });
    expect(store.editingDashboardId).toBe("");
    inlineCase.wrapper.unmount();

    // 3. Active inline group rename prompt: blocks same group without overwriteUnsaved, cancels on overwriteUnsaved: true.
    const groupPromptCase = await mountDashboardHome();
    let resolveGroupPrompt!: (value: { value: string }) => void;
    vi.spyOn(ElMessageBox, "prompt").mockImplementationOnce(
      () => new Promise((resolve) => { resolveGroupPrompt = resolve as (value: { value: string }) => void; }) as never,
    );
    const groupMenu = groupPromptCase.wrapper
      .findAllComponents(DropdownMenu)
      .find((m) => (m.props() as { scene?: string }).scene === "dimension")!;
    groupMenu.vm.$emit("command", "rename");
    await flushPromises();

    // Different item (card name) merges cleanly.
    expect(await groupPromptCase.controller.fillForm!({
      member: "board",
      values: { cardNames: { c1: "Allowed Card Rename" } },
    })).toEqual({ ok: true, member: "board", filledFields: ["cardNames.c1"] });

    // Same group is blocked without overwriteUnsaved.
    expect(await groupPromptCase.controller.fillForm!({
      member: "board",
      values: { groupNames: { g1: "Agent Group" } },
    })).toMatchObject({ ok: false, reason: "blocked_unsaved", member: "board" });

    // overwriteUnsaved: true applies and invalidates the stale prompt so resolving it later never writes.
    expect(await groupPromptCase.controller.fillForm!({
      member: "board",
      values: { groupNames: { g1: "Agent Group" } },
      overwriteUnsaved: true,
    })).toEqual({ ok: true, member: "board", filledFields: ["groupNames.g1"] });
    resolveGroupPrompt({ value: "Late Human Group" });
    await flushPromises();
    expect(api.renameGroup).toEqual([]);
    groupPromptCase.wrapper.unmount();

    // 4. Active inline chart card rename prompt: blocks same card without overwriteUnsaved, cancels on overwriteUnsaved: true.
    const cardPromptCase = await mountDashboardHome();
    let resolveCardPrompt!: (value: { value: string }) => void;
    vi.spyOn(ElMessageBox, "prompt").mockImplementationOnce(
      () => new Promise((resolve) => { resolveCardPrompt = resolve as (value: { value: string }) => void; }) as never,
    );
    cardPromptCase.wrapper.findComponent(ChartCard).findComponent({ name: "ChartToolbar" }).vm.$emit("command", "rename");
    await flushPromises();

    expect(await cardPromptCase.controller.fillForm!({
      member: "board",
      values: { groupNames: { g1: "Allowed Group Rename" } },
    })).toEqual({ ok: true, member: "board", filledFields: ["groupNames.g1"] });

    expect(await cardPromptCase.controller.fillForm!({
      member: "board",
      values: { cardNames: { c1: "Agent Chart" } },
    })).toMatchObject({ ok: false, reason: "blocked_unsaved", member: "board" });

    expect(await cardPromptCase.controller.fillForm!({
      member: "board",
      values: { cardNames: { c1: "Agent Chart" } },
      overwriteUnsaved: true,
    })).toEqual({ ok: true, member: "board", filledFields: ["cardNames.c1"] });
    resolveCardPrompt({ value: "Late Human Chart" });
    await flushPromises();
    expect(api.renameChart).toEqual([]);
    cardPromptCase.wrapper.unmount();
  });

  it("keeps rendered cards intact and reports reloadFailed: true when the second detail read inside loadDashboardAll fails after save", async () => {
    api.confirmMode = { autoMode: true, nextSeq: 1 };
    api.detailReads = 0;
    const { wrapper, controller, dirtyEvents } = await mountDashboardHome();

    // Mount consumed 2 reads. Save performs 1 pre-save freshness read (+1),
    // then loadDashboardAll performs 1st detail read (+2, succeeds) and 2nd detail read inside loader (+3, fails!).
    api.failDetailAfterReads = api.detailReads + 2;

    await controller.fillForm!({
      member: "board",
      values: { name: "Saved With Second Read Failure" },
    });
    await flushPromises();

    const executed = await controller.executeAction!({ operation: "board.save", agentRun });
    await flushPromises();

    expect(executed).toMatchObject({
      ok: true,
      kind: "executed",
      operation: "board.save",
      outcome: {
        dashboardId: "d1",
        reloadFailed: true,
        reloadError: "Reload network timeout",
      },
    });
    expect(wrapper.find(".board-preview-bar").exists()).toBe(false);
    expect(dirtyEvents.at(-1)).toBe(false);
    // Board must NOT be cleared into empty state; previously rendered chart and metric cards remain visible.
    expect(wrapper.find(".empty-state").exists()).toBe(false);
    expect(wrapper.findAll(".chart-container")).toHaveLength(1);
    expect(wrapper.findAll(".metric-container")).toHaveLength(1);
    expect(wrapper.find(".chart-container h3").text()).toBe("Revenue by region");

    wrapper.unmount();
  });

  it("reports dashboardId and cardId in snapshotMeta and rejects stale board/card basis on fillForm & executeAction (II.7)", async () => {
    const { wrapper, controller } = await mountDashboardHome();

    const meta = controller.snapshotMeta?.();
    expect(meta).toMatchObject({
      dashboardId: "d1",
      cardId: "c1",
    });

    // Stale dashboardId blocks fillForm on both board and card.parameters without mutating preview or parameters.
    const staleBoardFill = await controller.fillForm!({
      member: "board",
      values: { operation: "dashboard.rename", dashboardName: "Wrong Board" },
      expectedDashboardId: "d2",
    });
    expect(staleBoardFill).toMatchObject({ ok: false, reason: "stale" });
    expect(wrapper.find(".board-preview-bar").exists()).toBe(false);

    // Stale cardId blocks card.parameters fillForm & save.
    const staleCardFill = await controller.fillForm!({
      member: "card.parameters",
      values: { year: "2020" },
      expectedDashboardId: "d1",
      expectedCardId: "c2",
    });
    expect(staleCardFill).toMatchObject({ ok: false, reason: "stale" });

    // Matching dashboardId + cardId succeeds.
    const matchingFill = await controller.fillForm!({
      member: "card.parameters",
      values: { year: "2025" },
      expectedDashboardId: "d1",
      expectedCardId: "c1",
    });
    expect(matchingFill).toEqual({ ok: true, member: "card.parameters", filledFields: ["year"] });

    // Stale dashboardId or cardId blocks executeAction too.
    const staleBoardAction = await controller.executeAction!({
      operation: "card.parameters.save",
      agentRun,
      expectedDashboardId: "d2",
    });
    expect(staleBoardAction).toMatchObject({ ok: false, reason: "stale" });

    const staleCardAction = await controller.executeAction!({
      operation: "card.parameters.save",
      agentRun,
      expectedDashboardId: "d1",
      expectedCardId: "c2",
    });
    expect(staleCardAction).toMatchObject({ ok: false, reason: "stale" });
    expect(api.savedParams).toEqual([]);

    wrapper.unmount();
  });

  it("updates local preview baseline after a direct tab rename without breaking mid-preview stale protection", async () => {
    const { wrapper, controller } = await mountDashboardHome();
    const store = useDashboardStore();
    api.confirmMode = { autoMode: true, nextSeq: 1 };

    // 1. User directly renames the active board tab while no preview is active.
    api.boardOverride = { ...structuredClone(board), name: "Q4 Sales" };
    store.startDashboardRename({ id: "d1", name: "Sales" });
    store.editingDashboardName = "Q4 Sales";
    await store.saveDashboardRename({ id: "d1", name: "Sales" });
    await flushPromises();

    // Immediate chart swap (whole-board layout fill) and save succeed against the updated baseline.
    const swapFill = await controller.fillForm!({
      member: "board",
      values: {
        groups: [
          {
            id: "g1",
            title: "Overview",
            charts: [{ id: "c1", chartFile: lineChartFile }],
            metrics: [{ id: "n1" }],
          },
        ],
      },
    });
    expect(swapFill).toEqual({ ok: true, member: "board", filledFields: ["groups"] });
    await flushPromises();

    const swapSave = await controller.executeAction!({ operation: "board.save", agentRun });
    await flushPromises();
    expect(swapSave).toMatchObject({ ok: true, operation: "board.save" });

    // 2. Another direct tab rename followed by a single-field preview and save also succeeds without reloading.
    api.boardOverride = { ...structuredClone(board), name: "Q4 Sales Final" };
    store.startDashboardRename({ id: "d1", name: "Q4 Sales" });
    store.editingDashboardName = "Q4 Sales Final";
    await store.saveDashboardRename({ id: "d1", name: "Q4 Sales" });
    await flushPromises();

    const renameGroupFill = await controller.fillForm!({
      member: "board",
      values: { groupNames: { g1: "Summary" } },
    });
    expect(renameGroupFill).toEqual({ ok: true, member: "board", filledFields: ["groupNames.g1"] });
    await flushPromises();

    const renameGroupSave = await controller.executeAction!({ operation: "board.save", agentRun });
    await flushPromises();
    expect(renameGroupSave).toMatchObject({ ok: true, operation: "board.save" });

    // 3. Conversely, if a preview is ALREADY active when a tab rename commits, saving that preview is still rejected as stale.
    const activePreviewFill = await controller.fillForm!({
      member: "board",
      values: { groupNames: { g1: "Draft Title" } },
    });
    expect(activePreviewFill).toEqual({ ok: true, member: "board", filledFields: ["groupNames.g1"] });
    await flushPromises();

    api.boardOverride = { ...structuredClone(board), name: "Renamed Mid-Preview" };
    store.startDashboardRename({ id: "d1", name: "Q4 Sales Final" });
    store.editingDashboardName = "Renamed Mid-Preview";
    await store.saveDashboardRename({ id: "d1", name: "Q4 Sales Final" });
    await flushPromises();

    const staleSave = await controller.executeAction!({ operation: "board.save", agentRun });
    await flushPromises();
    expect(staleSave).toMatchObject({
      ok: false,
      reason: "stale",
      operation: "board.save",
      message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE,
    });

    wrapper.unmount();
  });
});
