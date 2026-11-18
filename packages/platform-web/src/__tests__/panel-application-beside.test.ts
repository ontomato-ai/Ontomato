import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { AgentShell, pageCounterKey } from "@ontomato/agent-shell-ui";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { panelAddress, panelAddressState } from "@ontomato/contracts/panel-host";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import elementEn from "element-plus/es/locale/lang/en";
import { pilotPageResolver } from "../pilot-pages";
import { displayOf } from "../../../workbench-ui/src/features/workbench/__tests__/shell";

/*
 * A panel application's page beside the conversation (overall design 3.4, "the same PanelHost full, beside a
 * conversation and in another application"): `?page=/applications/<application>/<path>` opens the page the platform shows
 * at that address, beside the chat, at the state the address names; what the panel reports it shows rides on the
 * message; and a selection the reader makes is written into the conversation's page parameter without rebuilding the
 * panel.
 *
 * The mistakes these catch: the page opened as a full page in the conversation's place with no page context (the
 * workbench did not know the page); a selection that rebuilt the panel because the instance was keyed by the whole
 * address; and a selection written to the router's address, which would leave the conversation.
 */

const SCHEDULED_TASK = "platform:ScheduledTask";
const uses: ApplicationPanelUse[] = [
  {
    id: "use-tasks",
    panelId: "panel-tasks",
    path: "/tasks",
    pageKey: "panels-trial-a-tasks",
    access: { kind: "domain-member" },
  },
];
vi.mock("../panel-host", () => ({ panelUsesOf: async () => uses, platformPanelHost: () => ({}) }));

/** Every panel instance mounted, with the state it opened at. */
const instances: { initial: Record<string, unknown>; report: () => void }[] = [];
/** A frame that has not reported yet: it mounts, and says what it shows only when this is called. */
const silent = ref(false);
const selected = (primaryKey: string) => ({ selectedTask: { className: SCHEDULED_TASK, primaryKey } });
const contextOf = (address: string, primaryKey: string | null) => ({
  url: address,
  label: "Scheduled tasks (trial)",
  selection: primaryKey ? [{ kind: SCHEDULED_TASK, id: primaryKey, label: `Task ${primaryKey}` }] : [],
});

vi.mock("@ontomato/platform-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/platform-shell")>()),
  // Stands in for the frame: it reports what the reader looks at, and a selection as the address it is now at.
  PanelHost: defineComponent({
    props: { useId: String, address: String, initial: { type: Object, default: () => ({}) }, labels: Object },
    emits: ["address", "context"],
    setup(props, { emit }) {
      const opened = (props.initial as { selectedTask?: { primaryKey: string } }).selectedTask?.primaryKey ?? null;
      const report = () => emit("context", contextOf(panelAddress(props.address!, props.initial), opened));
      instances.push({ initial: props.initial, report });
      if (!silent.value) report();
      return () =>
        h("button", {
          class: "panel-double",
          "data-requested": JSON.stringify(props.initial),
          onClick: () => {
            const next = panelAddress(props.address!, selected("task-2"));
            emit("address", next);
            emit("context", contextOf(next, "task-2"));
          },
        });
    },
  }),
}));

const agent = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Analyst", description: "", icon: null, enabled: true };
// The shell is the real one, over a host that lists one agent.
vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  useSessionRunFeed: () => {},
}));
vi.mock("../../../workbench-ui/src/features/workbench/api", () => ({ getWorkbenchAppearance: async () => null }));
vi.mock("../../../workbench-ui/src/features/workbench/assistant-host", async () => {
  const { assistantHostDouble } = await import("../../../workbench-ui/src/features/workbench/__tests__/shell");
  return {
    createAssistantClient: () => assistantHostDouble({ agents: [agent] }),
    createAssistantFeedback: () => undefined,
    createPanelOperationSettings: () => undefined,
  };
});

beforeEach(() => {
  // Every mount starts from a frame that reports: one test holds that report back to see the page before it.
  silent.value = false;
  instances.splice(0);
});

beforeAll(() => {
  installWorkbenchI18n({
    supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
    messages: { en: {} }, elementLocale: () => elementEn,
  });
});


