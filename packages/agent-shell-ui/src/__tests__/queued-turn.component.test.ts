import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, ref, type App } from "vue";
import type { AgentHostClient } from "../host";
import type { AgentHostRunSnapshot, AgentHostSendResult } from "@ontomato/contracts/agent-host";
import type { AgentTasksFrame } from "@ontomato/contracts/agent-tasks";
import type { RuntimeEventEnvelope } from "@ontomato/contracts/agent-runtime-events";
import { useAgentConversation } from "../useAgentConversation";
import ShellConversation from "../components/ShellConversation.vue";
import { shellContextKey, type ShellContext } from "../context";

const sessionId = "11111111-1111-4111-8111-111111111111";
const queuedRunId = "22222222-2222-4222-8222-222222222222";
const firstInputId = "33333333-3333-4333-8333-333333333333";
const secondInputId = "44444444-4444-4444-8444-444444444444";

const labels = {
  placeholder: "Message",
  send: "Send",
  stop: "Stop",
  greeting: "Hello",
  scrollToBottom: "Latest",
  working: "Working",
  queuedWaiting: "Received — waiting for the previous turn to finish",
  elapsed: (time: string) => time,
  worked: (time: string) => `Worked ${time}`,
  thinking: "Thinking",
  preparing: "Preparing",
  steps: (count: number) => `${count} steps`,
  answered: (text: string) => text,
  pageContext: (page: { label: string; url: string }) => `${page.label} (${page.url})`,
  pageContextAddress: (url: string) => url,
  selectionContext: (s: string) => s,
  fileContext: (file: { label: string; path: string }) => `${file.label} (${file.path})`,
  pageContextClosed: "Closed",
};

let app: App | null = null;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function createClient(options?: { onTasksSubscribe?: (emit: (frame: AgentTasksFrame) => void) => void }) {
  let taskFrameHandler: ((frame: AgentTasksFrame) => void) | null = null;
  let streamFrameHandler: ((frame: { type: "event"; envelope: RuntimeEventEnvelope }) => void) | null = null;
  const send = vi.fn<Parameters<AgentHostClient["send"]>, ReturnType<AgentHostClient["send"]>>();
  const readRun = vi.fn<Parameters<AgentHostClient["readRun"]>, ReturnType<AgentHostClient["readRun"]>>();
  const readHistory = vi.fn<Parameters<AgentHostClient["readHistory"]>, ReturnType<AgentHostClient["readHistory"]>>().mockResolvedValue({
    session: { id: sessionId, agentId: "agent-1", title: "Scheduled", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), latestRun: null },
    messages: [],
    runs: [],
    latestRun: null,
    pendingQuestions: [],
    page: { olderCursor: null, nextCursor: null, throughCursor: `${sessionId}:0`, messageSeq: 0 },
  });
  const client = {
    send,
    readRun,
    readHistory,
    createSession: vi.fn(),
    cancel: vi.fn(async () => ({ run: null })),
    subscribe: vi.fn((_sid, _rid, _after, handlers) => {
      streamFrameHandler = (frame) => handlers.frame(frame);
      return () => {
        streamFrameHandler = null;
      };
    }),
    tasks: {
      subscribe: vi.fn((_sid, handlers) => {
        taskFrameHandler = handlers.frame;
        options?.onTasksSubscribe?.(handlers.frame);
        return () => {
          taskFrameHandler = null;
        };
      }),
    },
  } as unknown as AgentHostClient;

  return {
    client,
    send,
    readRun,
    readHistory,
    emitTasks: (frame: AgentTasksFrame) => taskFrameHandler?.(frame),
    emitRunEvent: (envelope: RuntimeEventEnvelope) =>
      streamFrameHandler?.({ type: "event", envelope }),
  };
}

function mountShell(client: AgentHostClient) {
  let conversation!: ReturnType<typeof useAgentConversation>;
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp({
    setup() {
      conversation = useAgentConversation(() => client, () => "agent-1");
      return () =>
        h(ShellConversation, {
          items: conversation.items.value,
          sessionId: conversation.state.sessionId,
          agent: { id: "agent-1", name: "Analyst", description: "", icon: null, enabled: true },
          loading: conversation.loading.value,
          loadError: conversation.loadError.value,
          hasOlder: Boolean(conversation.olderCursor.value),
          loadingOlder: conversation.loadingOlder.value,
          olderError: conversation.olderError.value,
          historyRevision: conversation.historyRevision.value,
          sendError: conversation.sendError.value,
          pendingInput: conversation.pendingInput.value,
          busy: conversation.busy.value,
          sending: conversation.sending.value,
          onSend: (text: string) => void conversation.send("agent-1", text),
          onStop: () => void conversation.cancel(),
        });
    },
  });
  app.provide(shellContextKey, {
    labels: ref(labels),
    slots: {},
    toolRenderers: ref([]),
    questions: {
      pending: ref([]),
      sending: ref(false),
      answer: vi.fn(),
      view: reactive({ open: true, current: null, drafts: {}, skipped: [] }),
    },
  } as unknown as ShellContext);
  app.mount(root);
  return { root, conversation };
}

