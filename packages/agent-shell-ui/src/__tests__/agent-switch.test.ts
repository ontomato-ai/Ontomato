import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import AgentShell from "../components/AgentShell.vue";
import { testDisplay } from "./display";
import { useAgentNav, type AgentNav } from "../useAgentNav";
import { servePageComposerKey, type PageComposerExpand } from "../page-composer-entry";
import type { AgentHostSendResult, AgentHostSession, AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "../host";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

/*
 * Switching the agent starts a new blank conversation: the conversation already open belongs to the agent it was
 * started with and keeps running in the background when left, so switching during a running reply or via a panel
 * conversation entry opens a new conversation without error or rebinding.
 *
 * The agent is chosen at the head of the application's column, where the user put it (2026-11-06), and only there: the
 * conversation's composer has no chooser of its own, so nothing else on the screen can change the current agent.
 */
const labels = {
  agent: "Agent", placeholder: "Message", send: "Send", stop: "Stop", working: "Working",
  elapsed: (time: string) => time, worked: (time: string) => `Worked ${time}`,
} as unknown as ShellLabels;
const workbench: ShellWorkbenchDeclaration = { id: "agents", label: "Agents", features: [] };
const assistant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const analyst = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const session: AgentHostSession = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", agentId: assistant, title: "Earlier", origin: "user",
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), latestRun: null,
};

function admission(sessionId: string, content = "Price by region"): AgentHostSendResult {
  return {
    delivery: { messageId: runId, sessionRef: { providerId: "workbench", sessionId }, runId, delivery: "run", status: "running" },
    input: { id: runId, runId, messageSeq: 1, contextSeq: 1, message: { role: "user", content, timestamp: 1 } },
    snapshot: {
      pendingQuestions: [],
      run: { id: runId, sessionId, status: "running", stopReason: null, errorMessage: null, answerMessageId: null, workspaceCommit: null, createdAt: new Date(0).toISOString(), finishedAt: null, resolvedSkills: [] },
      cursor: { runId, seq: 1, streamId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
      messages: [], pendingMessages: [], toolExecutions: [], artifacts: [],
    },
    pendingQuestions: [], replayed: false,
  };
}

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

async function settle() {
  for (let i = 0; i < 4; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

function makeSession(id: string, agentId: string): AgentHostSession {
  return { id, agentId, title: "", origin: "user", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), latestRun: null };
}

function makeClient(overrides: Partial<AgentHostClient> = {}): AgentHostClient {
  return {
    listAgents: vi.fn().mockResolvedValue([
      { id: assistant, name: "Assistant", description: "", icon: null, enabled: true },
      { id: analyst, name: "Analyst", description: "", icon: null, enabled: true },
    ]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [session], nextCursor: null }),
    readHistory: vi.fn().mockResolvedValue({
      pendingQuestions: [],
      session,
      messages: [],
      runs: [],
      latestRun: null,
      page: { messageSeq: 0, olderCursor: null },
    }),
    createSession: vi.fn(async (input) => {
      const targetAgent = typeof input === "string" ? input : input.agentId;
      return makeSession(`session-${targetAgent}`, targetAgent);
    }),
    send: vi.fn(async (id: string, input: { message: string }) => admission(id, input.message)),
    cancel: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => () => {}),
    sessionRuns: { read: vi.fn().mockResolvedValue({ sessions: [] }), subscribe: () => () => {} },
    ...overrides,
  } as unknown as AgentHostClient;
}

function render(options: { initialSessionId?: string | null; client?: AgentHostClient } = {}) {
  const host = options.client ?? makeClient();
  const agentId = ref<string | null>(assistant);
  const sessionId = ref<string | null>(options.initialSessionId === undefined ? session.id : options.initialSessionId);
  const errors: string[] = [];
  const left: number[] = [];
  const served: PageComposerExpand[] = [];
  const shell = ref<{ send(text: string): Promise<void> } | null>(null);
  let nav!: AgentNav;
  const Host = defineComponent({
    setup() {
      nav = useAgentNav({
        client: () => host,
        agentId: () => agentId.value,
        setAgentId: (id) => (agentId.value = id),
        sessionId: () => sessionId.value,
        setSessionId: (id) => (sessionId.value = id),
        onLeaveConversation: () => left.push(1),
      });
      void nav.loadAgents();
      return () =>
        h(
          AgentShell,
          {
            ref: shell,
            workbench, display: testDisplay(workbench), client: host, labels, nav, agentPicker: true,
            agentId: agentId.value,
            "onUpdate:agentId": (id: string | null) => (agentId.value = id),
            sessionId: sessionId.value,
            "onUpdate:sessionId": (id: string | null) => (sessionId.value = id),
            onError: (message: string) => errors.push(message),
          },
          { "composer-context": ({ unstarted }: { unstarted: boolean }) => h("span", { class: "unstarted" }, String(unstarted)) },
        );
    },
  });
  app = createApp(Host);
  app.provide(servePageComposerKey, (expand: PageComposerExpand) => {
    served.push(expand);
    return () => void served.splice(served.indexOf(expand), 1);
  });
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  return { root, host, agentId, sessionId, errors, left, served, shell, nav: () => nav };
}

