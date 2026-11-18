import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { defineComponent, h, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import type { AssistantAgentDefinition, AssistantAgentInput } from "@ontomato/contracts/assistant-chat";
import { pageCounterKey } from "@ontomato/agent-shell-ui";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { installWorkbenchI18n, workbenchI18n } from "@ontomato/workbench-ui/i18n";
import en from "@ontomato/workbench-ui/locales/en";
import { BusinessWorkbench } from "@ontomato/workbench-ui/features/workbench";
import elementEn from "element-plus/es/locale/lang/en";
import { pilotPageResolver } from "../pilot-pages";

/*
 * The agents' settings beside the conversation: their address is the conversation's `?page=`, so a draft link, a switch
 * to another agent, a new agent and the handoff after a save all move that parameter and never the browser's address.
 * The editor is the one component the settings page is at its own address too; these drive the real page and the real
 * store, with only the server's answers doubled.
 */
const AGENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const agents: AssistantAgentDefinition[] = [
  { id: AGENT, name: "Sales analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
    modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 1, executionUserId: null },
  { id: OTHER, name: "Stock analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
    modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 2, executionUserId: null },
];

function input(overrides: Partial<AssistantAgentInput> = {}): AssistantAgentInput {
  return {
    name: "Sales analyst", description: "", icon: null, enabled: true, systemPrompt: "Be brief.",
    modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [], sortOrder: 1,
    ...overrides,
  };
}

const draft = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../workbench-ui/src/features/workbench/assistant-host", () => ({
  createAssistantClient: () => ({ readPageDraft: draft.read, listAgents: async () => [] }),
  createAssistantFeedback: () => ({}),
}));
vi.mock("../../workbench-ui/src/features/workbench/api", () => ({ getWorkbenchAppearance: async () => null }));
// The editor's own section widgets are heavy; the editor itself is the page under test.
vi.mock("../../workbench-ui/src/features/agents/components/SkillSelector.vue", () => ({
  default: defineComponent({ name: "SkillSelector", emits: ["ready"], mounted() { this.$emit("ready", true); }, template: "<div />" }),
}));
vi.mock("@ontomato/foundation-ui/code", () => ({ CodeEditor: defineComponent({ name: "CodeEditor", template: "<div />" }) }));
// The list, the models and the scope come from the server; the page reads the server's answers through here.
const definitions = vi.hoisted(() => ({ use: null as unknown }));
vi.mock("../../workbench-ui/src/features/agents/definitions", async () => {
  const { ref } = await import("vue");
  const agents = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Sales analyst", description: "", icon: null, enabled: true,
      systemPrompt: "Be brief.", modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [],
      sortOrder: 1, executionUserId: null },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Stock analyst", description: "", icon: null, enabled: true,
      systemPrompt: "Be brief.", modelSelection: { modelId: null }, skills: [], classNames: [], enabledMcpServiceIds: [],
      sortOrder: 2, executionUserId: null },
  ];
  definitions.use = () => ({
    agents: ref(agents), loading: ref(false), loadFailed: ref(false), classes: ref([]), relations: ref([]),
    outlineLoading: ref(false), modelOptions: ref({ models: [], defaultModelId: null, embeddingModelId: null }),
    modelOptionsFailed: ref(false), first: ref(agents[0]!), find: (id: string | null) => agents.find((agent) => agent.id === id) ?? null,
    ensureLoaded: async () => {}, load: async () => {}, reloadModelOptions: async () => {}, remember: () => {}, forget: () => {},
  });
  return { useAgentDefinitions: definitions.use };
});
vi.mock("../../workbench-ui/src/features/agents/api", () => ({
  agentDefinitionsApi: {
    list: async () => agents,
    skills: async () => [],
    listMcpServiceOptions: async () => [],
    executionOptions: async () => ({ canSetExecutionUser: true, users: [] }),
    create: async (written: AssistantAgentInput) => ({ ...agents[0], ...written }),
    update: async (id: string, written: AssistantAgentInput) => ({ ...agents[0], ...written, id }),
    remove: async () => {},
  },
  loadModelOptions: async () => ({ models: [], defaultModelId: null, embeddingModelId: null }),
  loadOntologyScope: async () => ({ classes: [], relations: [] }),
  loadOntologyOutline: async () => ({ classes: [] }),
}));

