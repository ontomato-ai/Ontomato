/* eslint-disable vue/one-component-per-file */
import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { englishMessages, managerMessageTree } from "@ontomato/ontology-manager/i18n";
import { dashboardChartFileSchema } from "@ontomato/contracts/dashboard";
import { definePanel, type DirectPanelManifest } from "@ontomato/contracts/panel-manifest";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { DASHBOARD, DASHBOARD_CARD } from "@ontomato/contracts/platform-object-types";
import { createDirectPanelInstance, type MemberDataState, type PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";
import { projectionKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { panelMemberKey, type PanelMemberContext } from "../../../../../packages/apps-sdk/src/panel/member";
import PanelMember from "../../../../../packages/apps-sdk/src/panel/PanelMember.vue";
import MetricChart from "../../../../../packages/apps-sdk/src/base/MetricChart.vue";
import MetricCard from "../../../../../packages/apps-sdk/src/base/MetricCard.vue";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";

vi.mock("../../../../../packages/foundation-ui/src/chart/EChart.vue", () => ({
  default: defineComponent({
    props: ["option"],
    setup: (props) => () =>
      h("div", {
        class: "mock-echart",
        "data-series-type": String(props.option?.series?.[0]?.type ?? ""),
        "data-rows": JSON.stringify(props.option?.dataset?.[0]?.source ?? []),
      }),
  }),
}));

const en = { ...publicEn, ...managerMessageTree(englishMessages) };

const meta = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-25T00:00:00.000Z",
  updatedAt: "2026-11-25T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
  description: "",
};

const ready = (value: unknown): ProductPanelReadResponse => ({ status: "ready", value: value as never });

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

async function flush() {
  await Promise.resolve();
  await nextTick();
  await new Promise((r) => setTimeout(r, 15));
  await nextTick();
}

function mountDirect(
  manifest: DirectPanelManifest,
  projections: Record<string, DirectProjection>,
  answer: (request: PanelMemberReadRequest) => ProductPanelReadResponse | Promise<ProductPanelReadResponse>,
  renderSlot: (instance: ReturnType<typeof createDirectPanelInstance>) => ReturnType<typeof h>,
  initial?: Record<string, unknown>,
) {
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "grouped-grid-test",
    url: () => "/panels/grouped-grid",
    label: () => "Grouped grid test",
    initial: initial as never,
    readProjection: async (id) => projections[id]!,
    read: async (request) => answer(request),
    ...noOperations,
    text: createPanelText({}, ref("en"), "en"),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp({
    setup: () => () => renderSlot(instance),
  });
  app.use(createI18n({ legacy: false, locale: "en", messages: { en } }));
  app.use(ElementPlus);
  app.mount(container);
  cleanup = () => {
    app.unmount();
    container.remove();
  };
  return { container, instance };
}

it("ObjectList layout='tabs' renders selectable horizontal tabs, #tabs-extra slot, rowActions, and overflow scroll controls", async () => {
  const manifest = definePanel({
    state: {
      selected: { type: { kind: "object", objectType: DASHBOARD } },
    },
    members: {
      boards: {
        target: { projectionId: "proj-boards" },
        outputs: { selected: { state: "selected" } },
      },
    },
  });

  const projections: Record<string, DirectProjection> = {
    "proj-boards": {
      ...meta,
      id: "proj-boards",
      name: "Boards",
      componentId: "@ontomato/sdk:ObjectList",
      data: {
        rows: {
          source: { type: { kind: "PlatformObjectType", id: DASHBOARD } },
          read: "list",
          params: {},
        },
      },
      config: {
        layout: "tabs",
        fallbackToFirst: true,
        rowActions: {
          items: [
            { kind: "local", id: "rename", label: "Rename" },
            { kind: "local", id: "delete", label: "Delete", tone: "danger" },
          ],
        },
      },
      inputs: {},
      outputs: { selected: { kind: "object", objectType: DASHBOARD } },
    },
  };

  const localActions: Array<{ id: string; primaryKey: string }> = [];
  const createClicks = vi.fn();

  const { container, instance } = mountDirect(
    manifest,
    projections,
    () =>
      ready([
        { primaryKey: "b1", className: DASHBOARD, label: "Executive Overview", fields: { name: "Executive Overview" } },
        { primaryKey: "b2", className: DASHBOARD, label: "Operations Weekly", fields: { name: "Operations Weekly" } },
        { primaryKey: "b3", className: DASHBOARD, label: "Very Long Tab Label That Truncates Cleanly", fields: { name: "Very Long Tab Label That Truncates Cleanly" } },
      ]),
    (inst) =>
      h(
        PanelMember,
        {
          instance: inst,
          member: "boards",
          onRowAction: (payload: { id: string; ref: { primaryKey: string } }) =>
            localActions.push({ id: payload.id, primaryKey: payload.ref.primaryKey }),
        },
        {
          "tabs-extra": () => h("button", { class: "add-tab-btn", onClick: createClicks }, "+"),
        },
      ),
  );

  await vi.waitFor(() => {
    expect(container.querySelectorAll<HTMLElement>('[role="tab"]').length).toBe(3);
  });

  const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs).toHaveLength(3);
  expect(tabs[0]!.classList.contains("chosen")).toBe(true);
  expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  expect(tabs[2]!.querySelector(".sdk-object-list-tab-label")?.getAttribute("title")).toBe(
    "Very Long Tab Label That Truncates Cleanly",
  );

  // Clicking second tab updates `selected` state through the standard ObjectList selection mechanism.
  tabs[1]!.click();
  await flush();
  expect(instance.state.values.value.selected).toEqual({ className: DASHBOARD, primaryKey: "b2" });
  expect(tabs[1]!.classList.contains("chosen")).toBe(true);

  // Trailing #tabs-extra slot is rendered inline beside tabs.
  const addBtn = container.querySelector<HTMLButtonElement>(".add-tab-btn");
  expect(addBtn).not.toBeNull();
  addBtn!.click();
  expect(createClicks).toHaveBeenCalledTimes(1);

  // Each tab has a compact overflow row-actions trigger (maxVisible: 0).
  expect(tabs[1]!.querySelector(".sdk-object-list-action-more-btn")).not.toBeNull();

  // Simulate horizontal overflow on the tab scroller and verify left/right scroll buttons appear.
  const scroller = container.querySelector<HTMLElement>(".sdk-object-list-tabs-scroller")!;
  Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 200 });
  Object.defineProperty(scroller, "scrollWidth", { configurable: true, value: 600 });
  Object.defineProperty(scroller, "scrollLeft", { configurable: true, writable: true, value: 50 });
  scroller.dispatchEvent(new Event("scroll"));
  await flush();

  expect(container.querySelector('[data-testid="object-list-tabs-scroll-left"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="object-list-tabs-scroll-right"]')).not.toBeNull();
});

