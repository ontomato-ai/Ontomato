import { beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { pageCounterKey } from "@ontomato/agent-shell-ui";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { panelAddress, panelAddressState } from "@ontomato/contracts/panel-host";
import type { ApplicationPanelUse } from "@ontomato/contracts/product-panels";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import elementEn from "element-plus/es/locale/lang/en";
import { pilotPageResolver } from "../pilot-pages";

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
    skill: { namespace: { kind: "provider", provider: "workbench" }, name: "panels" },
  },
];
vi.mock("../panel-host", () => ({ panelUsesOf: async () => uses, platformPanelHost: () => ({}) }));

/** Every panel instance mounted, with the state it opened at. */
const instances: { initial: Record<string, unknown> }[] = [];
const selected = (primaryKey: string) => ({ selectedTask: { className: SCHEDULED_TASK, primaryKey } });
const contextOf = (address: string, primaryKey: string | null) => ({
  pageKey: "panels-trial-a-tasks",
  url: address,
  label: "Scheduled tasks (trial)",
  selection: primaryKey ? [{ kind: SCHEDULED_TASK, id: primaryKey, label: `Task ${primaryKey}` }] : [],
});

vi.mock("@ontomato/platform-shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/platform-shell")>()),
  // Stands in for the frame: it reports what the reader looks at, and a selection as the address it is now at.
  PanelHost: defineComponent({
    props: { useId: String, address: String, initial: { type: Object, default: () => ({}) } },
    emits: ["address", "context"],
    setup(props, { emit }) {
      instances.push({ initial: props.initial });
      const opened = (props.initial as { selectedTask?: { primaryKey: string } }).selectedTask?.primaryKey ?? null;
      emit("context", contextOf(panelAddress(props.address!, props.initial), opened));
      return () =>
        h("button", {
          class: "panel-double",
          onClick: () => {
            const next = panelAddress(props.address!, selected("task-2"));
            emit("address", next);
            emit("context", contextOf(next, "task-2"));
          },
        });
    },
  }),
}));

const shellProps = ref<Record<string, unknown> | null>(null);
const agent = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Analyst", description: "", icon: null, enabled: true };
vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  AgentShell: defineComponent({
    name: "AgentShell",
    props: ["featureId", "pageContext", "pageLinks", "workbench"],
    emits: ["update:featureId"],
    setup(props, { slots, expose }) {
      shellProps.value = props as unknown as Record<string, unknown>;
      expose({ reloadAgents: () => {}, send: async () => {} });
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

beforeAll(() => {
  installWorkbenchI18n({
    supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
    messages: { en: {} }, elementLocale: () => elementEn,
  });
});

interface ShellSeen {
  featureId: string;
  pageContext: ReturnType<typeof contextOf> | null;
  workbench: { features: { id: string; withConversation?: boolean; address?: string; label: string }[] };
}

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
    const shell = () => shellProps.value as unknown as ShellSeen;

    // The workbench knows the page: it sits beside the conversation, at its own address, named by the panel.
    expect(shell().featureId).toBe("panel-application");
    expect(shell().workbench.features.find((feature) => feature.id === "panel-application")).toMatchObject({
      withConversation: true,
      address: page,
      label: "Scheduled tasks (trial)",
    });
    // The panel opened at the state the page's address names, and what it shows rides on the message.
    expect(instances).toEqual([{ initial: selected("task-1") }]);
    expect(shell().pageContext).toEqual(contextOf(page, "task-1"));

    // The reader selects another task: the conversation's page parameter follows, the panel is the same one, and the
    // message carries the new selection.
    await wrapper.get(".panel-double").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(panelAddressState(String(router.currentRoute.value.query.page))).toEqual(selected("task-2"));
    expect(instances).toHaveLength(1);
    expect(shell().pageContext).toEqual(contextOf(String(router.currentRoute.value.query.page), "task-2"));
    wrapper.unmount();
  });
});
