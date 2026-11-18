import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, type App } from "vue";
import type { AgentHostRunSnapshot } from "@ontomato/contracts/agent-host";
import AgentShell from "../components/AgentShell.vue";
import { testDisplay } from "./display";
import type { AgentHostClient } from "../host";
import { useAgentNav } from "../useAgentNav";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

/*
 * Showing something beside the conversation is a live request, answered once. What a run presented before is part of its
 * record — the call, its result, the file it registered — and reading that record back (opening the conversation, its
 * running snapshot, a reconnect) shows the record, never the file or the page again.
 */
const sessionId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const artifactId = "33333333-3333-4333-8333-333333333333";
const workbench: ShellWorkbenchDeclaration = { id: "agents", label: "Agents", features: [] };
/** Every label is its own name, called or shown: what the shell writes is not what this reads. */
const labels = new Proxy({}, {
  get: (_target, key) => (typeof key === "string" ? Object.assign(() => key, { toString: () => key }) : undefined),
}) as unknown as ShellLabels;
const presented = { target: "outputs/result.dataset.json" };

const call = {
  role: "assistant" as const,
  content: [{ type: "toolCall" as const, id: "call-1", name: "present", arguments: presented }],
  api: null, provider: null, model: null, usage: null, stopReason: "toolUse" as const, timestamp: 2,
};
const answer = {
  role: "toolResult" as const, toolCallId: "call-1", toolName: "present", isError: false, timestamp: 3,
  content: [{ type: "text" as const, text: JSON.stringify({ status: "opened", reason: "target_selected" }) }],
};
const running: AgentHostRunSnapshot = {
  pendingQuestions: [],
  run: {
    id: runId, sessionId, status: "running", stopReason: null, errorMessage: null, answerMessageId: null,
    workspaceCommit: null, createdAt: new Date(0).toISOString(), finishedAt: null, resolvedSkills: [],
  },
  cursor: { runId, seq: 4, streamId: "44444444-4444-4444-8444-444444444444" },
  messages: [
    { contextSeq: 0, id: "55555555-5555-4555-8555-555555555555", runId, messageSeq: 0, message: { role: "user", content: "show it", timestamp: 1 } },
    { contextSeq: 1, id: "66666666-6666-4666-8666-666666666666", runId, messageSeq: 1, message: call },
    { contextSeq: 2, id: "77777777-7777-4777-8777-777777777777", runId, messageSeq: 2, message: answer },
  ],
  pendingMessages: [],
  toolExecutions: [{ toolCallId: "call-1", toolName: "present", status: "succeeded", args: presented }],
  artifacts: [{ id: artifactId, sessionId, runId, path: presented.target }],
} as unknown as AgentHostRunSnapshot;

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

it("opens nothing when a conversation that presented is read back, running or reconnected", async () => {
  const client = {
    listAgents: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    readHistory: vi.fn().mockResolvedValue({
      pendingQuestions: [],
      session: { id: sessionId, agentId: "a", title: "", origin: "user", createdAt: new Date(0).toISOString(), latestRun: null },
      messages: running.messages,
      runs: [],
      latestRun: running,
      page: { messageSeq: 2, olderCursor: null },
    }),
    readRun: vi.fn().mockResolvedValue(running),
    subscribe: vi.fn(() => () => {}),
    resolveArtifact: vi.fn(),
  } as unknown as AgentHostClient;
  const display = testDisplay(workbench);
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({ client: () => client, agentId: () => null, setAgentId: () => {}, sessionId: () => sessionId, setSessionId: () => {} });
      return () => h(AgentShell, { workbench, display, client, labels, nav, sessionId });
    },
  });
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(Host);
  app.mount(root);
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));

  expect(client.readHistory).toHaveBeenCalled();
  expect(display.target.value).toBeNull();
  expect(root.querySelector(".side-panel")).toBeNull();
});
