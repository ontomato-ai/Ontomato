import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { pageCounterKey, type PageCounter } from "@ontomato/agent-shell-ui";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useDashboardSurface } from "@ontomato/workbench-ui/features/dashboard";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import elementEn from "element-plus/es/locale/lang/en";
import DashboardsPage from "../pages/DashboardsRoute.vue";

/*
 * The board beside the conversation (DESIGN.md "Applications and shells"): a link in a conversation opens it there
 * rather than leaving the agent platform, and the board's own composer sends to the counter with the board it was
 * written on, which opens the same board beside the message.
 */

// The board itself is another line's page; here it only has to be drawn from the surface it was mounted on.
vi.mock("@ontomato/workbench-ui/features/dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/workbench-ui/features/dashboard")>()),
  useDashboardStore: () => ({
    currentDashboardId: "board-a",
    dashboardItems: [{ id: "board-a", name: "Sales" }],
    loadDashboards: async () => {},
    selectDashboard: async () => {},
  }),
  DashboardHome: defineComponent({
    name: "DashboardHome",
    setup() {
      const surface = useDashboardSurface();
      return () => h("div", { class: "board" }, surface?.dashboardId ?? "none");
    },
  }),
}));



installWorkbenchI18n({ supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null, messages: { en: {} }, elementLocale: () => elementEn });
const i18n = workbenchI18n();
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

async function routerAt(path: string): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: platformRoutes.chat.path, component: { template: "<div />" } },
      { path: platformRoutes.dashboards.path, component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

describe("a dashboard beside the conversation", () => {
  it("sends from the board's own composer to the counter, keeping the board beside the conversation", async () => {
    const router = await routerAt("/dashboards?dashboardId=board-a");
    const ask = vi.fn();
    const counter: PageCounter = {
      agents: async () => [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Assistant", description: "", icon: null, enabled: true }],
      preferredAgentId: ref<string | null>("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      ask,
    };
    const wrapper = mount(DashboardsPage, {
      global: { plugins: [i18n, ElementPlus, router], provide: { [pageCounterKey as symbol]: counter } },
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();

    const input = wrapper.find("textarea");
    await input.setValue("Which region grew fastest?");
    await wrapper.find(".composer-button").trigger("click");
    expect(ask).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "Which region grew fastest?",
      "/dashboards?dashboardId=board-a",
    );
  });
});
