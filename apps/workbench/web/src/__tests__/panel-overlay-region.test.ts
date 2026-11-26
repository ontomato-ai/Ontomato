/* eslint-disable vue/one-component-per-file */
import { afterEach, expect, it, vi } from "vitest";
import { computed, createApp, defineComponent, h, nextTick, provide, ref, type Component } from "vue";
import ElementPlus, { ElMessage } from "element-plus";
import { createI18n } from "vue-i18n";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { dashboardChartFileSchema } from "@ontomato/contracts/dashboard";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { createPanelOverlayRoot } from "@ontomato/platform-shell";
import { createDirectPanelInstance } from "../../../../../packages/apps-sdk/src/panel/direct";
import { panelContextKey, type PanelContext } from "../../../../../packages/apps-sdk/src/panel/context";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { SdkDialog } from "../../../../../packages/apps-sdk/src/ui/SdkDialog";
import { SdkDrawer } from "../../../../../packages/apps-sdk/src/ui/SdkDrawer";
import MetricChart from "../../../../../packages/apps-sdk/src/base/MetricChart.vue";
import ProductAssetGraph from "../../../../../packages/apps-sdk/src/base/ProductAssetGraph.vue";
import { noOperations } from "./panel-frame";

vi.mock("../../../../../packages/foundation-ui/src/chart/EChart.vue", () => ({
  default: defineComponent({
    props: ["option"],
    setup: () => () => h("div", { class: "mock-echart" }),
  }),
}));

const cleanups: Array<() => void> = [];
let overlaySerial = 0;

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  ElMessage.closeAll();
  document.body.innerHTML = "";
});

async function flush() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function mountInPanel(component: Component, props: Record<string, unknown>, options?: { panel?: boolean }) {
  const region = document.createElement("section");
  document.body.append(region);
  const overlay = createPanelOverlayRoot(`overlay-region-${++overlaySerial}`, () => true, () => region);
  const panel = {
    overlayRoot: overlay.element,
    windowOverlayRoot: overlay.windowElement,
    overlayShown: computed(() => true),
  } as unknown as PanelContext;
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp(defineComponent({
    setup() {
      if (options?.panel !== false) provide(panelContextKey, panel);
      return () => h(component, props);
    },
  }));
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus).mount(host);
  cleanups.push(() => {
    app.unmount();
    overlay.dispose();
    host.remove();
    region.remove();
  });
  return { app, host, overlay, region, windowRoot: overlay.windowElement };
}

it("routes ordinary dialogs and drawers into the page-region root and fullscreen dialogs into the whole-window root", async () => {
  const dialog = mountInPanel(SdkDialog as Component, { modelValue: true, title: "Ordinary" });
  await vi.waitFor(() => expect(dialog.overlay.element.querySelector(".el-dialog")).not.toBeNull());
  expect(dialog.windowRoot.querySelector(".el-dialog")).toBeNull();

  const fullscreen = mountInPanel(SdkDialog as Component, { modelValue: true, title: "Fullscreen", fullscreen: true });
  await vi.waitFor(() => expect(fullscreen.windowRoot.querySelector(".el-dialog.is-fullscreen")).not.toBeNull());
  expect(fullscreen.overlay.element.querySelector(".el-dialog")).toBeNull();

  const drawer = mountInPanel(SdkDrawer as Component, { modelValue: true, title: "Drawer" });
  await vi.waitFor(() => expect(drawer.overlay.element.querySelector(".el-drawer")).not.toBeNull());
  expect(drawer.windowRoot.querySelector(".el-drawer")).toBeNull();
});

const chartFile = dashboardChartFileSchema.parse({
  name: "revenue.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["region", "amount"], source: [] }],
    xAxis: { type: "category" },
    yAxis: { type: "value" },
    series: [{ id: "series-0", type: "bar", datasetId: "metric", encode: { x: "region", y: "amount" } }],
    ontomato: { display: { formats: { amount: { kind: "number" } } } },
  },
}).content;
const metric = {
  columns: [{ key: "region", label: "Region", type: "string" }, { key: "amount", label: "Amount", type: "number" }],
  rows: [{ region: "east", amount: 12 }],
  truncation: null,
};