async function pickAgent(root: HTMLElement, name: string) {
  const trigger = root.querySelector(".shell-nav-body .switch-trigger") as HTMLButtonElement;
  trigger.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await nextTick();
  const options = [...document.querySelectorAll<HTMLButtonElement>(".agent-menu .agent-option")];
  options.find((option) => option.textContent?.includes(name))!.click();
  await settle();
}

it("chooses the agent at the column's head, once, and never in the composer", async () => {
  const { root } = render();
  await settle();

  expect(root.querySelectorAll(".switch-trigger")).toHaveLength(1);
  expect(root.querySelector(".shell-nav-body .switch-trigger")).not.toBeNull();
  expect(root.querySelector(".composer .switch-trigger")).toBeNull();
});

it("switches agent into a new conversation, not by rebinding the open one", async () => {
  const { root, agentId, sessionId, left } = render();
  await settle();
  expect(agentId.value).toBe(assistant);

  await pickAgent(root, "Analyst");

  expect(agentId.value).toBe(analyst);
  // The conversation belonged to the assistant: switching starts a new one instead of moving it.
  expect(sessionId.value).toBeNull();
  expect(left.length).toBeGreaterThan(0);
});

it("switches to a new blank conversation when a reply is running, leaving the running reply untouched", async () => {
  const { root, host, agentId, sessionId, errors, left } = render();
  await settle();

  const input = root.querySelector("textarea")!;
  input.value = "Price by region";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  (root.querySelector(".composer-button") as HTMLButtonElement).click();
  await settle();

  await pickAgent(root, "Analyst");

  expect(agentId.value).toBe(analyst);
  expect(sessionId.value).toBeNull();
  expect(errors).toEqual([]);
  expect(left.length).toBeGreaterThan(0);
  expect(root.querySelector(".unstarted")?.textContent).toBe("true");
  expect(host.cancel).not.toHaveBeenCalled();

  // Returning to the original agent and conversation still opens the original session.
  await pickAgent(root, "Assistant");
  sessionId.value = session.id;
  await settle();
  expect(host.readHistory).toHaveBeenLastCalledWith(session.id);
});

