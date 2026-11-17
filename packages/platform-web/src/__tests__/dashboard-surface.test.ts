import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h, nextTick, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { pageCounterKey } from "@ontomato/agent-shell-ui";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import { useDashboardStore } from "@ontomato/workbench-ui/features/dashboard";
import elementEn from "element-plus/es/locale/lang/en";
import DashboardsPage from "../pages/DashboardsRoute.vue";
import { pilotPageResolver } from "../pilot-pages";

/*
 * The board's own store is one per page load, but the page is mounted in two ways: as the dashboards application at its
 * address, and beside a conversation. The board and its navigation therefore belong to the mounted page, not to the
 * store: these drive the real store through both — first beside the conversation and then enlarged, and the reverse —
 * and hold that the address that changes is the one of the page the board is currently in, with the other left alone.
 */

/** The dashboards' own requests: one list of two boards, and nothing else here. */
const boards = () => ({ data: [{ id: "board-a", name: "Sales" }, { id: "board-b", name: "Stock" }] });
// The board's own drawing is another line's; these read where the board is, not what it draws.
vi.mock("@ontomato/workbench-ui/features/dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/workbench-ui/features/dashboard")>()),
  DashboardHome: defineComponent({ name: "DashboardHome", setup: () => () => h("div", { class: "board" }) }),
  DashboardPanel: defineComponent({ name: "DashboardPanel", setup: () => () => h("div", { class: "panel" }) }),
}));

// The workbench's shell is the conversation application; these read the page it draws beside the chat and its links,
// and the message the host asks it to send.
const shellProps = ref<Record<string, unknown> | null>(null);
const sent: string[] = [];
const agent = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Assistant", description: "", icon: null, enabled: true };
vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  AgentShell: defineComponent({
    name: "AgentShell",
    props: ["featureId", "pageContext", "pageLinks"],
    emits: ["update:featureId"],
    setup(props, { slots, expose }) {
      shellProps.value = props as unknown as Record<string, unknown>;
      expose({ reloadAgents: () => {}, send: async (text: string) => sent.push(text) });
      return () => h("div", { class: "shell" }, [slots.feature?.({ featureId: props.featureId })]);
    },
  }),
  useAgentNav: () => ({
    agents: ref([agent]),
    sessions: ref([]),
    sessionsState: ref("ready"),
    nextCursor: ref(null),
    currentAgent: ref(null),
    loadAgents: async () => {},
    loadSessions: async () => {},
    startNew: () => {},
    selectSession: () => {},
    removeSession: async () => {},
    promoteSession: () => {},
  }),
  useSessionRunFeed: () => {},
}));
vi.mock("../../workbench-ui/src/features/workbench/api", () => ({ getWorkbenchAppearance: async () => null }));
vi.mock("../../workbench-ui/src/features/workbench/assistant-host", () => ({
  createAssistantClient: () => ({ listAgents: async () => [] }),
  createAssistantFeedback: () => ({}),
}));

installWorkbenchI18n({
  supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
  messages: { en: {} }, elementLocale: () => elementEn,
});

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  setActivePinia(createPinia());
  sent.splice(0);
  vi.stubGlobal("fetch", async (url: string) =>
    String(url).includes("/dashboards/queryList")
      ? Response.json(boards())
      : Response.json({ data: null }),
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  shellProps.value = null;
  document.body.innerHTML = "";
});

async function routerAt(path: string, query: Record<string, string> = {}): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { ...platformRoutes.chat, component: { template: "<div />" } },
      { ...platformRoutes.agents, component: { template: "<div />" } },
      { ...platformRoutes.agentSettingsNew, component: { template: "<div />" } },
      { ...platformRoutes.agentSettings, component: { template: "<div />" } },
      { path: platformRoutes.dashboards.path, component: { template: "<div />" } },
    ],
  });
  await router.push({ path, query });
  await router.isReady();
  return router;
}

