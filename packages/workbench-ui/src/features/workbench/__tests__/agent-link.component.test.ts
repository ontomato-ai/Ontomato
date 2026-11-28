import { platformRoutes } from "@ontomato/platform-shell/routes";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { mount } from "@vue/test-utils";
import { onMounted, onUnmounted } from "vue";
import type { AgentHostSession } from "@ontomato/contracts/agent-host";
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
const analysisResponse = vi.hoisted(() => ({ sessions: [] as unknown[], nextCursor: null as string | null }));
const readAnalysisPage = vi.hoisted(() => vi.fn(async (_path: string) => analysisResponse));
const resultSession = "44444444-4444-4444-8444-444444444444";
const visibleConversation = vi.hoisted(() => ({ source: null as null | {
  sessionId: string; agentId: string; title: string; initialInstruction: () => Promise<string>;
} }));
const fillScheduleDraft = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, member: "newForm", filledFields: ["/task/title", "/instruction"] })));
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
      props: ["agentId", "sessionId", "display", "conversationBackLabel", "agentSettings"],
      emits: ["conversationBack", "railAgentSelected", "update:sessionId"],
      setup(props, { emit, expose, slots }) {
        expose({ reloadAgents: async () => {}, send: async (text: string) => { sent.push(text); }, fill: (text: string) => { filled.push(text); }, showHistory: () => {} });
        return () => h("div", [
          slots.shortcuts?.(),
          props.agentSettings ? h("button", { "data-agent-settings": "", onClick: props.agentSettings.open }) : undefined,
          slots["before-history"]?.(),
          slots["session-list"]?.(),
          !props.display.page.value && props.conversationBackLabel
            ? h("button", { "data-conversation-back": "", onClick: () => emit("conversationBack") }) : undefined,
          props.sessionId ? slots["artifact-actions"]?.({}) : undefined,
          !props.display.page.value && visibleConversation.source && props.sessionId === visibleConversation.source.sessionId
            ? slots["conversation-heading-actions"]?.(visibleConversation.source) : undefined,
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
  nodeApiGet: readAnalysisPage,
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
  analysisResponse.sessions = [];
  analysisResponse.nextCursor = null;
  visibleConversation.source = null;
  fillScheduleDraft.mockClear();
  readAnalysisPage.mockReset().mockImplementation(async () => analysisResponse);
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
        [pilotPageKey as symbol]: (navigate: (address: string) => void) => (address: string) => address.split("?")[0] === platformRoutes.schedules.path
          ? {
              id: "panel-application", instance: platformRoutes.schedules.path, props: { address, navigate },
              component: {
                props: ["address", "navigate", "registerPageController"],
                emits: ["context", "display-address"],
                setup: (props: { address: string; navigate: (address: string) => void; registerPageController: (controller: unknown) => () => void }, { emit }: { emit: (event: string, payload: unknown) => void }) => {
                  const unregister = props.registerPageController({ fillForm: fillScheduleDraft });
                  const address = new URL(props.address, "https://example.test");
                  const newForm = address.searchParams.get("workspaceCompose") === "new";
                  onUnmounted(unregister);
                  onMounted(() => {
                    if (newForm) emit("context", { forms: [{ member: "newForm", formInstanceId: "active-draft", dirty: false }] });
                  });
                  return {
                    newForm,
                    openResult: () => props.navigate(`${platformRoutes.chat.path}?sessionId=${resultSession}`),
                    cancel: () => {
                      address.searchParams.delete("workspaceCompose");
                      emit("display-address", { kind: "state", address: address.pathname + address.search });
                    },
                  };
                },
                template: '<div :data-panel-address="address"><button v-if="newForm" data-cancel-schedule @click="cancel" /><button v-else data-latest-result @click="openResult" /></div>',
              },
            }
          : [platformRoutes.dashboards.path, platformRoutes.agents.path, `${platformRoutes.agents.path}/detail`].includes(address.split("?")[0]!)
            ? { id: "panel-application", props: { "data-panel-address": address }, component: { template: "<div />" } }
            : null,
      } },
  });
  wrappers.push(wrapper);
  for (let index = 0; index < 3; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  return { router, shell: wrapper.findComponent({ name: "AgentShell" }) };
}

