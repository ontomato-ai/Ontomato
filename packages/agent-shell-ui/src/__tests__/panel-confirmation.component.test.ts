import { afterEach, expect, it } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import type { AgentPendingQuestion } from "@ontomato/contracts/agent-channel";
import type { AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
import type { AgentTasksFrame } from "@ontomato/contracts/agent-tasks";
import AgentShell from "../components/AgentShell.vue";
import { testDisplay } from "./display";
import { createAgentHostClient } from "../host";
import { useAgentNav } from "../useAgentNav";
import type { ShellLabels, ShellPanelOperationsPort, ShellRunChange } from "../types";

/*
 * A panel operation an agent wants to run is confirmed by the person who started the conversation, from the question
 * panel over the composer (contracts/panel-agent.md, "P4 UI contract"). These mount the real shell over the real host
 * client; only the host's HTTP answers are written here. Only the option the reader picked says which one was chosen; the
 * question waits in the conversation after its reply ended; the answer comes back as a receipt that starts nothing here;
 * and the conversation's owner sees and changes whether agents ask at all.
 */

const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rootRunId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const childRunId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const questionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const answerId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const at = new Date(0).toISOString();

const agent = { id: agentId, name: "Assistant", description: "", icon: null, enabled: true };
const session = { id: sessionId, agentId, title: "Run the inspection", origin: "user" as const, createdAt: at, updatedAt: at, latestRun: { id: rootRunId, status: "stopped" as const, stopReason: "stop" as const } };
/** The question the operation coordinator sends: option 0 does not run the call and is the default, option 1 runs it. */
const confirmation: AgentPendingQuestion = {
  requestId: questionId,
  source: { session: { providerId: "workbench", sessionId: "99999999-9999-4999-8999-999999999999" }, runId: childRunId },
  message: "Run **Inspect now** on e2e task as Alice?",
  defaultAssumption: "Do not run it",
  options: [{ label: "Do not run", isDefault: true }, { label: "Run" }],
};

/** The conversation as the host reads it: one finished reply, and whatever questions the host says wait. */
function history(pendingQuestions: AgentPendingQuestion[]): AgentHostSessionHistory {
  return {
    session,
    pendingQuestions,
    runs: [{ id: rootRunId, sessionId, status: "stopped", stopReason: "stop", errorMessage: null, answerMessageId: "12121212-1212-4212-8212-121212121212", workspaceCommit: null, createdAt: at, finishedAt: at, resolvedSkills: [] }],
    messages: [
      { id: "13131313-1313-4313-8313-131313131313", runId: rootRunId, messageSeq: 1, contextSeq: 1, message: { role: "user", content: "Run the inspection task", timestamp: 1 } },
      { id: "12121212-1212-4212-8212-121212121212", runId: rootRunId, messageSeq: 2, contextSeq: 2, message: { role: "assistant", content: [{ type: "text", text: "I asked you to confirm." }], api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 } },
    ],
    latestRun: null,
    page: { olderCursor: null, nextCursor: null, throughCursor: "through", messageSeq: 2 },
  } as AgentHostSessionHistory;
}

/** The host's reply to an answer of a question addressed to the reader: recorded here, nothing started. */
function receipt(body: { message: string; replyTo: string; selectedOption?: number }) {
  return {
    delivery: { messageId: answerId, sessionRef: { providerId: "workbench", sessionId }, runId: rootRunId, delivery: "receipt", status: "completed" },
    input: { id: answerId, runId: rootRunId, messageSeq: 3, contextSeq: null, message: { role: "notification", kind: "agent-answer", source: { kind: "user" }, replyTo: body.replyTo, ...(body.selectedOption === undefined ? {} : { selectedOption: body.selectedOption }), content: body.message, timestamp: 3 } },
    snapshot: null,
    pendingQuestions: [],
    replayed: false,
  };
}

const labels = {
  newConversation: "New chat", sessions: "Recent", more: "More", sessionActions: "Conversation actions", renameSession: "Rename",
  deleteSession: "Delete", scheduledSession: "Scheduled", placeholder: "Message", send: "Send", stop: "Stop", greeting: "Hello",
  submit: "Submit", answered: (text: string) => `Answered: ${text}`, steps: (count: number) => `${count} steps`,
  working: "Working", elapsed: (time: string) => time, worked: (time: string) => `Worked ${time}`, thinking: "Thinking", preparing: "Preparing",
  questionsWaiting: (count: number) => `${count} waiting`, questionOptionDefault: "Default", questionOptionOther: "Other",
  questionOtherPlaceholder: "Your answer", questionSkip: "Skip", questionPrevious: "Previous", questionNext: "Next",
  panelConfirmation: "Confirm panel operations", panelAutomatic: "Automatic", panelAutomaticHint: "Agents run panel operations without asking",
} as unknown as ShellLabels;

const json = (value: unknown) => ({ json: async () => value }) as Response;
/** An event stream that sends its frames and stays open, as the host keeps a conversation's task stream while a question waits. */
function stream(frames: unknown[]) {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(`event: tasks\ndata: ${JSON.stringify(frame)}\n\n`));
      },
    }),
  } as Response;
}
function tasksFrame(pendingQuestions: AgentPendingQuestion[]): AgentTasksFrame {
  return { type: "tasks_snapshot", settled: false, sessionId, tasks: [], qualityResults: [], pendingQuestions };
}

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 6; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The agent platform's arrangement over a host whose conversation has `pending` questions in its history and `streamed`
 * in its task stream. Every request the shell makes is recorded; a send is answered with a receipt.
 */