it("allows a panel conversation entry to start a new or preview session while a reply is running", async () => {
  const createdIds = ["new-analyst-session", "preview-analyst-session"];
  let createdIndex = 0;
  const host = makeClient({
    createSession: vi.fn(async (input) => {
      const id = createdIds[createdIndex++] ?? `session-${createdIndex}`;
      const targetAgent = typeof input === "string" ? input : input.agentId;
      return makeSession(id, targetAgent);
    }),
  });
  const { root, agentId, sessionId, errors, served } = render({ client: host });
  await settle();

  // Start a running reply on the assistant session.
  const input = root.querySelector("textarea")!;
  input.value = "Price by region";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  (root.querySelector(".composer-button") as HTMLButtonElement).click();
  await settle();

  // Entry naming another agent opens and sends a new session without blocking or cancelling the running one.
  await served.at(-1)!({ target: { kind: "id", id: analyst }, prefill: "Analyze sales", submit: true });
  await settle();

  expect(errors).toEqual([]);
  expect(agentId.value).toBe(analyst);
  expect(sessionId.value).toBe("new-analyst-session");
  expect(host.createSession).toHaveBeenNthCalledWith(1, analyst);
  expect(host.send).toHaveBeenLastCalledWith("new-analyst-session", expect.objectContaining({ message: "Analyze sales" }));
  expect(host.cancel).not.toHaveBeenCalled();

  // Entry with preview: true on the now-running same agent starts a separate preview session.
  await served.at(-1)!({ target: { kind: "id", id: analyst }, prefill: "Preview check", submit: true, preview: true });
  await settle();

  expect(errors).toEqual([]);
  expect(sessionId.value).toBe("preview-analyst-session");
  expect(host.createSession).toHaveBeenNthCalledWith(2, analyst, { preview: true });
  expect(host.send).toHaveBeenLastCalledWith("preview-analyst-session", expect.objectContaining({ message: "Preview check" }));

  // Entry with newSession: true prefill opens a clean blank composer while preview session is still running.
  await served.at(-1)!({ target: { kind: "id", id: analyst }, prefill: "Fresh draft", newSession: true });
  await settle();

  expect(errors).toEqual([]);
  expect(sessionId.value).toBeNull();
  expect(root.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Fresh draft");
});

function makeRecordedHost(options: {
  createSession?: (input: string | { agentId: string }) => Promise<AgentHostSession>;
  send?: (id: string, message: string, defaultSend: (id: string, message: string) => Promise<AgentHostSendResult>) => Promise<AgentHostSendResult>;
} = {}) {
  const sessions = new Map<string, AgentHostSession>();
  const histories = new Map<string, AgentHostSessionHistory>();
  let seq = 0;

  const defaultCreate = async (input: string | { agentId: string }) => {
    const targetAgent = typeof input === "string" ? input : input.agentId;
    return makeSession(`recorded-${++seq}`, targetAgent);
  };

  const defaultSend = async (id: string, message: string): Promise<AgentHostSendResult> => {
    const existing = sessions.get(id);
    if (existing && !existing.title) {
      sessions.set(id, { ...existing, title: message });
    }
    const replyRunId = `run-${id}`;
    const answerId = `answer-${id}`;
    const userMsg = { id: `user-${id}`, runId: replyRunId, messageSeq: 1, contextSeq: 1, message: { role: "user" as const, content: message, timestamp: 1 } };
    const assistantMsg = {
      id: answerId, runId: replyRunId, messageSeq: 2, contextSeq: 2,
      message: {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: `Answer to: ${message}` }],
        api: null, provider: null, model: null, usage: null, stopReason: "stop" as const, timestamp: 2,
      },
    };
    const finishedRun = {
      id: replyRunId, sessionId: id, status: "stopped" as const, stopReason: "stop" as const, errorMessage: null,
      answerMessageId: answerId, workspaceCommit: null, createdAt: new Date(0).toISOString(), finishedAt: new Date(0).toISOString(), resolvedSkills: [],
    };
    histories.set(id, {
      pendingQuestions: [],
      session: sessions.get(id) ?? makeSession(id, assistant),
      messages: [userMsg, assistantMsg],
      runs: [finishedRun],
      latestRun: null,
      page: { messageSeq: 2, olderCursor: null, nextCursor: null, throughCursor: "" },
    });
    return admission(id, message);
  };

  const client = makeClient({
    listSessions: vi.fn(async (targetAgent: string) => ({
      sessions: [...sessions.values()].filter((row) => row.agentId === targetAgent),
      nextCursor: null,
    })),
    readHistory: vi.fn(async (id: string): Promise<AgentHostSessionHistory> => histories.get(id) ?? {
      pendingQuestions: [],
      session: sessions.get(id) ?? session,
      messages: [],
      runs: [],
      latestRun: null,
      page: { messageSeq: 0, olderCursor: null, nextCursor: null, throughCursor: "" },
    }),
    createSession: vi.fn(async (input) => {
      const created = await (options.createSession ? options.createSession(input) : defaultCreate(input));
      sessions.set(created.id, created);
      return created;
    }),
    send: vi.fn(async (id: string, input: { message: string }) =>
      options.send ? options.send(id, input.message, defaultSend) : defaultSend(id, input.message),
    ),
  });

  return { client, sessions };
}