it("keeps failed and cancelled analyses out of the completed group across pages", async () => {
  function session(index: number, title: string, latestRun: AgentHostSession["latestRun"]) {
    const date = "2026-11-28T00:00:00.000Z";
    return { id: `44444444-4444-4444-8444-44444444444${index}`, agentId: sales!.id, createdAt: date, updatedAt: date, title, latestRun };
  }
  const run = { id: resultSession, status: "stopped" as const };
  analysisResponse.sessions = [session(1, "Finished analysis", { ...run, stopReason: "stop" })];
  analysisResponse.nextCursor = "next";
  readAnalysisPage.mockImplementation(async (path) => path.includes("cursor=")
    ? { sessions: [
        session(2, "Interrupted analysis", { ...run, stopReason: "aborted" }),
        session(3, "Errored analysis", { ...run, stopReason: "error" }),
        session(4, "Truncated analysis", { ...run, stopReason: "length" }),
        session(5, "Delegated analysis", { ...run, stopReason: "toolUse", delegatedRunning: true }),
      ], nextCursor: null }
    : analysisResponse);
  const { shell } = await openChat({ taskView: "all" }, true);
  await shell.get(".legacy-task-history button.more").trigger("click");
  await vi.waitFor(() => {
    const rowsFor = (status: string) => shell.get(`.history-list-marker[data-status="${status}"]`).element.closest("section")?.textContent;
    expect(rowsFor("completed")).toContain("Finished analysis");
    expect(rowsFor("completed")).not.toMatch(/Interrupted|Errored|Truncated|Delegated/);
    expect(rowsFor("cancelled")).toContain("Interrupted analysis");
    expect(rowsFor("failed")).toContain("Errored analysis");
    expect(rowsFor("failed")).toContain("Truncated analysis");
    expect(rowsFor("running")).toContain("Delegated analysis");
  });
});

it("prefills an editable private schedule draft and returns to its source session on cancel", async () => {
  const instruction = "Summarize returns by region";
  const title = "Returns review";
  visibleConversation.source = {
    sessionId: resultSession, agentId: sales!.id, title,
    initialInstruction: async () => instruction,
  };
  const { router, shell } = await openChat({ sessionId: resultSession, taskView: "all" }, true);
  await shell.get(".workbench-conversation-schedule").trigger("click");
  await vi.waitFor(() => expect(fillScheduleDraft).toHaveBeenCalledWith({
    member: "newForm", expectedFormInstanceId: "active-draft",
    values: { "/task/title": title, "/instruction": instruction },
  }));
  const address = new URL(String(router.currentRoute.value.query.page), "https://example.test");
  expect(address.searchParams.get("workspaceAgent")).toBe(sales!.id);
  expect(router.currentRoute.value.fullPath).not.toContain(encodeURIComponent(instruction));
  expect(router.currentRoute.value.fullPath).not.toContain(encodeURIComponent(title));

  await shell.get("[data-cancel-schedule]").trigger("click");
  await vi.waitFor(() => {
    expect(router.currentRoute.value.query.page).toBeUndefined();
    expect(router.currentRoute.value.query.sessionId).toBe(resultSession);
    expect(router.currentRoute.value.query.taskView).toBe("all");
  });
});

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
    expect(router.currentRoute.value.path).toBe("/applications/app-data-agent-workbench/workbench");
    expect(router.currentRoute.value.query.sessionId).toBe(sessionId);
    expect(router.currentRoute.value.query.page).toBe("/applications/app-data-agent-workbench/dashboards?dashboardId=new-dashboard");
  });
  await shell.get(".workbench-panel-back").trigger("click");
  await vi.waitFor(() => {
    expect(router.currentRoute.value.query.page).toBeUndefined();
    expect(shell.props("sessionId")).toBe(sessionId);
  });
});