it("GroupedGrid renders groups (preserving empty groups), sections, slots, selection sync, and emits layout-change only on user drag/resize", async () => {
  const manifest = definePanel({
    state: {
      board: { type: { kind: "object", objectType: DASHBOARD } },
      selectedCard: { type: { kind: "object", objectType: DASHBOARD_CARD } },
    },
    members: {
      grid: {
        target: { projectionId: "proj-grid" },
        inputs: { target: { state: "board" }, selected: { state: "selectedCard" } },
        outputs: { selected: { state: "selectedCard" } },
      },
    },
  });

  const projections: Record<string, DirectProjection> = {
    "proj-grid": {
      ...meta,
      id: "proj-grid",
      name: "Grid",
      componentId: "@ontomato/sdk:GroupedGrid",
      data: {
        record: {
          source: { object: { input: "target" } },
          read: "record",
          params: {},
        },
        rows: {
          source: { object: { input: "target" } },
          read: "cards",
          params: {},
        },
      },
      config: {
        columns: 12,
        rowHeight: 160,
        gap: 16,
        sectionField: "kind",
        sectionOrder: ["summary", "visual"],
      },
      inputs: {
        target: { kind: "object", objectType: DASHBOARD },
        selected: { kind: "object", objectType: DASHBOARD_CARD },
      },
      outputs: {
        selected: { kind: "object", objectType: DASHBOARD_CARD },
      },
    },
  };

  const layoutChanges: unknown[] = [];
  const scrollIntoViewSpy = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoViewSpy;

  const { container, instance } = mountDirect(
    manifest,
    projections,
    (req) => {
      if (req.dataName === "record") {
        return ready({
          primaryKey: "b1",
          className: DASHBOARD,
          label: "Board 1",
          fields: {
            groups: {
              kind: "json",
              value: [
                { id: "g1", title: "Group One", order: 0 },
                { id: "g2", title: "Empty Group", order: 1 },
              ],
            },
          },
        });
      }
      return ready([
        {
          primaryKey: "b1:c1",
          className: DASHBOARD_CARD,
          label: "Visual Card",
          fields: { groupId: "g1", groupTitle: "Group One", kind: "visual", order: 0, colSpan: 6, rowSpan: 2 },
        },
        {
          primaryKey: "b1:m1",
          className: DASHBOARD_CARD,
          label: "Summary Tile",
          fields: { groupId: "g1", groupTitle: "Group One", kind: "summary", order: 0, colSpan: 3, rowSpan: 1 },
        },
      ]);
    },
    (inst) =>
      h(
        PanelMember,
        {
          instance: inst,
          member: "grid",
          onLayoutChange: (payload: unknown) => layoutChanges.push(payload),
        },
        {
          item: ({ itemRef, colSpan, rowSpan }: { itemRef: { primaryKey: string }; colSpan: number; rowSpan: number }) =>
            h("div", { class: "slot-item-body", "data-ref": itemRef.primaryKey }, `${colSpan}x${rowSpan}`),
          "group-empty": ({ group }: { group: { id: string } }) =>
            h("div", { class: "slot-group-empty" }, `Nothing in ${group.id}`),
        },
      ),
    {
      board: { className: DASHBOARD, primaryKey: "b1" },
      selectedCard: { className: DASHBOARD_CARD, primaryKey: "b1:c1" },
    },
  );

  await vi.waitFor(() => {
    expect(container.querySelectorAll<HTMLElement>(".sdk-grouped-grid-group").length).toBe(2);
  });

  // No auto-save on initial load or deep-link restore!
  expect(layoutChanges).toHaveLength(0);

  // Both groups rendered (including empty group with custom #group-empty slot)
  const groupEls = [...container.querySelectorAll<HTMLElement>(".sdk-grouped-grid-group")];
  expect(groupEls).toHaveLength(2);
  expect(groupEls[1]!.querySelector(".slot-group-empty")?.textContent).toBe("Nothing in g2");

  // Section order puts "summary" track above "visual" track
  const tracks = [...groupEls[0]!.querySelectorAll<HTMLElement>(".sdk-grouped-grid-track")];
  expect(tracks.map((el) => el.getAttribute("data-section"))).toEqual(["summary", "visual"]);

  // Deep-linked selectedCard is highlighted and scrolled into view once
  const visualCard = container.querySelector<HTMLElement>('[data-primary-key="b1:c1"]')!;
  expect(visualCard.classList.contains("is-selected")).toBe(true);
  expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

  // Clicking the other item updates `selectedCard` state
  const summaryTile = container.querySelector<HTMLElement>('[data-primary-key="b1:m1"]')!;
  summaryTile.click();
  await flush();
  expect(instance.state.values.value.selectedCard).toEqual({ className: DASHBOARD_CARD, primaryKey: "b1:m1" });
  expect(layoutChanges).toHaveLength(0);

  // Dragging group g2 before group g1 emits structured layout-change once
  const groupHandle = groupEls[1]!.querySelector<HTMLElement>('[data-testid="grouped-grid-group-handle"]')!;
  groupHandle.dispatchEvent(new Event("dragstart", { bubbles: true }));
  groupEls[0]!.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
  groupEls[0]!.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
  await flush();

  expect(layoutChanges).toHaveLength(1);
  const firstPayload = layoutChanges[0] as { groups: Array<{ id: string; items: Array<{ primaryKey: string }> }> };
  expect(firstPayload.groups.map((g) => g.id)).toEqual(["g2", "g1"]);

  // Resizing item via pointer events emits layout-change only when span changes
  const resizeHandle = visualCard.querySelector<HTMLElement>('[data-testid="grouped-grid-resize-handle"]')!;
  resizeHandle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
  window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 280 }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  await flush();

  expect(layoutChanges).toHaveLength(2);
  const secondPayload = layoutChanges[1] as { groups: Array<{ id: string; items: Array<{ primaryKey: string; colSpan: number; rowSpan: number }> }> };
  const resized = secondPayload.groups.flatMap((g) => g.items).find((i) => i.primaryKey === "b1:c1")!;
  expect(resized.colSpan).toBeGreaterThan(6);
  expect(resized.rowSpan).toBeGreaterThan(2);
});

