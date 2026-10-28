import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import ChartZoomModal from "../ChartZoomModal.vue";
import { workbenchI18n } from "../../../../i18n";
import { installWorkbenchContent, workbenchContent, type DashboardVisuals } from "../../../../content";

const echartsMock = vi.hoisted(() => ({
  registerTheme: vi.fn(),
  init: vi.fn(() => ({ setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() })),
}));
vi.mock("echarts", () => echartsMock);
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
  echartsMock.registerTheme.mockClear();
  echartsMock.init.mockClear();
  document.body.innerHTML = "";
});

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
const global = () => ({ plugins: [workbenchI18n(), createPinia(), router, ElementPlus] });

describe("dashboard display inputs under both layouts", () => {
  async function openZoom() {
    const wrapper = mount(ChartZoomModal, { props: { option: { series: [] } }, global: global() });
    // The component is a JS <script setup>, so test-utils cannot infer its props type.
    await wrapper.setProps({ open: true } as never);
    await flushPromises();
    return wrapper;
  }

  it("zoom dialog: echarts default theme when configured; open source registers the dashboard theme and initializes by theme name", async () => {
    useDashboardVisuals({ zoomChartTheme: "default" });
    await openZoom();
    expect(echartsMock.registerTheme).not.toHaveBeenCalled();
    expect(echartsMock.init).toHaveBeenCalledWith(expect.any(HTMLElement));
    expect(echartsMock.init.mock.calls[0]).toHaveLength(1);

    installWorkbenchContent(ossContent);
    echartsMock.init.mockClear();
    await openZoom();
    expect(echartsMock.registerTheme).toHaveBeenCalledWith(ossContent.dashboard.themeName, expect.any(Object));
    expect(echartsMock.init).toHaveBeenCalledWith(expect.any(HTMLElement), ossContent.dashboard.themeName);
  });


});
