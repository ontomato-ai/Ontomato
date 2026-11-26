import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount } from "@vue/test-utils";
import ElementPlus, { ElMessage } from "element-plus";
import { createPinia } from "pinia";
import { workbenchI18n } from "../../../i18n";
import { ontologyServiceAccessKey, openOntologyServiceAccess } from "../../../app/ontology-service";
import { pilotPageKey, platformPageAccessKey } from "@ontomato/platform-shell";
import examples from "../../../../../contracts/examples/platform-schedules.json";
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
const scheduleResponse = vi.hoisted(() => ({ tasks: [] as unknown[], timeZone: "Asia/Shanghai" }));
const filled = vi.hoisted(() => [] as string[]);
const directory = vi.hoisted(() => ({
  listAgents: async () => agents,
}));

vi.mock("@ontomato/agent-shell-ui", async (importOriginal) => {
  const { defineComponent, h } = await import("vue");
  return {
    ...(await importOriginal<typeof import("@ontomato/agent-shell-ui")>()),
    AgentShell: defineComponent({
      name: "AgentShell",
      props: ["agentId", "sessionId", "display"],
      setup(props, { expose, slots }) {
        expose({ reloadAgents: async () => {}, send: async (text: string) => { sent.push(text); }, fill: (text: string) => { filled.push(text); } });
        return () => h("div", [
          slots.shortcuts?.(),
          slots["before-history"]?.(),
          props.sessionId ? slots["artifact-actions"]?.({}) : undefined,
          props.display.page.value ? slots.feature?.({ featureId: props.display.page.value.featureId }) : undefined,
        ]);
      },
    }),
    ShellNavBody: { name: "ShellNavBody", template: "<div />" },
    ShellColumn: { name: "ShellColumn", template: "<div><slot /></div>" },
    useSessionRunFeed: () => {},
  };
});
vi.mock("../../../utils/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../utils/api")>()),
  nodeApiRequest: async () => Response.json(scheduleResponse),
}));
vi.mock("../api", () => ({ getWorkbenchAppearance: async () => ({ brand: { name: "", logo: "", subtitle: "" } }) }));
vi.mock("../assistant-host", () => ({
  createAssistantClient: () => ({
    listAgents: () => directory.listAgents(),
    listSessions: async () => ({ sessions: [], nextCursor: null }),
  }),
  createAssistantFeedback: () => ({}),
  createPanelOperationSettings: () => ({ read: async () => null }),
}));
vi.mock("../components/DatasetActions.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../components/ChartFileActions.vue", () => ({
  default: {
    emits: ["openDashboard"],
    template: '<button class="open-chart-dashboard" @click="$emit(\'openDashboard\', \'new-dashboard\')">Open dashboard</button>',
  },
}));
vi.mock("../components/WorkbenchAppearanceDialog.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../../diagnosis/components/TurnDiagnoseButton.vue", () => ({ default: { template: "<div />" } }));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
  sessionStorage.clear();
  sent.splice(0);
  filled.splice(0);
  scheduleResponse.tasks = [];
  directory.listAgents = async () => agents;
  vi.restoreAllMocks();
});

