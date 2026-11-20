import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { ref } from "vue";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";

/*
 * A page's own composer sends with `&agentId=` from the page's address, and the platform then decides which conversation
 * the message goes into: the conversation this tab already holds with that agent, so a reader working on one board stays
 * in one conversation, and a new one only when the tab holds none with that agent.
 *
 * The decision is made on the way in, before the column has read the agent's conversations, so the conversation the tab
 * holds is looked up in the host's list — an empty list at that moment must not mean "none".
 */
const i18n = workbenchI18n();
const agents = vi.hoisted(() => [
  { id: "11111111-1111-4111-8111-111111111111", name: "Assistant", description: "", icon: null, enabled: true },
  { id: "22222222-2222-4222-8222-222222222222", name: "Analyst", description: "", icon: null, enabled: true },
]);
const [assistant, analyst] = agents;
const held = vi.hoisted(() => "33333333-3333-4333-8333-333333333333");
const sent = vi.hoisted(() => [] as string[]);
const started = vi.hoisted(() => [] as string[]);
const opened = vi.hoisted(() => [] as string[]);
/** The conversations the host lists, whether the column had read them before the page's message arrived, and how slow. */
const hosted = vi.hoisted(() => ({ sessions: [] as string[], loads: 0, slowLoads: false }));
/** What choosing a conversation did: the real navigation closes the page beside the conversation it leaves. */
const left = vi.hoisted(() => [] as string[]);

vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => {
  const { defineComponent, h } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
    AgentShell: defineComponent({
      name: "AgentShell",
      props: ["agentId", "sessionId"],
      setup(_props, { expose }) {
        expose({ reloadAgents: async () => {}, send: async (text: string) => { sent.push(text); } });
        return () => h("div");
      },
    }),
    ShellNavBody: { name: "ShellNavBody", template: "<div />" },
    ShellColumn: { name: "ShellColumn", template: "<div><slot /></div>" },
    useAgentNav: (options: { setSessionId(id: string | null): void; onLeaveConversation(): void }) => {
      const sessions = ref<{ id: string }[]>([]);
      return {
        agents: { value: agents },
        // The agents were read and the pages here declare no skill of their own.
        agentsLoading: { value: false },
        pageAgents: { value: null },
        sessions,
        loadAgents: async () => {},
        // The column reads the agent's conversations: the one this tab holds is among them.
        loadSessions: async () => {
          hosted.loads += 1;
          // A page message can arrive while the column is still reading: the read settles whenever it settles.
          if (hosted.slowLoads) for (let wait = 0; wait < 3; wait += 1) await new Promise((resolve) => setTimeout(resolve, 0));
          sessions.value = hosted.sessions.map((id) => ({ id }));
        },
        startNew: () => {
          started.push("new");
          options.setSessionId(null);
          left.push("new");
          options.onLeaveConversation();
        },
        selectSession: (id: string) => {
          opened.push(id);
          options.setSessionId(id);
          left.push(id);
          options.onLeaveConversation();
        },
      };
    },
    useSessionRunFeed: () => {},
  };
});
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../assistant-host", () => ({
  createAssistantClient: () => ({}),
  createAssistantFeedback: () => ({}),
  createPanelOperationSettings: () => ({ read: async () => null }),
}));
vi.mock("../components/DatasetActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/WorkbenchAppearanceDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../diagnosis/components/TurnDiagnoseButton.vue", () => ({ default: { template: "<div />" } }));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  sessionStorage.clear();
  localStorage.clear();
  sent.splice(0);
  started.splice(0);
  opened.splice(0);
  left.splice(0);
  hosted.sessions = [];
  hosted.loads = 0;
  hosted.slowLoads = false;
  vi.restoreAllMocks();
});

/**
 * A message written at a page's foot: the counter's address, with the page it was written on. The reader is on another
 * page, the counter pushes this address, and the application mounts on it — the arrival the platform really makes.
 */
async function fromPage(agentId: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { ...platformRoutes.chat, component: { render: () => null } },
      { ...platformRoutes.dashboards, component: { render: () => null } },
    ],
  });
  await router.push({ path: platformRoutes.dashboards.path, query: { dashboardId: "board-a" } });
  const arrival = router.push({
    path: platformRoutes.chat.path,
    query: { agentId, prompt: "e2e: only say received", page: "/dashboards?dashboardId=board-a" },
  });
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato" },
    global: { plugins: [i18n, ElementPlus, router], provide: {
      [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
      [platformPageAccessKey as symbol]: () => true,
      // The assembly's own page beside the conversation: this board, which is what the address carries.
      [pilotPageKey as symbol]: () => (address: string) =>
        address.startsWith("/dashboards") ? { id: "dashboards", component: { render: () => null }, props: { paired: true } } : null,
    } },
  });
  wrappers.push(wrapper);
  await arrival;
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return { router, shell: wrapper.findComponent({ name: "AgentShell" }) };
}