it("GroupedGrid fixed-member mode mounts without data.rows, reads/writes typed layout state on drag/resize/hide, and reacts to external state updates", async () => {
  const manifest = definePanel({
    state: {
      layout: {
        type: {
          kind: "grid-layout",
          columns: 12,
          maxRowSpan: 6,
          groupIds: ["main"],
          itemIds: ["first", "second", "third"],
        },
        personal: true,
      },
    },
    members: {
      canvas: {
        target: { projectionId: "proj-static-grid" },
        inputs: { layout: { state: "layout" } },
        outputs: { layout: { state: "layout" } },
      },
    },
  });

  const projections: Record<string, DirectProjection> = {
    "proj-static-grid": {
      ...meta,
      id: "proj-static-grid",
      name: "Static Grid",
      componentId: "@ontomato/sdk:GroupedGrid",
      data: {},
      config: {
        columns: 12,
        rowHeight: 160,
        gap: 16,
        showGroupHeaders: false,
        allowHide: true,
        items: [
          { id: "first", title: "First Block", groupId: "main", colSpan: 6, rowSpan: 2, minColSpan: 3, maxColSpan: 9 },
          { id: "second", title: "Second Block", groupId: "main", colSpan: 6, rowSpan: 2 },
          { id: "third", title: "Third Block", groupId: "main", colSpan: 4, rowSpan: 1, hidden: true },
        ],
      },
      inputs: {
        layout: {
          kind: "grid-layout",
          columns: 12,
          maxRowSpan: 6,
          groupIds: ["main"],
          itemIds: ["first", "second", "third"],
        },
      },
      outputs: {
        layout: {
          kind: "grid-layout",
          columns: 12,
          maxRowSpan: 6,
          groupIds: ["main"],
          itemIds: ["first", "second", "third"],
        },
      },
    },
  };

  const layoutChanges: unknown[] = [];
  const dataReadSpy = vi.fn(() => {
    throw new Error("Fixed-member GroupedGrid must not trigger any data read");
  });

  const { container, instance } = mountDirect(
    manifest,
    projections,
    dataReadSpy,
    (inst) =>
      h(
        PanelMember,
        {
          instance: inst,
          member: "canvas",
          onLayoutChange: (payload: unknown) => layoutChanges.push(payload),
        },
        {
          item: ({ itemId, title, colSpan, rowSpan }: { itemId: string; title: string; colSpan: number; rowSpan: number }) =>
            h("div", { class: "static-slot-body", "data-static-id": itemId }, `${title}:${colSpan}x${rowSpan}`),
        },
      ),
  );

  await vi.waitFor(() => {
    expect(container.querySelectorAll<HTMLElement>(".sdk-grouped-grid-item").length).toBe(2);
  });

  // Zero data reads, no group headers, hidden item omitted, read-only outputs published
  expect(dataReadSpy).not.toHaveBeenCalled();
  expect(container.querySelector(".sdk-grouped-grid-group-header")).toBeNull();
  expect([...container.querySelectorAll<HTMLElement>(".sdk-grouped-grid-item")].map((el) => el.getAttribute("data-item-id"))).toEqual([
    "first",
    "second",
  ]);
  expect(container.querySelector('[data-static-id="first"]')?.textContent).toBe("First Block:6x2");
  expect(instance.outputs.canvas?.itemCount).toBe(2);
  expect(instance.outputs.canvas?.hiddenCount).toBe(1);
  expect(layoutChanges).toHaveLength(0);

  // Dragging 'second' before 'first' writes valid grid-layout state and preserves hidden 'third'
  const firstEl = container.querySelector<HTMLElement>('[data-item-id="first"]')!;
  const secondEl = container.querySelector<HTMLElement>('[data-item-id="second"]')!;
  const secondHandle = secondEl.querySelector<HTMLElement>('[data-testid="grouped-grid-item-handle"]')!;
  secondHandle.dispatchEvent(new Event("dragstart", { bubbles: true }));
  firstEl.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
  firstEl.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
  await flush();

  expect(layoutChanges).toHaveLength(1);
  expect(instance.state.values.value.layout).toEqual({
    groups: [
      {
        id: "main",
        items: [
          { id: "second", colSpan: 6, rowSpan: 2 },
          { id: "first", colSpan: 6, rowSpan: 2 },
          { id: "third", colSpan: 4, rowSpan: 1, hidden: true },
        ],
      },
    ],
  });

  // Resizing 'first' respects per-item maxColSpan=9 and updates layout state
  const firstResizeHandle = container.querySelector<HTMLElement>('[data-item-id="first"] [data-testid="grouped-grid-resize-handle"]')!;
  firstResizeHandle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
  window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 800, clientY: 200 }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  await flush();

  expect(layoutChanges).toHaveLength(2);
  const afterResize = instance.state.values.value.layout as { groups: Array<{ items: Array<{ id: string; colSpan: number; rowSpan: number; hidden?: boolean }> }> };
  const resizedFirst = afterResize.groups[0]!.items.find((item) => item.id === "first")!;
  expect(resizedFirst.colSpan).toBe(9);
  expect(resizedFirst.rowSpan).toBeGreaterThan(2);

  // Clicking hide on 'second' marks it hidden in layout state and removes it from the rendered grid
  const hideBtn = container.querySelector<HTMLElement>('[data-item-id="second"] [data-testid="grouped-grid-item-hide"]')!;
  hideBtn.click();
  await flush();

  expect(layoutChanges).toHaveLength(3);
  expect([...container.querySelectorAll<HTMLElement>(".sdk-grouped-grid-item")].map((el) => el.getAttribute("data-item-id"))).toEqual(["first"]);
  expect(instance.outputs.canvas?.itemCount).toBe(1);
  expect(instance.outputs.canvas?.hiddenCount).toBe(2);
  const afterHide = instance.state.values.value.layout as { groups: Array<{ items: Array<{ id: string; hidden?: boolean }> }> };
  expect(afterHide.groups[0]!.items.find((item) => item.id === "second")?.hidden).toBe(true);

  // External state update immediately re-renders order, spans, and visibility
  instance.state.set("layout", {
    groups: [
      {
        id: "main",
        items: [
          { id: "third", colSpan: 8, rowSpan: 3 },
          { id: "first", colSpan: 4, rowSpan: 2 },
          { id: "second", colSpan: 6, rowSpan: 2, hidden: true },
        ],
      },
    ],
  });
  await flush();

  expect([...container.querySelectorAll<HTMLElement>(".sdk-grouped-grid-item")].map((el) => el.getAttribute("data-item-id"))).toEqual([
    "third",
    "first",
  ]);
  expect(container.querySelector('[data-static-id="third"]')?.textContent).toBe("Third Block:8x3");
  expect(instance.outputs.canvas?.itemCount).toBe(2);
  expect(instance.outputs.canvas?.hiddenCount).toBe(1);
});