it("mounts the MetricChart zoom SdkDialog in the whole-window root and removes its test marker immediately on close", async () => {
  const mounted = mountInPanel(MetricChart as Component, {
    title: "Revenue",
    fileOverride: chartFile,
    metricOverride: metric,
    allowZoom: true,
  });
  await vi.waitFor(() => expect(mounted.host.querySelector('[data-testid="metric-chart-zoom"]')).not.toBeNull());
  mounted.host.querySelector<HTMLButtonElement>('[data-testid="metric-chart-zoom"]')!.click();
  await vi.waitFor(() => expect(mounted.windowRoot.querySelector('[data-testid="metric-chart-zoom-modal"]')).not.toBeNull());
  expect(mounted.windowRoot.querySelector(".el-dialog.sdk-metric-chart-zoom-dialog")).not.toBeNull();
  expect(mounted.overlay.element.querySelector('[data-testid="metric-chart-zoom-modal"]')).toBeNull();

  mounted.windowRoot.querySelector<HTMLButtonElement>('[data-testid="metric-chart-zoom-close"]')!.click();
  await flush();
  expect(document.querySelector('[data-testid="metric-chart-zoom-modal"]')).toBeNull();
});

it("falls back to document.body for the MetricChart zoom dialog outside a panel", async () => {
  const mounted = mountInPanel(MetricChart as Component, {
    fileOverride: chartFile,
    metricOverride: metric,
    allowZoom: true,
    zoomed: true,
  }, { panel: false });
  await vi.waitFor(() => expect(document.querySelector(".el-dialog.sdk-metric-chart-zoom-dialog")).not.toBeNull());
  expect(document.querySelector(".el-dialog.sdk-metric-chart-zoom-dialog")?.closest("[data-panel-overlay-root]")).toBeNull();
  expect(mounted.overlay.element.querySelector(".el-dialog")).toBeNull();
});

it("mounts the ProductAssetGraph fullscreen preview in the whole-window root", async () => {
  const mounted = mountInPanel(ProductAssetGraph as Component, {
    graph: {
      nodes: [{ id: "node-1", assetId: "asset-1", name: "Asset one", kind: "object-projection", category: "element" }],
      edges: [],
    },
  });
  await vi.waitFor(() => expect(mounted.host.querySelector('[data-product-graph-action="expand"]')).not.toBeNull());
  mounted.host.querySelector<HTMLButtonElement>('[data-product-graph-action="expand"]')!.click();
  await vi.waitFor(() => expect(mounted.windowRoot.querySelector(".el-dialog.is-fullscreen.sdk-product-asset-graph-dialog")).not.toBeNull());
  expect(mounted.overlay.element.querySelector(".sdk-product-asset-graph-dialog")).toBeNull();
});

it("appends the direct panel's default notify message to the page-region overlay root", async () => {
  const region = document.createElement("section");
  document.body.append(region);
  const overlay = createPanelOverlayRoot("overlay-notify", () => true, () => region);
  cleanups.push(() => overlay.dispose());
  const instance = createDirectPanelInstance(definePanel({ state: {}, members: {} }), {
    pageKey: "overlay-notify",
    url: () => "/overlay-notify",
    label: () => "Overlay notify",
    initial: {},
    text: createPanelText({}, ref("en"), "en"),
    ...noOperations,
    overlayRoot: overlay.element,
    windowOverlayRoot: overlay.windowElement,
    read: async () => { throw new Error("This test reads no panel data"); },
    readProjection: async () => { throw new Error("This test reads no projection"); },
  });

  instance.notify({ kind: "success", text: "Saved" });
  await vi.waitFor(() => expect(overlay.element.querySelector(".el-message")?.textContent).toContain("Saved"));
  expect(overlay.windowElement.querySelector(".el-message")).toBeNull();
});