/**
 * The page's message arrives while the column is still reading, and the address changes again under it — the page
 * parameter settling, a reload of the same link — before that read returns. The question is sent once.
 */
async function fromPageWithAddressChanging(agentId: string) {
  sessionStorage.setItem("ontomato.workbench.conversation", JSON.stringify({ agentId, sessionId: held }));
  hosted.sessions = [held];
  hosted.slowLoads = true;
  const { router, shell } = await fromPage(agentId);
  // The address settles once more while the page's read is still out.
  await router.replace({ query: { ...router.currentRoute.value.query, page: "/dashboards?dashboardId=board-b" } });
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return { router, shell };
}

/**
 * The same op twice: the page's message arrives, the column is still reading the agent's conversations, and the address
 * settles and settles again while it waits. The question is sent once — a message sent twice is three runs of the same
 * question and three answers.
 */
/**
 * Choosing the conversation closes the page open beside the one being left — that is what this platform's column does —
 * and the page the message came from must still be open when the message has been placed: it is the page the reader was
 * on, and the one the answer is about.
 */
it("keeps the page open beside the conversation the message opened", async () => {
  sessionStorage.setItem("ontomato.workbench.conversation", JSON.stringify({ agentId: assistant!.id, sessionId: held }));
  hosted.sessions = [held];

  const { router } = await fromPage(assistant!.id);

  // The column was asked to leave a conversation for this one, and the page it came from came back with the message.
  expect(left).toEqual([held]);
  expect(router.currentRoute.value.query.page).toBe("/dashboards?dashboardId=board-a");
});

it("keeps the page open when the message starts a new conversation", async () => {
  const { router } = await fromPage(assistant!.id);

  expect(left).toEqual(["new"]);
  expect(router.currentRoute.value.query.page).toBe("/dashboards?dashboardId=board-a");
});

it("sends the page's message once however often the entry runs while it waits", async () => {
  sessionStorage.setItem("ontomato.workbench.conversation", JSON.stringify({ agentId: assistant!.id, sessionId: held }));
  hosted.sessions = [held];
  hosted.slowLoads = true;

  const { shell } = await fromPage(assistant!.id);

  expect(sent).toEqual(["e2e: only say received"]);
  expect(opened).toEqual([held]);
  expect(started).toEqual([]);
  expect(shell.props("sessionId")).toBe(held);
});

it("sends once even when the address changes again before the page's read returns", async () => {
  const { shell } = await fromPageWithAddressChanging(assistant!.id);

  expect(sent).toEqual(["e2e: only say received"]);
  expect(opened).toEqual([held]);
  expect(shell.props("sessionId")).toBe(held);
});

it("sends once when the same address is entered again while the first message is still being placed", async () => {
  // The counter pushes the chat address; the platform re-renders that address before its first arrival settles (the page
  // parameter, a reload of the same link). Each arrival used to find the question still in the address and send it.
  sessionStorage.setItem("ontomato.workbench.conversation", JSON.stringify({ agentId: assistant!.id, sessionId: held }));
  hosted.sessions = [held];
  hosted.slowLoads = true;
  const { router } = await fromPage(assistant!.id);

  const address = { agentId: assistant!.id, prompt: "e2e: only say received", page: "/dashboards?dashboardId=board-a" };
  void router.push({ path: platformRoutes.chat.path, query: address });
  await router.push({ path: platformRoutes.chat.path, query: address });
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));

  expect(sent).toEqual(["e2e: only say received"]);
});

describe("a message from a page, into the conversation this tab holds", () => {
  it("goes on in the same conversation with the same agent", async () => {
    // This tab last wrote from the board to the assistant: that conversation is the one the next message goes into.
    sessionStorage.setItem("ontomato.workbench.conversation", JSON.stringify({ agentId: assistant!.id, sessionId: held }));
    hosted.sessions = [held];

    const { shell } = await fromPage(assistant!.id);

    expect(opened).toEqual([held]);
    expect(started).toEqual([]);
    expect(shell.props("sessionId")).toBe(held);
    expect(sent).toEqual(["e2e: only say received"]);
  });

  it("starts a new conversation for another agent, even with one held for this tab", async () => {
    sessionStorage.setItem("ontomato.workbench.conversation", JSON.stringify({ agentId: assistant!.id, sessionId: held }));
    hosted.sessions = [held];

    const { shell } = await fromPage(analyst!.id);

    expect(opened).toEqual([]);
    expect(started).toEqual(["new"]);
    expect(shell.props("sessionId") ?? null).toBeNull();
    expect(sent).toEqual(["e2e: only say received"]);
  });

  it("starts a new conversation when the host no longer lists the one it held", async () => {
    sessionStorage.setItem("ontomato.workbench.conversation", JSON.stringify({ agentId: assistant!.id, sessionId: held }));
    hosted.sessions = [];

    const { shell } = await fromPage(assistant!.id);

    expect(opened).toEqual([]);
    expect(started).toEqual(["new"]);
    expect(shell.props("sessionId") ?? null).toBeNull();
  });
});