it("MetricChart supports fileOverride, minHeight, and exposed refresh()", async () => {
  const savedFile = dashboardChartFileSchema.parse({
    name: "saved.chart.json",
    content: {
      dataset: [{ id: "metric", dimensions: ["k", "v"], source: [] }],
      xAxis: { type: "category" },
      yAxis: { type: "value" },
      series: [{ id: "s0", type: "bar", datasetId: "metric", encode: { x: "k", y: "v" } }],
      ontomato: { display: { formats: { v: { kind: "number" } } } },
    },
  });
  const draftFile = dashboardChartFileSchema.parse({
    name: "draft.chart.json",
    content: {
      dataset: [{ id: "metric", dimensions: ["k", "v"], source: [] }],
      xAxis: { type: "category" },
      yAxis: { type: "value" },
      series: [{ id: "s0", type: "line", datasetId: "metric", encode: { x: "k", y: "v" } }],
      ontomato: { display: { formats: { v: { kind: "number" } } } },
    },
  }).content;

  const template = shallowRef<MemberDataState>({ status: "ready", value: { chartFile: savedFile } as never });
  const result = shallowRef<MemberDataState>({
    status: "ready",
    value: {
      columns: [{ key: "k", label: "K", type: "string" }, { key: "v", label: "V", type: "number" }],
      rows: [{ k: "A", v: 42 }],
      truncation: null,
    } as never,
  });
  const refreshSpy = vi.fn();
  const projection = { id: "chart-1", componentId: "@ontomato/sdk:MetricChart" } as unknown as DirectProjection;
  const member: PanelMemberContext = {
    key: "chart",
    projection,
    inputs: computed(() => ({})),
    operations: computed(() => ({ status: "ready" as const, value: {} })),
    data: {
      use: (name) => computed(() => (name === "template" ? template.value : result.value)),
      read: () => { throw new Error("unexpected read"); },
      refresh: refreshSpy,
    },
  };

  const overrideRef = ref<typeof draftFile | null>(null);
  const chartCompRef = ref<{ refresh: () => void } | null>(null);
  const el = document.createElement("div");
  document.body.append(el);
  const app = createApp({
    setup: () => () =>
      h(MetricChart, {
        ref: chartCompRef,
        fileOverride: overrideRef.value,
        minHeight: "220px",
      }),
  });
  app.provide(projectionKey, { slot: "chart", projection: projection as never, inputs: {} });
  app.provide(panelMemberKey, () => member);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en } }));
  app.use(ElementPlus);
  app.mount(el);
  cleanup = () => app.unmount();

  await flush();
  expect(el.querySelector<HTMLElement>(".sdk-metric-chart")?.style.minHeight).toBe("220px");
  expect(el.querySelector(".mock-echart")?.getAttribute("data-series-type")).toBe("bar");

  // Switch to draft fileOverride
  overrideRef.value = draftFile;
  await flush();
  expect(el.querySelector(".mock-echart")?.getAttribute("data-series-type")).toBe("line");

  // Call exposed refresh()
  chartCompRef.value!.refresh();
  expect(refreshSpy).toHaveBeenCalledTimes(1);
});