const provide = (router?: Router) => ({
  [pilotPageKey as symbol]: pilotPageResolver,
  [platformPageAccessKey as symbol]: () => true,
  [pageCounterKey as symbol]: {
    agents: async () => [agent],
    preferredAgentId: ref<string | null>(agent.id),
    // What the platform's assembly does with a page's message: the counter's address, with the page it was written on.
    ask: (agentId: string, text: string, page: string) =>
      void router?.push({ path: platformRoutes.chat.path, query: { agentId, prompt: text, page } }),
  },
});

const boardShown = () => useDashboardStore().currentDashboardId;

describe("the board belongs to the page it is mounted on", () => {
  it("beside the conversation, a board change moves the page parameter and leaves the dashboards address alone", async () => {
    const router = await routerAt(platformRoutes.chat.path);
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide(router) },
    });
    wrappers.push(wrapper);
    await flushPromises();

    (
      shellProps.value as unknown as { pageLinks?: (href: string) => (() => void) | null }
    ).pageLinks!("/dashboards?dashboardId=board-a")!();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(boardShown()).toBe("board-a");

    useDashboardStore().selectDashboard("board-b");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(router.currentRoute.value.query.page).toBe("/dashboards?dashboardId=board-b");
  });

  it("enlarged, a board change moves the dashboards address and leaves the conversation alone", async () => {
    const router = await routerAt(platformRoutes.chat.path);
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide(router) },
    });
    wrappers.push(wrapper);
    await flushPromises();
    (
      shellProps.value as unknown as { pageLinks?: (href: string) => (() => void) | null }
    ).pageLinks!("/dashboards?dashboardId=board-a")!();
    await flushPromises();

    // Enlarged: the same store, now held by the dashboards page at its own address.
    await router.push("/dashboards?dashboardId=board-a");
    await flushPromises();
    const standalone = mount(DashboardsPage, {
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide(router) },
    });
    wrappers.push(standalone);
    await flushPromises();
    expect(boardShown()).toBe("board-a");

    useDashboardStore().selectDashboard("board-b");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(platformRoutes.dashboards.path);
    expect(router.currentRoute.value.query).toEqual({ dashboardId: "board-b" });
  });

  it("sends from the board's own composer into the counter, with the same board beside the message", async () => {
    const router = await routerAt("/dashboards", { dashboardId: "board-a" });
    const standalone = mount(DashboardsPage, {
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide(router) },
    });
    wrappers.push(standalone);
    await flushPromises();

    await standalone.find("textarea").setValue("Which region grew fastest?");
    await flushPromises();
    await standalone.find("form.composer").trigger("submit");
    await flushPromises();

    // The counter, at the address the page's message names: the message is sent and the board stays beside it.
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(router.currentRoute.value.query.agentId).toBe(agent.id);
    expect(router.currentRoute.value.query.page).toBe("/dashboards?dashboardId=board-a");
    // The reader is at the counter now: the dashboards application's own page has gone with the address.
    standalone.unmount();
    wrappers.splice(wrappers.indexOf(standalone), 1);
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide() },
    });
    wrappers.push(wrapper);
    await flushPromises();

    expect(sent).toEqual(["Which region grew fastest?"]);
    expect(router.currentRoute.value.query.page).toBe("/dashboards?dashboardId=board-a");
    expect(boardShown()).toBe("board-a");
  });

  it("from its own address back beside the conversation, a board change moves the page parameter again", async () => {
    const router = await routerAt("/dashboards", { dashboardId: "board-a" });
    const standalone = mount(DashboardsPage, { global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide(router) } });
    wrappers.push(standalone);
    await flushPromises();
    expect(boardShown()).toBe("board-a");
    standalone.unmount();
    wrappers.splice(wrappers.indexOf(standalone), 1);
    // The reader goes on from the board's own address to the conversation it is open beside.
    await router.push(platformRoutes.chat.path);
    await flushPromises();

    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide(router) },
    });
    wrappers.push(wrapper);
    await flushPromises();
    (
      shellProps.value as unknown as { pageLinks?: (href: string) => (() => void) | null }
    ).pageLinks!("/dashboards?dashboardId=board-a")!();
    await flushPromises();
    expect(boardShown()).toBe("board-a");

    useDashboardStore().selectDashboard("board-b");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(router.currentRoute.value.query.page).toBe("/dashboards?dashboardId=board-b");
  });
});
