import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import { EChart } from "@ontomato/foundation-ui/chart";
import ChartZoomModal from "../ChartZoomModal.vue";
import { nativeEchartsTheme } from "../utils/echartsTheme";
import { workbenchI18n } from "../../../../i18n";
import { installWorkbenchContent, workbenchContent, type DashboardVisuals } from "../../../../content";

vi.mock("interactjs", () => ({
  default: Object.assign(() => ({ resizable: () => ({ unset: () => {} }) }), {
    modifiers: { restrictSize: () => ({}) },
  }),
}));

const ossContent = workbenchContent();
/** Overrides the two dashboard display inputs another layout may supply (the non-default values). */
function useDashboardVisuals(patch: Partial<DashboardVisuals>) {
  installWorkbenchContent({ ...ossContent, dashboard: { ...ossContent.dashboard, ...patch } });
}
afterEach(() => {
  installWorkbenchContent(ossContent);
  document.body.innerHTML = "";
});

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
const global = () => ({ plugins: [workbenchI18n(), createPinia(), router, ElementPlus], stubs: { EChart: true } });

describe("dashboard display inputs under both layouts", () => {
  async function zoomChartTheme() {
    const wrapper = mount(ChartZoomModal, { props: { option: { series: [] } }, global: global() });
    // The component is a JS <script setup>, so test-utils cannot infer its props type.
    await wrapper.setProps({ open: true } as never);
    await flushPromises();
    return wrapper.findComponent(EChart).props("theme");
  }

  it("zoom dialog: echarts default theme when configured; open source draws with the dashboard theme", async () => {
    useDashboardVisuals({ zoomChartTheme: "default" });
    expect(await zoomChartTheme()).toBeUndefined();

    installWorkbenchContent(ossContent);
    expect(await zoomChartTheme()).toEqual(nativeEchartsTheme(false));
  });


});