function render(options: { pending?: AgentPendingQuestion[]; streamed?: AgentPendingQuestion[]; panelOperations?: ShellPanelOperationsPort } = {}) {
  const requests: { method: string; path: string; body?: unknown }[] = [];
  const runs: ShellRunChange[] = [];
  const client = createAgentHostClient({
    tasks: true,
    async request(path, init) {
      const method = init.method ?? "GET", body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ method, path, body });
      if (path === "/agents") return json({ agents: [agent] });
      if (path.startsWith("/sessions?")) return json({ sessions: [session], nextCursor: null });
      if (path.startsWith(`/sessions/${sessionId}/history`)) return json(history(options.pending ?? []));
      if (path === `/sessions/${sessionId}/tasks/events`) return stream(options.streamed ? [tasksFrame(options.streamed)] : []);
      if (method === "POST" && path === `/sessions/${sessionId}/runs`) return json(receipt(body));
      throw new Error(`unexpected ${method} ${path}`);
    },
  });
  const Host = defineComponent({
    setup() {
      const agentRef = ref<string | null>(agentId), sessionRef = ref<string | null>(sessionId);
      const nav = useAgentNav({
        client: () => client,
        agentId: () => agentRef.value,
        setAgentId: (id) => (agentRef.value = id),
        sessionId: () => sessionRef.value,
        setSessionId: (id) => (sessionRef.value = id),
      });
      void nav.loadAgents();
      void nav.loadSessions();
      return () => h(AgentShell, {
        workbench: { id: "business", label: "Agents", features: [] },
        display: testDisplay({ id: "business", label: "Agents", features: [] }), client, labels, nav,
        panelOperations: options.panelOperations,
        agentId: agentRef.value, sessionId: sessionRef.value,
        "onUpdate:sessionId": (id: string | null) => (sessionRef.value = id),
        onRun: (change: ShellRunChange) => runs.push(change),
      });
    },
  });
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(Host);
  app.mount(root);
  return { root, requests, runs };
}

const optionButton = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>(".question-option")].find((option) => option.querySelector(".option-label")?.textContent?.trim().startsWith(label))!;
const sends = (requests: { method: string; path: string; body?: unknown }[]) =>
  requests.filter((request) => request.method === "POST" && request.path === `/sessions/${sessionId}/runs`).map((request) => request.body);
async function submit(root: HTMLElement) {
  root.querySelector("form.questions-body")!.dispatchEvent(new Event("submit"));
  await settle();
}

it("sends the index of the option the reader picked, and none with the reader's own words", async () => {
  // Each answer is to a fresh copy of the question, as the host would ask again for a new operation.
  for (const [pick, expected] of [["Run", 1], ["Do not run", 0]] as const) {
    const { root, requests } = render({ pending: [confirmation] });
    await settle();
    optionButton(root, pick).click();
    await nextTick();
    await submit(root);
    // Only the text, the question it answers and the pick: who answered, and from where, is the host's to add.
    expect(sends(requests)).toEqual([{ message: pick, replyTo: questionId, selectedOption: expected }]);
    app!.unmount();
    app = null;
  }

  const { root, requests } = render({ pending: [confirmation] });
  await settle();
  // Picking an option and then writing one's own answer sends the words alone, even when they read like an option.
  optionButton(root, "Run").click();
  const own = root.querySelector<HTMLInputElement>(".question-option input")!;
  own.value = "Run";
  own.dispatchEvent(new Event("input"));
  await nextTick();
  await submit(root);
  expect(sends(requests)).toEqual([{ message: "Run", replyTo: questionId }]);
});

