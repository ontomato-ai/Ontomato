import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus, { ElMessage } from "element-plus";
import { createPinia } from "pinia";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import { platformPageAccessKey } from "@ontomato/platform-shell";
import BusinessWorkbench from "../components/BusinessWorkbench.vue";

/*
 * The platform home links into the agent platform by agent: `?agentId=<id>` for a new conversation with it, `&prompt=`
 * to start that conversation with a question, `&sessionId=` to reopen one of its conversations. The agent is chosen over
 * the remembered one. The contract lives between two packages, so it is checked here, on the page that reads it.
 */
const i18n = workbenchI18n();
const agents = vi.hoisted(() => [
  { id: "11111111-1111-4111-8111-111111111111", name: "Sales", description: "", icon: null, enabled: true },
  { id: "22222222-2222-4222-8222-222222222222", name: "Retired", description: "", icon: null, enabled: false },
  { id: "55555555-5555-4555-8555-555555555555", name: "Operations diagnosis", description: "", icon: "wrench", enabled: true, kind: "ops-diagnosis" },
]);
const [sales, retired, opsDiagnosis] = agents;
const sent = vi.hoisted(() => [] as string[]);
const filled = vi.hoisted(() => [] as string[]);

vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => {
  const { defineComponent, h } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
    AgentShell: defineComponent({
      name: "AgentShell",
      props: ["agentId", "sessionId"],
      setup(_props, { expose }) {
        expose({ reloadAgents: async () => {}, send: async (text: string) => { sent.push(text); }, fill: (text: string) => { filled.push(text); } });
        return () => h("div");
      },
    }),
    ShellNavBody: { name: "ShellNavBody", template: "<div />" },
    ShellColumn: { name: "ShellColumn", template: "<div><slot /></div>" },
    useAgentNav: (options: { setSessionId(id: string | null): void; onLeaveConversation(): void }) => ({
      agents: { value: agents },
      sessions: { value: [] },
      loadAgents: async () => {},
      loadSessions: async () => {},
      startNew: () => {
        options.setSessionId(null);
        options.onLeaveConversation();
      },
      selectSession: (id: string) => {
        options.setSessionId(id);
        options.onLeaveConversation();
      },
    }),
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
  localStorage.clear();
  sessionStorage.clear();
  sent.splice(0);
  filled.splice(0);
  vi.restoreAllMocks();
});

async function openChat(query: Record<string, string>, standalone = false) {
  const path = standalone ? "/applications/app-data-agent-workbench/workbench" : platformRoutes.chat.path;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path, component: { render: () => null } }],
  });
  await router.push({ path, query });
  const internalPages = standalone ? {
    dashboard: "/applications/app-data-agent-workbench/dashboards",
    agents: "/applications/app-data-agent-workbench/agents",
  } : undefined;
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato", internalPages },
    global: { plugins: [i18n, ElementPlus, router, createPinia()], provide: {
        [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
        // The platform answers which of its pages the account may open; here, every one.
        [platformPageAccessKey as symbol]: () => true,
      } },
  });
  wrappers.push(wrapper);
  for (let index = 0; index < 3; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return { router, shell: wrapper.findComponent({ name: "AgentShell" }) };
}

it("restores the standalone application's active conversation from its address after remounting", async () => {
  const session = "44444444-4444-4444-8444-444444444444";
  const { router, shell } = await openChat({ standalone: "1" }, true);
  shell.vm.$emit("update:sessionId", session);
  await vi.waitFor(() => expect(router.currentRoute.value.query).toMatchObject({ standalone: "1", sessionId: session }));

  const reopened = await openChat({ standalone: "1", sessionId: String(router.currentRoute.value.query.sessionId) }, true);
  expect(reopened.shell.props("sessionId")).toBe(session);
  expect(sent).toEqual([]);

  reopened.shell.vm.$emit("update:sessionId", null);
  await vi.waitFor(() => expect(reopened.router.currentRoute.value.query.sessionId).toBeUndefined());
});

describe("a link to one agent", () => {
  it("selects that agent over the remembered one, on a new conversation, and leaves the address", async () => {
    localStorage.setItem("ontomato.workbench.agent", retired!.id);
    const { router, shell } = await openChat({ agentId: sales!.id });
    expect(shell.props("agentId")).toBe(sales!.id);
    expect(shell.props("sessionId") ?? null).toBeNull();
    expect(sent).toEqual([]);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("sends the question as the new conversation's first message, once", async () => {
    const { router, shell } = await openChat({ agentId: sales!.id, prompt: "How did sales do?" });
    expect(shell.props("agentId")).toBe(sales!.id);
    expect(shell.props("sessionId") ?? null).toBeNull();
    expect(sent).toEqual(["How did sales do?"]);
    // Gone from the address, so a reload does not send it again.
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("reopens the conversation it names with that agent", async () => {
    const session = "44444444-4444-4444-8444-444444444444";
    const { router, shell } = await openChat({ agentId: sales!.id, sessionId: session });
    expect(shell.props("agentId")).toBe(sales!.id);
    expect(shell.props("sessionId")).toBe(session);
    expect(sent).toEqual([]);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it.each([
    ["disabled", retired!.id],
    ["deleted", "33333333-3333-4333-8333-333333333333"],
  ])("reports a %s agent and keeps the agent the page itself chose", async (_case, id) => {
    localStorage.setItem("ontomato.workbench.agent", sales!.id);
    const error = vi.spyOn(ElMessage, "error");
    const { router, shell } = await openChat({ agentId: id, prompt: "Anyone there?" });
    expect(error).toHaveBeenCalledWith(i18n.global.t("assistant.agentUnavailable"));
    expect(shell.props("agentId")).toBe(sales!.id);
    expect(sent).toEqual([]);
    // The question is not lost: it waits in the composer for the reader.
    expect(filled).toEqual(["Anyone there?"]);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("selects an agent by kind and prefills the composer without sending", async () => {
    const { router, shell } = await openChat({
      agentKind: "ops-diagnosis",
      prefill: "Diagnose this Turn (sessionId: s-1, runId: r-1).",
    });
    expect(shell.props("agentId")).toBe(opsDiagnosis!.id);
    expect(shell.props("sessionId") ?? null).toBeNull();
    expect(sent).toEqual([]);
    expect(filled).toEqual(["Diagnose this Turn (sessionId: s-1, runId: r-1)."]);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("switches to ops-diagnosis and prefills when navigated while already on /agents/chat", async () => {
    const { router, shell } = await openChat({ agentId: sales!.id });
    expect(shell.props("agentId")).toBe(sales!.id);

    await router.push({
      path: platformRoutes.chat.path,
      query: { agentKind: "ops-diagnosis", prefill: "Diagnose this Turn (sessionId: s-2, runId: r-2)." },
    });
    for (let index = 0; index < 3; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shell.props("agentId")).toBe(opsDiagnosis!.id);
    expect(sent).toEqual([]);
    expect(filled).toEqual(["Diagnose this Turn (sessionId: s-2, runId: r-2)."]);
    expect(router.currentRoute.value.query).toEqual({});
  });
});