it("shows a queued waiting indicator on delivery status 'starting' and transitions cleanly through running to completed", async () => {
  const { client, send, readRun, emitRunEvent } = createClient();
  const { root, conversation } = mountShell(client);
  await conversation.open(sessionId);
  await nextTick();

  const firstResult: AgentHostSendResult = {
    delivery: {
      messageId: firstInputId,
      sessionRef: { providerId: "workbench", sessionId },
      runId: queuedRunId,
      delivery: "run",
      status: "starting",
    },
    input: {
      id: firstInputId,
      runId: null,
      messageSeq: 2,
      contextSeq: null,
      message: { role: "user", content: "Check monthly revenue", timestamp: 10 },
    },
    pendingQuestions: [],
    replayed: false,
    snapshot: null,
  };
  send.mockResolvedValueOnce(firstResult);

  await conversation.send("agent-1", "Check monthly revenue");
  await nextTick();

  expect(conversation.busy.value).toBe(true);
  expect(conversation.queuedRunId.value).toBe(queuedRunId);
  expect(conversation.items.value).toEqual([
    { kind: "user", key: firstInputId, text: "Check monthly revenue", answer: false, queued: true },
  ]);
  expect(root.querySelector(".user-queued")?.textContent).toContain(labels.queuedWaiting);

  // A second message coalescing into the same queued run also displays the queued waiting state.
  const secondResult: AgentHostSendResult = {
    delivery: {
      messageId: secondInputId,
      sessionRef: { providerId: "workbench", sessionId },
      runId: queuedRunId,
      delivery: "steer",
      status: "starting",
    },
    input: {
      id: secondInputId,
      runId: null,
      messageSeq: 3,
      contextSeq: null,
      message: { role: "user", content: "Include refunds too", timestamp: 20 },
    },
    pendingQuestions: [],
    replayed: false,
    snapshot: null,
  };
  send.mockResolvedValueOnce(secondResult);

  await conversation.send("agent-1", "Include refunds too");
  await nextTick();

  expect(root.querySelectorAll(".user-queued")).toHaveLength(2);

  // When the queued run starts running, queued indicators clear and active run takes over.
  const startedSnapshot: AgentHostRunSnapshot = {
    run: {
      id: queuedRunId,
      sessionId,
      status: "running",
      stopReason: null,
      errorMessage: null,
      answerMessageId: null,
      workspaceCommit: null,
      createdAt: new Date(30).toISOString(),
      finishedAt: null,
      resolvedSkills: [],
    },
    cursor: { seq: 3, streamId: "stream-1", runId: queuedRunId },
    messages: [
      {
        id: firstInputId,
        runId: queuedRunId,
        messageSeq: 2,
        contextSeq: 2,
        message: { role: "user", content: "Check monthly revenue", timestamp: 10 },
      },
    ],
    pendingMessages: [],
    toolExecutions: [],
    artifacts: [],
    pendingQuestions: [],
  };
  readRun.mockResolvedValueOnce(startedSnapshot);
  await conversation.followRun(queuedRunId);
  await nextTick();

  expect(conversation.queuedRunId.value).toBeNull();
  expect(conversation.activeRunId.value).toBe(queuedRunId);
  expect(conversation.busy.value).toBe(true);
  expect(root.querySelectorAll(".user-queued")).toHaveLength(0);

  // Once the run completes, busy returns to false.
  emitRunEvent({
    sessionId,
    cursor: { seq: 4, streamId: "stream-1", runId: queuedRunId },
    timestamp: new Date(40).toISOString(),
    event: {
      type: "agent_end",
      status: "stopped",
      stopReason: "stop",
      errorMessage: null,
      answerMessageId: null,
      workspaceCommit: null,
      messages: [],
    },
  });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await nextTick();

  expect(conversation.activeRunId.value).toBeNull();
  expect(conversation.busy.value).toBe(false);
});

it("projects server-reported queuedRuns on session open and clears when the task stream removes them", async () => {
  const { client, readHistory, emitTasks } = createClient();
  readHistory.mockResolvedValueOnce({
    session: { id: sessionId, agentId: "agent-1", title: "Scheduled", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), latestRun: null },
    messages: [
      {
        id: firstInputId,
        runId: null,
        messageSeq: 2,
        contextSeq: null,
        message: { role: "user", content: "Waiting after reload", timestamp: 10 },
      },
    ],
    runs: [],
    latestRun: null,
    pendingQuestions: [],
    page: { olderCursor: null, nextCursor: null, throughCursor: `${sessionId}:2`, messageSeq: 2 },
  });
  const { root, conversation } = mountShell(client);
  await conversation.open(sessionId);
  emitTasks({
    type: "tasks_snapshot",
    sessionId,
    tasks: [],
    qualityResults: [],
    queuedRuns: [{ runId: queuedRunId, inputIds: [firstInputId], createdAt: new Date(10).toISOString() }],
    settled: false,
  });
  await nextTick();

  expect(conversation.busy.value).toBe(true);
  expect(root.querySelector(".user-queued")?.textContent).toContain(labels.queuedWaiting);

  emitTasks({
    type: "tasks_snapshot",
    sessionId,
    tasks: [],
    qualityResults: [],
    queuedRuns: [],
    settled: false,
  });
  await nextTick();

  expect(conversation.busy.value).toBe(false);
  expect(root.querySelector(".user-queued")).toBeNull();
});