describe("a panel application's page beside the conversation", () => {
  it("opens beside the chat at its state, carries what the panel shows, and keeps the panel across a selection", async () => {
    const page = panelAddress("/applications/app-a/tasks", selected("task-1"));
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ ...platformRoutes.chat, component: { template: "<div />" } }],
    });
    await router.push({ path: platformRoutes.chat.path, query: { page } });
    await router.isReady();
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: {
        plugins: [workbenchI18n(), ElementPlus, router],
        provide: {
          [pilotPageKey as symbol]: pilotPageResolver,
          [platformPageAccessKey as symbol]: () => true,
          [pageCounterKey as symbol]: { agents: async () => [agent], preferredAgentId: ref<string | null>(agent.id), ask: () => {} },
        },
      },
    });
    await flushPromises();
    const display = displayOf(wrapper);
    const features = () => (wrapper.findComponent(AgentShell).props("workbench") as { features: { id: string }[] }).features;

    // The workbench knows the page: it sits beside the conversation, at its own address, named by the panel.
    expect(display.page.value?.featureId).toBe("panel-application");
    expect(features().find((feature) => feature.id === "panel-application")).toMatchObject({
      withConversation: true,
      scrollsItself: true,
      address: page,
      label: "Scheduled tasks (trial)",
    });
    // The panel opened at the state the page's address names, and what it shows rides on the message.
    expect(instances.map((each) => each.initial)).toEqual([selected("task-1")]);
    expect(display.pageContext.value).toEqual(contextOf(page, "task-1"));

    // The reader selects another task: the conversation's page parameter follows, the panel is the same one, and the
    // message carries the new selection.
    await wrapper.get(".panel-double").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(panelAddressState(String(router.currentRoute.value.query.page))).toEqual(selected("task-2"));
    expect(instances).toHaveLength(1);
    expect(display.pageContext.value).toEqual(contextOf(String(router.currentRoute.value.query.page), "task-2"));

    const draft = "/applications/app-a/tasks?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fnext.page-draft.json";
    await router.replace({ query: { ...router.currentRoute.value.query, page: panelAddress(draft, selected("task-3")) } });
    await flushPromises();
    expect(instances).toHaveLength(1);
    expect(wrapper.get(".panel-double").attributes("data-requested")).toBe(JSON.stringify(selected("task-3")));
    wrapper.unmount();
  });

  it("carries the page's address before the frame has reported anything, and the name once it does", async () => {
    // Frames take seconds to load. A message written while one is still loading names the page the shell opened — its
    // address, which is the shell's own fact — and says nothing about a selection it has not been told.
    silent.value = true;
    const page = "/applications/app-a/tasks";
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ ...platformRoutes.chat, component: { template: "<div />" } }],
    });
    await router.push({ path: platformRoutes.chat.path, query: { page } });
    await router.isReady();
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: {
        plugins: [workbenchI18n(), ElementPlus, router],
        provide: {
          [pilotPageKey as symbol]: pilotPageResolver,
          [platformPageAccessKey as symbol]: () => true,
          [pageCounterKey as symbol]: { agents: async () => [agent], preferredAgentId: ref<string | null>(agent.id), ask: () => {} },
        },
      },
    });
    await flushPromises();

    expect(displayOf(wrapper).pageContext.value).toEqual({ url: page, label: "", selection: [] });

    instances[0]!.report();
    await flushPromises();
    expect(displayOf(wrapper).pageContext.value).toEqual(contextOf(page, null));
    silent.value = false;
    wrapper.unmount();
  });

  it("names the page by its use relation from the moment it opens, and keeps that name once the frame reports", async () => {
    // The page's name is the application's navigation, a fact the shell has before the frame loads: a message written at
    // once carries it with the address. The panel's own title, which the frame reports, does not replace it.
    silent.value = true;
    uses[0]!.names = { en: "Scheduled tasks", "zh-CN": "定时任务" };
    const page = "/applications/app-a/tasks";
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ ...platformRoutes.chat, component: { template: "<div />" } }],
    });
    await router.push({ path: platformRoutes.chat.path, query: { page } });
    await router.isReady();
    const wrapper = mount(BusinessWorkbench, {
      props: { defaultLogo: "", defaultBrandName: "Ontomato" },
      global: {
        plugins: [workbenchI18n(), ElementPlus, router],
        provide: {
          [pilotPageKey as symbol]: pilotPageResolver,
          [platformPageAccessKey as symbol]: () => true,
          [pageCounterKey as symbol]: { agents: async () => [agent], preferredAgentId: ref<string | null>(agent.id), ask: () => {} },
        },
      },
    });
    await flushPromises();

    expect(displayOf(wrapper).pageContext.value).toEqual({ url: page, label: "Scheduled tasks", selection: [] });

    instances[0]!.report();
    await flushPromises();
    expect(displayOf(wrapper).pageContext.value).toEqual({ ...contextOf(page, null), label: "Scheduled tasks" });
    delete uses[0]!.names;
    silent.value = false;
    wrapper.unmount();
  });
});