it("lists a question that reaches the conversation after its reply ended, from the conversation's task stream", async () => {
  const { root } = render({ pending: [], streamed: [confirmation] });
  await settle();
  // The only reply stopped long ago; the question is still the reader's to answer.
  expect(root.querySelector(".questions-toggle")?.textContent).toContain("1 waiting");
  expect(root.querySelector(".question-text strong")?.textContent).toBe("Inspect now");
  expect(optionButton(root, "Run")).toBeTruthy();
});

it("takes the answer's receipt without starting or following a run", async () => {
  const { root, requests, runs } = render({ pending: [confirmation] });
  await settle();
  const responses = root.querySelectorAll(".response").length;
  const before = requests.length;
  optionButton(root, "Run").click();
  await nextTick();
  await submit(root);

  // The one request is the answer itself: no run read, no run stream.
  expect(requests.slice(before).map((request) => `${request.method} ${request.path}`)).toEqual([`POST /sessions/${sessionId}/runs`]);
  expect(runs).toEqual([]);
  // No new reply appears, nothing is running and the composer still sends; the answered question is gone.
  expect(root.querySelectorAll(".response")).toHaveLength(responses);
  expect(root.querySelector(".waiting")).toBeNull();
  expect([...root.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Stop" || button.getAttribute("aria-label") === "Stop")).toBe(false);
  expect(root.querySelector(".questions")).toBeNull();
  expect(root.textContent).toContain("Answered: Run");
});

it("shows the owner whether agents ask before panel operations, and lets the owner change it from the conversation's menu", async () => {
  const held = new Map<string, boolean>();
  const writes: [string, boolean][] = [];
  const port: ShellPanelOperationsPort = {
    read: async (id) => held.get(id) ?? true,
    write: async (id, confirm) => {
      writes.push([id, confirm]);
      held.set(id, confirm);
      return confirm;
    },
  };
  const { root } = render({ panelOperations: port });
  await settle();
  const row = () => root.querySelector(".session-item")!;
  const menuItem = async () => {
    row().querySelector<HTMLButtonElement>(".session-more")!.click();
    await settle();
    return root.querySelector<HTMLButtonElement>(".session-panel-confirmation")!;
  };

  // A conversation asks by default, which needs no mark; its menu shows the switch on.
  expect(row().querySelector(".session-automatic")).toBeNull();
  let item = await menuItem();
  expect(item.textContent?.trim()).toBe("Confirm panel operations");
  expect(item.getAttribute("aria-pressed")).toBe("true");

  // Turned off, the row says the conversation runs them without asking, for as long as it does.
  item.click();
  await settle();
  expect(writes).toEqual([[sessionId, false]]);
  expect(root.querySelector(".session-menu")).toBeNull();
  expect(row().querySelector(".session-automatic")?.textContent).toBe("Automatic");
  expect(row().querySelector(".session-automatic")?.getAttribute("title")).toBe("Agents run panel operations without asking");

  item = await menuItem();
  expect(item.getAttribute("aria-pressed")).toBe("false");
  item.click();
  await settle();
  expect(writes).toEqual([[sessionId, false], [sessionId, true]]);
  expect(row().querySelector(".session-automatic")).toBeNull();
});

it("offers the choice to nobody but the conversation's owner", async () => {
  const writes: unknown[] = [];
  // The host refuses anyone else; its port says so with null.
  const { root } = render({ panelOperations: { read: async () => null, write: async (...args) => (writes.push(args), true) } });
  await settle();
  root.querySelector<HTMLButtonElement>(".session-more")!.click();
  await settle();
  expect(root.querySelector(".session-menu")).not.toBeNull();
  expect(root.querySelector(".session-panel-confirmation")).toBeNull();
  expect(root.querySelector(".session-automatic")).toBeNull();
  expect(writes).toEqual([]);
});