it("1) sends the first sentence into its own background session when switching away before createSession returns", async () => {
  const firstCreate = deferred<AgentHostSession>();
  const host = makeRecordedHost({ createSession: () => firstCreate.promise });
  const view = render({ initialSessionId: null, client: host.client });
  await settle();

  const firstSend = view.shell.value!.send("Before create");
  await settle();
  await pickAgent(view.root, "Analyst");

  expect(view.agentId.value).toBe(analyst);
  expect(view.sessionId.value).toBeNull();
  expect(view.root.querySelector(".unstarted")?.textContent).toBe("true");
  expect(view.root.textContent).not.toContain("Before create");

  firstCreate.resolve(makeSession("bg-before-create", assistant));
  await firstSend;
  await settle();

  expect(host.client.send).toHaveBeenCalledWith("bg-before-create", expect.objectContaining({ message: "Before create" }));
  expect(view.agentId.value).toBe(analyst);
  expect(view.sessionId.value).toBeNull();
  expect(view.nav().sessions.value.map((row) => row.id)).not.toContain("bg-before-create");

  await pickAgent(view.root, "Assistant");
  const openBtn = [...view.root.querySelectorAll<HTMLButtonElement>(".session-list .session-open")]
    .find((btn) => btn.textContent?.includes("Before create"));
  expect(openBtn).toBeDefined();
  openBtn!.click();
  await settle();
  expect(view.sessionId.value).toBe("bg-before-create");
  expect(view.root.textContent).toContain("Before create");
  expect(view.root.textContent).toContain("Answer to: Before create");
});

it("2) sends the first sentence into its own background session when switching away after createSession returns and before client.send is called", async () => {
  const secondCreate = deferred<AgentHostSession>();
  let view!: ReturnType<typeof render>;
  const host = makeRecordedHost({
    createSession: () => {
      const p = secondCreate.promise;
      void p.then(() => {
        // User starts a new blank conversation on the same agent right as createSession resolves, before send() resumes.
        (view.root.querySelector(".nav-item.primary") as HTMLButtonElement).click();
      });
      return p.then((created) => created);
    },
  });
  view = render({ initialSessionId: null, client: host.client });
  await settle();

  const secondSend = view.shell.value!.send("After create before send");
  await nextTick();
  secondCreate.resolve(makeSession("bg-between-create-and-send", assistant));
  await secondSend;
  await settle();

  expect(host.client.send).toHaveBeenCalledWith("bg-between-create-and-send", expect.objectContaining({ message: "After create before send" }));
  expect(view.sessionId.value).toBeNull();
  expect(view.root.querySelector(".unstarted")?.textContent).toBe("true");
  const openBtn = [...view.root.querySelectorAll<HTMLButtonElement>(".session-list .session-open")]
    .find((btn) => btn.textContent?.includes("After create before send"));
  expect(openBtn).toBeDefined();
  openBtn!.click();
  await settle();
  expect(view.sessionId.value).toBe("bg-between-create-and-send");
  expect(view.root.textContent).toContain("After create before send");
  expect(view.root.textContent).toContain("Answer to: After create before send");
});

it("3) runs the first sentence in its own background session when switching away after client.send is called and before run admission", async () => {
  const pendingAdmit = deferred<AgentHostSendResult>();
  const host = makeRecordedHost({
    send: async (id, message, defaultSend) => {
      const result = await defaultSend(id, message);
      if (id === "bg-before-admit") return pendingAdmit.promise;
      return result;
    },
    createSession: async (input) => {
      const targetAgent = typeof input === "string" ? input : input.agentId;
      return makeSession(targetAgent === assistant ? "bg-before-admit" : "analyst-fresh", targetAgent);
    },
  });
  const view = render({ initialSessionId: null, client: host.client });
  await settle();

  const sentToAssistant = view.shell.value!.send("Before admit");
  await settle();
  await pickAgent(view.root, "Analyst");

  expect(view.agentId.value).toBe(analyst);
  expect(view.sessionId.value).toBeNull();
  expect(view.root.querySelector(".unstarted")?.textContent).toBe("true");

  pendingAdmit.resolve(admission("bg-before-admit", "Before admit"));
  await sentToAssistant;
  await settle();

  expect(view.agentId.value).toBe(analyst);
  expect(view.sessionId.value).toBeNull();
  expect(view.nav().sessions.value.map((row) => row.id)).not.toContain("bg-before-admit");

  await pickAgent(view.root, "Assistant");
  const openBtn = [...view.root.querySelectorAll<HTMLButtonElement>(".session-list .session-open")]
    .find((btn) => btn.textContent?.includes("Before admit"));
  expect(openBtn).toBeDefined();
  openBtn!.click();
  await settle();
  expect(view.sessionId.value).toBe("bg-before-admit");
  expect(view.root.textContent).toContain("Before admit");
  expect(view.root.textContent).toContain("Answer to: Before admit");
});

