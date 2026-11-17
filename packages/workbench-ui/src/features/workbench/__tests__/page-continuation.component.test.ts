import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { ref } from "vue";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import { platformPageAccessKey } from "@ontomato/platform-shell";
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
/** The conversations the host lists, and whether the column had read them before the page's message arrived. */
const hosted = vi.hoisted(() => ({ sessions: [] as string[], loads: 0 }));

vi.mock("@ontomato/agent-shell-ui", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    AgentShell: defineComponent({
      name: "AgentShell",
      props: ["agentId", "sessionId", "featureId"],
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
        sessions,
        loadAgents: async () => {},
        // The column reads the agent's conversations: the one this tab holds is among them.
        loadSessions: async () => {
          hosted.loads += 1;
          sessions.value = hosted.sessions.map((id) => ({ id }));
        },
        startNew: () => {
          started.push("new");
          options.setSessionId(null);
          options.onLeaveConversation();
        },
        selectSession: (id: string) => {
          opened.push(id);
          options.setSessionId(id);
          options.onLeaveConversation();
        },
      };
    },
    useSessionRunFeed: () => {},
  };
});
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../assistant-host", () => ({ createAssistantClient: () => ({}), createAssistantFeedback: () => ({}) }));
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
  hosted.sessions = [];
  hosted.loads = 0;
  vi.restoreAllMocks();
});

/** A message written at a page's foot: the counter's address, with the page it was written on. */
async function fromPage(agentId: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ ...platformRoutes.chat, component: { render: () => null } }],
  });
  await router.push({
    path: platformRoutes.chat.path,
    query: { agentId, prompt: "e2e: only say received", page: "/dashboards?dashboardId=board-a" },
  });
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato" },
    global: { plugins: [i18n, ElementPlus, router], provide: {
      [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
      [platformPageAccessKey as symbol]: () => true,
    } },
  });
  wrappers.push(wrapper);
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return { router, shell: wrapper.findComponent({ name: "AgentShell" }) };
}

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
