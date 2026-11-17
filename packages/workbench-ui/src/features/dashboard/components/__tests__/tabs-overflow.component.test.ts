import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import ElementPlus, { ElMessage } from "element-plus";
import DashboardHome from "../DashboardHome.vue";
import { workbenchI18n } from "../../../../i18n";

/**
 * The boards are a row that scrolls when they do not fit — beside a conversation at the platform's panel width, and on
 * a narrow page. The board a reader opened is always in sight, whether it came from the address, the conversation's page
 * parameter or a click; where more boards wait, an arrow says so and steps one board's width. Doubles: the board list,
 * the board's own API and the platform's chart.
 */
const api = vi.hoisted(() => ({ boards: [] as { id: string; name: string }[] }));
vi.mock("../../../workbench/assistant-host", () => ({ createAssistantClient: () => ({ readPageDraft: async () => ({}) }) }));
vi.mock("../../api", () => ({
  fetchDashboardList: async () => api.boards.map((board) => ({ ...board, createdAt: 0, updatedAt: 0 })),
  fetchDashboardLocalDetail: async (id: string) => ({ id, ownerId: "u1", name: id, createdAt: 0, updatedAt: 0, groups: [] }),
  queryDashboardCard: async () => ({ card: {}, metric: {}, columns: [], rows: [], truncation: null }),
  modifyDashboardLayout: async () => true,
  modifyResultSetName: async () => true,
  fetchCardParameterForm: async () => ({ revision: "r1", fields: [], values: {}, readOnly: [] }),
  saveCardParameters: async () => ({ cardId: "", query: {}, revision: "r1" }),
  createDimension: async () => true,
  deleteDimension: async () => true,
  deleteMetric: async () => true,
  modifyDimensionName: async () => true,
  modifyMetricName: async () => true,
  renameDashboard: async () => true,
}));

/** A board row that does not fit: the strip is 449px wide and the boards need 751, as the 1024 report measured. */
const STRIP = 449;
const SCROLL_WIDTH = 751;
let scrollLeft = 0;
function layOutStrip(root: Element) {
  const strip = root.querySelector<HTMLElement>(".tabs");
  if (!strip) return;
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: STRIP });
  Object.defineProperty(strip, "scrollWidth", { configurable: true, value: SCROLL_WIDTH });
  Object.defineProperty(strip, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = Math.max(0, Math.min(SCROLL_WIDTH - STRIP, value));
      strip.dispatchEvent(new Event("scroll"));
    },
  });
  // Four boards, one after another: the row is 751px and the last one ends exactly where it does.
  const width = SCROLL_WIDTH / 4;
  for (const [index, tab] of [...strip.querySelectorAll<HTMLElement>(".tab")].entries()) {
    Object.defineProperty(tab, "offsetLeft", { configurable: true, value: index * width });
    Object.defineProperty(tab, "offsetWidth", { configurable: true, value: width });
  }
}

const router = (query: Record<string, string>) => {
  const created = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
  return created.push({ path: "/", query }).then(() => created);
};

afterEach(() => {
  scrollLeft = 0;
  document.body.innerHTML = "";
});

describe("the board row", () => {
  it("scrolls the open board into sight, and says where more boards wait", async () => {
    api.boards = [
      { id: "d1", name: "一" },
      { id: "d2", name: "二" },
      { id: "d3", name: "三" },
      { id: "d4", name: "四" },
    ];
    const at = await router({ dashboardId: "d4" });
    const wrapper = mount(DashboardHome, { global: { plugins: [workbenchI18n(), createPinia(), at, ElementPlus], stubs: { EChart: true, transition: false } } });
    await flushPromises();
    layOutStrip(wrapper.element);
    // A panel measured again at another width (the side panel, the window) reopens the row at that width.
    window.dispatchEvent(new Event("resize"));
    await flushPromises();

    // The fourth board is the open one and it did not fit: the row moved so that it does.
    expect(wrapper.find(".tab.active .tab-open").text()).toBe("四");
    const strip = wrapper.find(".tabs").element as HTMLElement;
    expect(strip.scrollLeft).toBeGreaterThan(0);
    const open = wrapper.find(".tab.active").element as HTMLElement;
    expect(open.offsetLeft + open.offsetWidth).toBeLessThanOrEqual(strip.scrollLeft + STRIP);

    // More boards wait to the left, and pressing the arrow steps back by one board.
    const left = wrapper.find(".tabs-scroll--left");
    expect(left.exists()).toBe(true);
    expect(wrapper.find(".tabs-scroll--right").exists()).toBe(false);
    const scrolled = strip.scrollLeft;
    (strip as { scrollBy(options?: ScrollToOptions): void }).scrollBy = (options?: ScrollToOptions) => {
      strip.scrollLeft = strip.scrollLeft + (options?.left ?? 0);
    };
    await left.trigger("click");
    expect(strip.scrollLeft).toBeLessThan(scrolled);

    // The open board follows the address, whichever way it came in.
    await at.push({ path: "/", query: { dashboardId: "d1" } });
    await flushPromises();
    expect(wrapper.find(".tab.active .tab-open").text()).toBe("一");
    expect(strip.scrollLeft).toBe(0);
    wrapper.unmount();
  });

  it("says nothing when every board fits", async () => {
    api.boards = [{ id: "d1", name: "一" }];
    const at = await router({ dashboardId: "d1" });
    const wrapper = mount(DashboardHome, { global: { plugins: [workbenchI18n(), createPinia(), at, ElementPlus], stubs: { EChart: true, transition: false } } });
    await flushPromises();
    const strip = wrapper.find(".tabs").element as HTMLElement;
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: STRIP });
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: STRIP });
    strip.dispatchEvent(new Event("scroll"));
    await flushPromises();
    expect(wrapper.find(".tabs-scroll--left").exists()).toBe(false);
    expect(wrapper.find(".tabs-scroll--right").exists()).toBe(false);
    wrapper.unmount();
  });
});
