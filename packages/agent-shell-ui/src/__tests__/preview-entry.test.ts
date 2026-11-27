import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import type { AgentHostRunSnapshot, AgentHostSendRequest } from "@ontomato/contracts/agent-host";
import { EXECUTION_CONTEXT_HEADER, previewExecutionContextHeader } from "@ontomato/contracts/execution-context";
import { createAgentHostClient, type AgentHostClient } from "../host";
import AgentShell from "../components/AgentShell.vue";
import { servePageComposerKey, type PageComposerExpand } from "../page-composer-entry";
import { testDisplay } from "./display";
import { useAgentNav } from "../useAgentNav";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

/*
 * A preview's conversation entry never goes on in the conversation the reader has open: it opens one of its own, as the
 * preview's, so every run in it runs as the preview whichever composer took the entry.
 */
const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const openSessionId = "99999999-9999-4999-8999-999999999999";
const createdSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const workbench: ShellWorkbenchDeclaration = { id: "agents", label: "Agent platform", features: [] };
const labels = { placeholder: "Message", send: "Send", stop: "Stop" } as unknown as ShellLabels;
const created = { id: createdSessionId, agentId, title: "", origin: "user", createdAt: new Date(0).toISOString(), latestRun: null };
const admitted: AgentHostRunSnapshot = {
  pendingQuestions: [],
  run: {
    id: runId, sessionId: createdSessionId, status: "stopped", stopReason: "stop", errorMessage: null, answerMessageId: null,
    workspaceCommit: null, createdAt: new Date(0).toISOString(), finishedAt: null, resolvedSkills: [],
  },
  cursor: { runId, seq: 1, streamId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
  messages: [], pendingMessages: [], toolExecutions: [], artifacts: [],
};

let app: App | null = null;
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ""; });

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

it("opens a preview's entry as a new conversation of the preview's own, even beside an open conversation with the same agent", async () => {
  const send = vi.fn(async (_sessionId: string, input: AgentHostSendRequest) => ({
    delivery: { messageId: runId, sessionRef: { providerId: "workbench", sessionId: createdSessionId }, runId, delivery: "run", status: "stopped" },
    input: { id: runId, runId, messageSeq: 1, contextSeq: 1, message: { role: "user", content: input.message, timestamp: 1 } },
    snapshot: admitted, pendingQuestions: [], replayed: false,
  }));
  const createSession = vi.fn().mockResolvedValue(created);
  const client = {
    listAgents: vi.fn().mockResolvedValue([{ id: agentId, name: "Assistant", description: "", enabled: true }]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    createSession, send,
    subscribe: () => () => {},
    sessionRuns: { read: vi.fn().mockResolvedValue({ sessions: [] }), subscribe: () => () => {} },
    readHistory: vi.fn().mockResolvedValue({
      pendingQuestions: [], session: { ...created, id: openSessionId }, messages: [], runs: [], latestRun: null,
      page: { messageSeq: 0, olderCursor: null },
    }),
  } as unknown as AgentHostClient;
  const sessionId = ref<string | null>(openSessionId);
  const shownAgent = ref<string | null>(agentId);
  const served: PageComposerExpand[] = [];
  const display = testDisplay(workbench, {});
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client: () => client, agentId: () => shownAgent.value, setAgentId: (id) => (shownAgent.value = id),
        sessionId: () => sessionId.value, setSessionId: (id) => (sessionId.value = id),
      });
      void nav.loadAgents();
      return () => h(AgentShell, {
        workbench, client, labels, nav, agentId: shownAgent.value, display,
        "onUpdate:agentId": (id: string | null) => (shownAgent.value = id),
        sessionId: sessionId.value, "onUpdate:sessionId": (id: string | null) => (sessionId.value = id),
      });
    },
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp(Host);
  app.provide(servePageComposerKey, (expand: PageComposerExpand) => {
    served.push(expand);
    return () => void served.splice(served.indexOf(expand), 1);
  });
  app.mount(root);
  await settle();

  await served.at(-1)!({ target: { kind: "id", id: agentId }, prefill: "Which orders are late?", submit: true, preview: true });
  await settle();
  // Not the open conversation: a new one, opened as the preview's.
  expect(createSession).toHaveBeenCalledTimes(1);
  expect(createSession).toHaveBeenCalledWith(agentId, { preview: true });
  expect(send).toHaveBeenCalledWith(createdSessionId, expect.objectContaining({ message: "Which orders are late?" }));
  expect(sessionId.value).toBe(createdSessionId);

  // A live entry afterwards opens nothing as the preview's.
  await served.at(-1)!({ target: { kind: "id", id: agentId }, prefill: "And on the live page?", submit: true, newSession: true });
  await settle();
  expect(createSession).toHaveBeenLastCalledWith(agentId);
});

it("marks the request that opens a preview's conversation, and only that one", async () => {
  const request = vi.fn(async (_path: string, _init: RequestInit) => Response.json({ session: created }));
  const client = createAgentHostClient({ request });
  await client.createSession(agentId, { preview: true });
  await client.createSession(agentId);
  const markers = request.mock.calls.map(([, init]) => new Headers(init.headers).get(EXECUTION_CONTEXT_HEADER));
  expect(markers).toEqual([previewExecutionContextHeader, null]);
});