async function flush(turns = 4) {
  for (let index = 0; index < turns; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openChat(query: Record<string, string>, standalone = false) {
  const path = standalone ? "/applications/app-data-agent-workbench/workbench" : platformRoutes.chat.path;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path, component: { render: () => null } },
      { ...platformRoutes.dashboards, component: { render: () => null } },
    ],
  });
  await router.push({ path, query });
  const internalPages = standalone ? {
    dashboard: "/applications/app-data-agent-workbench/dashboards",
    schedules: "/applications/app-data-agent-workbench/schedules",
    agents: "/applications/app-data-agent-workbench/agents",
  } : undefined;
  const wrapper = mount(BusinessWorkbench, {
    props: { defaultLogo: "", defaultBrandName: "Ontomato", internalPages },
    global: { plugins: [i18n, ElementPlus, router, createPinia()], provide: {
        [ontologyServiceAccessKey as symbol]: openOntologyServiceAccess,
        // The platform answers which of its pages the account may open; here, every one.
        [platformPageAccessKey as symbol]: () => true,
        [pilotPageKey as symbol]: () => (address: string) => address.split("?")[0] === platformRoutes.schedules.path
          ? {
              id: "panel-application", instance: platformRoutes.schedules.path, props: { address },
              component: { props: ["address"], template: '<div :data-panel-address="address" />' },
            }
          : null,
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

it("opens a dashboard saved from a DataAgent conversation through the dashboard entry", async () => {
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const { router, shell } = await openChat({ standalone: "1", sessionId }, true);

  await shell.get(".open-chart-dashboard").trigger("click");

  await vi.waitFor(() => {
    expect(router.currentRoute.value.path).toBe(platformRoutes.dashboards.path);
    expect(router.currentRoute.value.query).toEqual({ dashboardId: "new-dashboard" });
  });
});

it("opens the selected agent's schedule in the main workbench while retaining the session", async () => {
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const page = "/applications/app-data-agent-workbench/schedules";
  const example = examples.creates.find(item => item.name === "agents-instruction")!.response;
  scheduleResponse.tasks = [
    { ...example, title: "Sales review", appId: "agents", content: { agentId: sales!.id, instruction: "Review sales" } },
    { ...example, id: "66666666-6666-4666-8666-666666666666", title: "Other review", appId: "agents",
      content: { agentId: retired!.id, instruction: "Review" }, lastRun: null, latestResult: null },
  ];
  const { router, shell } = await openChat({ standalone: "1", sessionId }, true);
  await vi.waitFor(() => expect(shell.findAll(".agent-schedule-list button").map(button => button.attributes("title"))).toEqual(["Sales review"]));

  await shell.get(".agent-schedule-list button").trigger("click");
  await vi.waitFor(() => {
    expect(router.currentRoute.value.path).toBe("/applications/app-data-agent-workbench/workbench");
    expect(router.currentRoute.value.query.sessionId).toBe(sessionId);
    const [path, query] = String(router.currentRoute.value.query.page).split("?");
    expect(path).toBe(page);
    expect(new URLSearchParams(query).get("selectedTask")).toBe(example.id);
    const address = shell.get(".legacy-schedules-surface").attributes("data-panel-address")!;
    expect(new URLSearchParams(address.split("?")[1]).get("workspace")).toBe("agent");
    expect(shell.get(".agent-schedule-list button").attributes("aria-current")).toBe("page");
  });

  const reopened = await openChat({ standalone: "1", sessionId, page: `${page}?selectedTask=${example.id}` }, true);
  expect(reopened.shell.get(".agent-schedule-list button").attributes("aria-current")).toBe("page");
  expect(reopened.shell.props("sessionId")).toBe(sessionId);
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

  it("waits for a pending /api/assistant/agents request before selecting an agentKind deep link without page", async () => {
    const pending = deferred<typeof agents>();
    directory.listAgents = () => pending.promise;
    const error = vi.spyOn(ElMessage, "error");

    const { router, shell } = await openChat({});
    await router.push({
      path: platformRoutes.chat.path,
      query: { agentKind: "ops-diagnosis", prefill: "Diagnose this Turn (sessionId: s-3, runId: r-3)." },
    });
    await flush();

    // While the directory is still loading, never report the agent unavailable or prefill prematurely.
    expect(error).not.toHaveBeenCalled();
    expect(filled).toEqual([]);
    expect(sent).toEqual([]);

    pending.resolve(agents);
    await flush(6);

    expect(error).not.toHaveBeenCalled();
    expect(shell.props("agentId")).toBe(opsDiagnosis!.id);
    expect(shell.props("sessionId") ?? null).toBeNull();
    expect(filled).toEqual(["Diagnose this Turn (sessionId: s-3, runId: r-3)."]);
    expect(sent).toEqual([]);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it("waits for a pending directory before sending an agentId deep link prompt once", async () => {
    const pending = deferred<typeof agents>();
    directory.listAgents = () => pending.promise;
    const error = vi.spyOn(ElMessage, "error");

    const { router, shell } = await openChat({});
    await router.push({
      path: platformRoutes.chat.path,
      query: { agentId: opsDiagnosis!.id, prompt: "Inspect slow query" },
    });
    await flush();

    expect(error).not.toHaveBeenCalled();
    expect(sent).toEqual([]);

    pending.resolve(agents);
    await flush(6);

    expect(error).not.toHaveBeenCalled();
    expect(shell.props("agentId")).toBe(opsDiagnosis!.id);
    expect(sent).toEqual(["Inspect slow query"]);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it.each([
    ["missing", [sales!]],
    ["disabled", [sales!, { ...opsDiagnosis!, enabled: false }]],
  ])("reports unavailable only after the directory resolves with a %s target", async (_case, listed) => {
    const pending = deferred<typeof agents>();
    directory.listAgents = () => pending.promise;
    const error = vi.spyOn(ElMessage, "error");

    const { router, shell } = await openChat({});
    await router.push({
      path: platformRoutes.chat.path,
      query: { agentKind: "ops-diagnosis", prefill: "Draft preserved" },
    });
    await flush();

    expect(error).not.toHaveBeenCalled();
    expect(filled).toEqual([]);

    pending.resolve(listed);
    await flush(6);

    expect(error).toHaveBeenCalledWith(i18n.global.t("assistant.agentUnavailable"));
    expect(shell.props("agentId")).toBe(sales!.id);
    expect(filled).toEqual(["Draft preserved"]);
    expect(sent).toEqual([]);
  });

  it("reports the directory failure reason instead of agentUnavailable when /api/assistant/agents fails", async () => {
    const pending = deferred<typeof agents>();
    directory.listAgents = () => pending.promise;
    const error = vi.spyOn(ElMessage, "error");

    const { router } = await openChat({});
    await router.push({
      path: platformRoutes.chat.path,
      query: { agentKind: "ops-diagnosis", prefill: "Keep my draft" },
    });
    await flush();

    expect(error).not.toHaveBeenCalled();

    pending.reject(new Error("Agent directory unavailable (503)"));
    await flush(6);

    expect(error).toHaveBeenCalledWith("Agent directory unavailable (503)");
    expect(error).not.toHaveBeenCalledWith(i18n.global.t("assistant.agentUnavailable"));
    expect(filled).toEqual(["Keep my draft"]);
    expect(sent).toEqual([]);
  });

  it("applies only the latest deep link when a second navigation arrives while the directory is still loading", async () => {
    const pending = deferred<typeof agents>();
    directory.listAgents = () => pending.promise;
    const error = vi.spyOn(ElMessage, "error");

    const { router, shell } = await openChat({});
    await router.push({
      path: platformRoutes.chat.path,
      query: { agentKind: "ops-diagnosis", prefill: "First link" },
    });
    await router.push({
      path: platformRoutes.chat.path,
      query: { agentId: sales!.id, prompt: "Second link" },
    });
    await flush();

    expect(error).not.toHaveBeenCalled();
    expect(filled).toEqual([]);
    expect(sent).toEqual([]);

    pending.resolve(agents);
    await flush(6);

    expect(error).not.toHaveBeenCalled();
    expect(shell.props("agentId")).toBe(sales!.id);
    expect(filled).toEqual([]);
    expect(sent).toEqual(["Second link"]);
  });

  it("retries the directory when a deep link arrives after an earlier directory read failed", async () => {
    let attempt = 0;
    directory.listAgents = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("Initial load failed");
      return agents;
    };
    const error = vi.spyOn(ElMessage, "error");

    const { router, shell } = await openChat({});
    expect(error).toHaveBeenCalledWith("Initial load failed");
    error.mockClear();

    await router.push({
      path: platformRoutes.chat.path,
      query: { agentKind: "ops-diagnosis", prefill: "Recovered link" },
    });
    await flush(6);

    expect(attempt).toBe(2);
    expect(error).not.toHaveBeenCalled();
    expect(shell.props("agentId")).toBe(opsDiagnosis!.id);
    expect(filled).toEqual(["Recovered link"]);
  });
});