it("opens the authorized agent catalog inside DataAgent and keeps the conversation on return", async () => {
  const sessionId = "44444444-4444-4444-8444-444444444444";
  const { router, shell } = await openChat({ standalone: "1", sessionId }, true);
  await shell.get("[data-agent-settings]").trigger("click");
  await vi.waitFor(() => {
    expect(shell.get("[data-panel-address]").attributes("data-panel-address")).toBe(platformRoutes.agents.path);
    expect(router.currentRoute.value.query.sessionId).toBe(sessionId);
  });
  await shell.get(".workbench-panel-back").trigger("click");
  await vi.waitFor(() => {
    expect(router.currentRoute.value.query.page).toBeUndefined();
    expect(shell.props("sessionId")).toBe(sessionId);
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

it.each([false, true])("opens a schedule from all tasks and returns after its run (prior conversation: %s)", async (keepPriorConversation) => {
  const scheduled = examples.creates.find(item => item.name === "agents-instruction")!.response;
  scheduleResponse.tasks = [{
    ...scheduled, title: "Other agent's review", appId: "agents",
    content: { agentId: retired!.id, instruction: "Review" },
  }];
  const session = {
    agentId: sales!.id, latestRun: null,
    createdAt: "2026-11-28T00:00:00.000Z", updatedAt: "2026-11-28T00:00:00.000Z",
  };
  const manualSession = "77777777-7777-4777-8777-777777777777";
  analysisResponse.sessions = [
    { ...session, id: manualSession, title: "Manual analysis", origin: "user" },
    { ...session, id: resultSession, title: "Scheduled run", origin: "scheduled" },
  ];
  const { router, shell } = await openChat({ standalone: "1" }, true);

  await shell.get(".legacy-footer-item").trigger("click");
  const task = await vi.waitFor(() => shell.get(".legacy-task-list .agent-schedule-open"));
  const schedules = task.element.closest("section");
  expect(schedules?.textContent).toContain("Other agent's review");
  expect(schedules?.textContent).not.toContain("Manual analysis");
  expect(schedules?.textContent).not.toContain("Scheduled run");
  const conversations = shell.get(".legacy-task-history");
  expect(conversations.text()).toContain("Manual analysis");
  expect(conversations.text()).toContain("Scheduled run");
  if (keepPriorConversation) {
    await conversations.findAll("button").find(button => button.text().includes("Manual analysis"))!.trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.query.sessionId).toBe(manualSession));
  }
  await task.trigger("click");
  const result = await vi.waitFor(() => shell.get("[data-latest-result]"));
  const source = String(router.currentRoute.value.query.page);
  expect(new URLSearchParams(source.split("?")[1]).get("workspaceAgent")).toBe(retired!.id);

  await result.trigger("click");
  await vi.waitFor(() => {
    expect(shell.props("sessionId")).toBe(resultSession);
    expect(shell.find(".legacy-schedules-surface").exists()).toBe(false);
  });
  const current = router.currentRoute.value.query;
  const reopened = await openChat(Object.fromEntries(Object.entries(current).filter((entry): entry is [string, string] => typeof entry[1] === "string")), true);
  await reopened.shell.get("[data-conversation-back]").trigger("click");
  await vi.waitFor(() => {
    expect(reopened.router.currentRoute.value.query.page).toBe(source);
    expect(reopened.shell.props("sessionId")).toBe(keepPriorConversation ? manualSession : null);
    expect(reopened.shell.get(".legacy-task-list .agent-schedule-open").attributes("aria-current")).toBe("page");
  });
  reopened.shell.vm.$emit("railAgentSelected");
  await vi.waitFor(() => expect(reopened.shell.find(".legacy-task-history").exists()).toBe(false));
});

it("keeps the current history page and retries the same cursor after loading more fails", async () => {
  const first = {
    id: resultSession, agentId: sales!.id, title: "Recent analysis",
    createdAt: "2026-11-28T00:00:00.000Z", updatedAt: "2026-11-28T00:00:00.000Z",
    latestRun: null,
  };
  const older = { ...first, id: "77777777-7777-4777-8777-777777777777", title: "Older analysis" };
  readAnalysisPage
    .mockResolvedValueOnce({ sessions: [first], nextCursor: "page-2" })
    .mockRejectedValueOnce(new Error("Page temporarily unavailable"))
    .mockResolvedValueOnce({ sessions: [older], nextCursor: null });
  const { shell } = await openChat({ standalone: "1", taskView: "all" }, true);
  const history = shell.get(".legacy-task-history");

  await history.get("button.more").trigger("click");
  await vi.waitFor(() => expect(history.find("[role=alert]").exists()).toBe(true));
  expect(history.text()).toContain(first.title);
  expect(history.text()).not.toContain(older.title);

  await history.get("button.more").trigger("click");
  await vi.waitFor(() => expect(history.text()).toContain(older.title));
  expect(history.text()).toContain(first.title);
  expect(history.find("button.more").exists()).toBe(false);
  expect(readAnalysisPage.mock.calls.slice(1).map(([path]) => path)).toEqual([
    "/assistant/analysis-sessions?cursor=page-2",
    "/assistant/analysis-sessions?cursor=page-2",
  ]);
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