it("keeps an unaccepted first-sentence send from hijacking a panel entry switch before admission", async () => {
  // Switch via panel entry after createSession resolved, while client.send is still pending.
  const pendingAdmit = deferred<AgentHostSendResult>();
  let count = 0;
  const hostBeforeAdmit = makeClient({
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    createSession: vi.fn(async (input) => {
      const id = count++ === 0 ? "assistant-unadmitted" : "analyst-fresh";
      const targetAgent = typeof input === "string" ? input : input.agentId;
      return makeSession(id, targetAgent);
    }),
    send: vi.fn(async (id: string, input: { message: string }) => {
      if (id === "assistant-unadmitted") return pendingAdmit.promise;
      return admission(id, input.message);
    }),
  });
  const view2 = render({ initialSessionId: null, client: hostBeforeAdmit });
  await settle();

  const sentToAssistant = view2.shell.value!.send("Before admit");
  await settle();
  await view2.served.at(-1)!({ target: { kind: "id", id: analyst }, prefill: "Analyst question", submit: true });
  await settle();

  expect(view2.agentId.value).toBe(analyst);
  expect(view2.sessionId.value).toBe("analyst-fresh");

  pendingAdmit.resolve(admission("assistant-unadmitted", "Before admit"));
  await sentToAssistant;
  await settle();

  expect(view2.agentId.value).toBe(analyst);
  expect(view2.sessionId.value).toBe("analyst-fresh");
  expect(view2.nav().sessions.value.map((row) => row.id)).not.toContain("assistant-unadmitted");
});

it("resets an unaccepted first-sentence send on same-agent new/preview entry or A -> B -> A before admission", async () => {
  // 1) Same-agent preview entry while sessionId is still null and client.send is pending must not drop or hijack.
  const firstAdmit = deferred<AgentHostSendResult>();
  let seq = 0;
  const hostSameAgent = makeClient({
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    createSession: vi.fn(async (input) => {
      const id = seq++ === 0 ? "first-unadmitted" : "preview-fresh";
      const targetAgent = typeof input === "string" ? input : input.agentId;
      return makeSession(id, targetAgent);
    }),
    send: vi.fn(async (id: string, input: { message: string }) => {
      if (id === "first-unadmitted") return firstAdmit.promise;
      return admission(id, input.message);
    }),
  });
  const view1 = render({ initialSessionId: null, client: hostSameAgent });
  await settle();

  const firstSend = view1.shell.value!.send("First unaccepted");
  await settle();
  await view1.served.at(-1)!({ target: { kind: "id", id: assistant }, prefill: "Preview question", submit: true, preview: true });
  await settle();

  expect(view1.sessionId.value).toBe("preview-fresh");
  expect(hostSameAgent.createSession).toHaveBeenNthCalledWith(2, assistant, { preview: true });
  expect(hostSameAgent.send).toHaveBeenLastCalledWith("preview-fresh", expect.objectContaining({ message: "Preview question" }));

  firstAdmit.resolve(admission("first-unadmitted", "First unaccepted"));
  await firstSend;
  await settle();

  expect(view1.sessionId.value).toBe("preview-fresh");

  app?.unmount();
  app = null;
  document.body.innerHTML = "";

  // 2) Switching A -> B -> A while A's first send is pending admission must not hijack A's fresh blank conversation.
  const returnAdmit = deferred<AgentHostSendResult>();
  const hostRoundTrip = makeClient({
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    createSession: vi.fn(async () => makeSession("round-trip-unadmitted", assistant)),
    send: vi.fn(() => returnAdmit.promise),
  });
  const view2 = render({ initialSessionId: null, client: hostRoundTrip });
  await settle();

  const roundTripSend = view2.shell.value!.send("Abandoned before admit");
  await settle();
  await pickAgent(view2.root, "Analyst");
  await pickAgent(view2.root, "Assistant");

  expect(view2.agentId.value).toBe(assistant);
  expect(view2.sessionId.value).toBeNull();
  expect(view2.root.querySelector(".unstarted")?.textContent).toBe("true");

  returnAdmit.resolve(admission("round-trip-unadmitted", "Abandoned before admit"));
  await roundTripSend;
  await settle();

  expect(view2.sessionId.value).toBeNull();
  expect(view2.root.querySelector(".unstarted")?.textContent).toBe("true");
  expect(view2.nav().sessions.value.map((row) => row.id)).toContain("round-trip-unadmitted");
});
