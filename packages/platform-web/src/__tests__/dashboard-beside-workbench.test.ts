import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h, ref } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { PageCounter } from "@ontomato/agent-shell-ui";
import { pageCounterKey } from "@ontomato/agent-shell-ui";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import { useDashboardSurface } from "@ontomato/workbench-ui/features/dashboard";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import elementEn from "element-plus/es/locale/lang/en";
import DashboardsPage from "../pages/DashboardsRoute.vue";
import { resolvePilotPage } from "../pilot-pages";

/*
 * The board beside the conversation (DESIGN.md "Applications and shells"): a link in a conversation opens it there
 * rather than leaving the agent platform, and the board's own composer sends to the counter with the board it was
 * written on, which opens the same board beside the message.
 *
 * These mount the workbench itself, because the rule is about the address it carries: `?page=` keeps the agent platform
 * where it is, while the page is drawn from the platform's registry.
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

// The shell draws the conversation; these tests read the page it opens beside it and the links it hands the host.
const shellProps = ref<Record<string, unknown> | null>(null);
vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  AgentShell: defineComponent({
    name: "AgentShell",
    props: ["featureId", "pageContext", "pageLinks"],
    emits: ["update:featureId"],
    setup(props, { slots, expose }) {
      shellProps.value = props as unknown as Record<string, unknown>;
      expose({ reloadAgents: () => {}, send: async () => {} });
      return () => h("div", { class: "shell" }, [slots.feature?.({ featureId: props.featureId })]);
    },
  }),
  useAgentNav: () => ({
    agents: ref([]),
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
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => null }));
vi.mock("../assistant-host", () => ({ createAssistantClient: () => ({ listAgents: async () => [] }), createAssistantFeedback: () => ({}) }));

installWorkbenchI18n({
  supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
  messages: { en: {} }, elementLocale: () => elementEn,
});

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  shellProps.value = null;
  document.body.innerHTML = "";
});

async function routerAt(path: string): Promise<Router> {
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
  await router.push(path);
  await router.isReady();
  return router;
}

const provide = () => ({
  [pilotPageKey as symbol]: resolvePilotPage,
  // The platform answers which of its pages the account may open; the settings need an answer to draw their column.
  [platformPageAccessKey as symbol]: () => true,
  [pageCounterKey as symbol]: {
    agents: ref([{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Assistant", description: "", icon: null, enabled: true }]),
    preferredAgentId: ref("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    ask: vi.fn(),
  } satisfies PageCounter,
});

describe("a dashboard beside the conversation", () => {
  it("opens from a conversation's link without leaving the agent platform, at the board the link names", async () => {
    const router = await routerAt(platformRoutes.chat.path);
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide() },
    });
    wrappers.push(wrapper);
    await flushPromises();

    const open = (shellProps.value as unknown as { pageLinks?: (href: string) => (() => void) | null }).pageLinks!(
      "/dashboards?dashboardId=board-a",
    )!;
    open();
    await flushPromises();

    // Still the agent platform, with the board's own address carried as its page parameter.
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(router.currentRoute.value.query.page).toBe("/dashboards?dashboardId=board-a");
    expect(wrapper.find(".board").text()).toBe("board-a");
  });

  it("lands on the counter with the same board beside it when the board's own composer sends", async () => {
    // What a page's composer does: the counter's address, with the page it was written on.
    const router = await routerAt(platformRoutes.chat.path);
    const address = "/dashboards?dashboardId=board-a";
    await router.replace({
      path: platformRoutes.chat.path,
      query: { agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", prompt: "Which region grew fastest?", page: address },
    });
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide() },
    });
    wrappers.push(wrapper);
    await flushPromises();

    // The counter, not the dashboard application: the board is the page beside the conversation.
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(router.currentRoute.value.query.page).toBe(address);
    expect(wrapper.find(".board").text()).toBe("board-a");
  });
});
