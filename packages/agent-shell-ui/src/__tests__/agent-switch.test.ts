import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import AgentShell from "../components/AgentShell.vue";
import { useAgentNav } from "../useAgentNav";
import type { AgentHostClient } from "../host";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

/*
 * Switching the agent is a new conversation: the conversation already open belongs to the agent it was started with and
 * is not handed to another one. A reply still running keeps its agent until it ends, because the run is admitted under
 * that agent; non-run switches start clean, and nothing rebinds a live session.
 */
const labels = { placeholder: "Message", send: "Send", stop: "Stop", working: "Working", switchWhileRunning: "Wait" } as unknown as ShellLabels;
const workbench: ShellWorkbenchDeclaration = { id: "agents", label: "Agents", features: [] };
const assistant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const analyst = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const admission = (): unknown => ({
  delivery: { messageId: runId, sessionRef: { providerId: "workbench", sessionId: session.id }, runId, delivery: "run", status: "running" },
  input: { id: runId, runId, messageSeq: 1, contextSeq: 1, message: { role: "user", content: "Price by region", timestamp: 1 } },
  snapshot: {
    pendingQuestions: [],
    run: { id: runId, sessionId: session.id, status: "running", stopReason: null, errorMessage: null, answerMessageId: null, workspaceCommit: null, createdAt: new Date(0).toISOString(), finishedAt: null, resolvedSkills: [] },
    cursor: { runId, seq: 1, streamId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
    messages: [], pendingMessages: [], toolExecutions: [], artifacts: [],
  },
  pendingQuestions: [], replayed: false,
});
const session = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", agentId: assistant, title: "Earlier", origin: "user", createdAt: new Date(0).toISOString(), latestRun: null };

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

function client(): AgentHostClient {
  return {
    listAgents: vi.fn().mockResolvedValue([
      { id: assistant, name: "Assistant", description: "", icon: null, enabled: true },
      { id: analyst, name: "Analyst", description: "", icon: null, enabled: true },
    ]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [session], nextCursor: null }),
    readHistory: vi.fn().mockResolvedValue({ messages: [], hasOlder: false, nextCursor: null }),
    // The reply the second test switches during is admitted and never reaches its end.
    send: vi.fn(async () => admission()),
    sessionRuns: { read: vi.fn().mockResolvedValue({ sessions: [] }), subscribe: () => () => {} },
  } as unknown as AgentHostClient;
}

function render(busy = false) {
  const agentId = ref<string | null>(assistant);
  const sessionId = ref<string | null>(session.id);
  const errors: string[] = [];
  const left: number[] = [];
  let loadAgents = () => {};
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client,
        agentId: () => agentId.value,
        setAgentId: (id) => (agentId.value = id),
        sessionId: () => sessionId.value,
        setSessionId: (id) => (sessionId.value = id),
        onLeaveConversation: () => left.push(1),
      });
      loadAgents = () => void nav.loadAgents();
      return () =>
        h(
          AgentShell,
          {
            workbench, client: client(), labels, nav,
            agentId: agentId.value,
            "onUpdate:agentId": (id: string | null) => (agentId.value = id),
            sessionId: sessionId.value,
            "onUpdate:sessionId": (id: string | null) => (sessionId.value = id),
            onError: (message: string) => errors.push(message),
          },
          // The shell's composer reads the busy state from the conversation it opened; a reply is simulated by a run
          // that is still going, which the state only knows from a send.
        );
    },
  });
  app = createApp(Host);
  const root = document.createElement("div");
  document.body.append(root);
  app.mount(root);
  void loadAgents();
  return { root, agentId, sessionId, errors, left, busy };
}

async function choose(root: HTMLElement, id: string) {
  const picker = root.querySelector(".composer .agent-switch")!;
  (picker.querySelector(".switch-trigger") as HTMLButtonElement).click();
  await nextTick();
  (document.querySelector(`[role="option"] button`) as HTMLButtonElement | null)?.click();
  await settle();
  return id;
}

it("switches agent into a new conversation, not by rebinding the open one", async () => {
  const { root, agentId, sessionId, left } = render();
  await settle();
  expect(agentId.value).toBe(assistant);

  const trigger = root.querySelector(".composer .switch-trigger") as HTMLButtonElement;
  trigger.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await nextTick();
  const options = [...document.querySelectorAll<HTMLButtonElement>(".agent-menu .agent-option")];
  options.find((option) => option.textContent?.includes("Analyst"))!.click();
  await settle();

  expect(agentId.value).toBe(analyst);
  // The conversation belonged to the assistant: switching starts a new one instead of moving it.
  expect(sessionId.value).toBeNull();
  expect(left.length).toBeGreaterThan(0);
});

it("keeps the running conversation's agent until the reply ends", async () => {
  const { root, agentId, sessionId, errors } = render();
  await settle();
  const input = root.querySelector("textarea")!;
  input.value = "Price by region";
  input.dispatchEvent(new Event("input"));
  await nextTick();
  (root.querySelector(".composer-button") as HTMLButtonElement).click();
  await settle();

  const trigger = root.querySelector(".composer .switch-trigger") as HTMLButtonElement;
  trigger.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await nextTick();
  const options = [...document.querySelectorAll<HTMLButtonElement>(".agent-menu .agent-option")];
  options.find((option) => option.textContent?.includes("Analyst"))!.click();
  await settle();

  expect(agentId.value).toBe(assistant);
  expect(sessionId.value).toBe(session.id);
  expect(errors).toEqual([labels.switchWhileRunning]);
});