it("MetricCard supports ChartDisplay formats, truncation tooltip, and exposed refresh()", async () => {
  const result = shallowRef<MemberDataState>({
    status: "ready",
    value: {
      columns: [{ key: "rate", label: "Conversion Rate", type: "number" }],
      rows: [{ rate: 0.256 }],
      truncation: { truncationHint: "Truncated to 1000 rows" },
    } as never,
  });
  const refreshSpy = vi.fn();
  const projection = {
    id: "kpi-1",
    componentId: "@ontomato/sdk:MetricCard",
    data: { result: { source: { object: { input: "target" } }, read: "result", params: {} } },
    config: {},
  } as unknown as DirectProjection;
  const member: PanelMemberContext = {
    key: "kpi",
    projection,
    inputs: computed(() => ({})),
    operations: computed(() => ({ status: "ready" as const, value: {} })),
    data: {
      use: () => computed(() => result.value),
      read: () => { throw new Error("unexpected read"); },
      refresh: refreshSpy,
    },
  };

  const cardRef = ref<{ refresh: () => void } | null>(null);
  const el = document.createElement("div");
  document.body.append(el);
  const app = createApp({
    setup: () => () =>
      h(MetricCard, {
        ref: cardRef,
        field: "rate",
        formats: { rate: { kind: "percent", scale: 100, decimals: 1 } },
      }),
  });
  app.provide(panelMemberKey, () => member);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en } }));
  app.mount(el);
  cleanup = () => app.unmount();

  await flush();
  expect(el.querySelector(".sdk-metric-card-value")?.textContent).toBe("25.6%");
  expect(el.querySelector(".sdk-metric-card-truncation")?.getAttribute("title")).toBe("Truncated to 1000 rows");

  cardRef.value!.refresh();
  expect(refreshSpy).toHaveBeenCalledTimes(1);
});