// The shell draws the conversation; these read the parameters it is handed and the page it draws beside it.
const shellProps = ref<Record<string, unknown> | null>(null);
const openPageListener = ref<((id: string, address: string) => void) | null>(null);
vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
  AgentShell: defineComponent({
    name: "AgentShell",
    props: ["featureId", "pageContext", "pageLinks", "workbench"],
    emits: ["update:featureId", "openPage"],
    setup(props, { slots, expose, emit }) {
      shellProps.value = props as unknown as Record<string, unknown>;
      openPageListener.value = (id: string, address: string) => emit("openPage", id, address);
      expose({ reloadAgents: () => {}, send: async () => {} });
      return () => h("div", { class: "shell" }, [slots.feature?.({ featureId: props.featureId })]);
    },
  }),
  useAgentNav: () => ({
    agents: ref([]), sessions: ref([]), sessionsState: ref("ready"), nextCursor: ref(null), currentAgent: ref(null),
    loadAgents: async () => {}, loadSessions: async () => {}, startNew: () => {}, selectSession: () => {},
    removeSession: async () => {}, promoteSession: () => {},
  }),
  useSessionRunFeed: () => {},
}));

installWorkbenchI18n({
  supported: ["en"], defaultLocale: "en", initialLocale: "en", switchEnabled: false, save: null,
  messages: { en }, elementLocale: () => elementEn,
});

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  setActivePinia(createPinia());
  draft.read.mockResolvedValue({
    pageKey: "agent-settings", operation: "agent.update", target: { id: AGENT }, form: input({ name: "Renamed analyst" }),
  });
  vi.stubGlobal("fetch", async () => Response.json({ data: null }));
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  draft.read.mockReset();
  shellProps.value = null;
  openPageListener.value = null;
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
      { ...platformRoutes.ontologyAgents, component: { template: "<div />" } },
      { ...platformRoutes.ontologyAgentNew, component: { template: "<div />" } },
      { ...platformRoutes.ontologyAgent, component: { template: "<div />" } },
      { path: platformRoutes.dashboards.path, component: { template: "<div />" } },
    ],
  });
  await router.push({ path, query });
  await router.isReady();
  return router;
}

const provide = () => ({
  [pilotPageKey as symbol]: pilotPageResolver,
  [platformPageAccessKey as symbol]: () => true,
  [pageCounterKey as symbol]: { agents: async () => [], preferredAgentId: ref<string | null>(null), ask: () => {} },
});

async function workbench(router: Router) {
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato" },
    global: { plugins: [workbenchI18n(), ElementPlus, router], provide: provide() },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const openLink = (href: string) =>
  (shellProps.value as unknown as { pageLinks: (href: string) => (() => void) | null }).pageLinks(href)!();

// The settings page's own machinery (the draft, the form, the save) is covered where it lives; what is under test here
// is the page beside the conversation: which address it is shown at, and which movement it is handed.
vi.mock("../pages/AgentSettingsRoute.vue", () => ({
  default: defineComponent({
    name: "AgentSettingsRouteDouble",
    props: ["address", "navigate"],
    setup(props) {
      return () =>
        h("div", { class: "page-double" }, [
          // The page is told its address and nothing else: which agent it shows is what that address says.
          h("span", { class: "shown" }, props.address ?? ""),
          h("span", { class: "address" }, props.address ?? ""),
          h("span", { class: "draft" }, new URLSearchParams((props.address ?? "").split("?")[1] ?? "").get("draftPath") ?? ""),
          h("button", { class: "move", onClick: () => props.navigate?.("/ontology/agents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") }, "Move"),
        ]);
    },
  }),
}));

describe("the agents' settings beside the conversation", () => {
  it("shows the page at the address the conversation carries, draft handoff included", async () => {
    const router = await routerAt(platformRoutes.chat.path);
    const wrapper = await workbench(router);

    openLink(`/ontology/agents/${AGENT}?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json`);
    await flushPromises();

    // Still the agent platform, carrying the settings page and its draft as the page's address.
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(router.currentRoute.value.query.page).toBe(
      `/ontology/agents/${AGENT}?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json`,
    );
    // The page is told the address it is shown at, so its editor reads the conversation's draft, not the chat's query.
    expect(wrapper.find(".page-double .shown").text()).toBe(
      `/ontology/agents/${AGENT}?draftSessionId=s&draftRunId=r&draftPath=outputs%2Fdrafts%2Fa.page-draft.json`,
    );
    expect(wrapper.find(".page-double .draft").text()).toBe("outputs/drafts/a.page-draft.json");
  });

  it("switches agent and a new agent by the page parameter alone", async () => {
    const router = await routerAt(platformRoutes.chat.path);
    const wrapper = await workbench(router);
    openLink(`/ontology/agents/${AGENT}`);
    await flushPromises();

    (wrapper.find(".page-double .move").element as HTMLButtonElement).click();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(platformRoutes.chat.path);
    expect(router.currentRoute.value.query.page).toBe("/ontology/agents/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("enlarges to the page's own address", async () => {
    const router = await routerAt(platformRoutes.chat.path);
    await workbench(router);
    openLink(`/ontology/agents/${AGENT}`);
    await flushPromises();

    // What the pane's enlarge button reports: the page and its own address, which the host opens.
    openPageListener.value!("agents", `/ontology/agents/${AGENT}`);
    await flushPromises();
    expect(router.currentRoute.value.path).toBe(`/ontology/agents/${AGENT}`);
  });
});
