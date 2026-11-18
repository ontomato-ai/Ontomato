import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import type { AgentHostRunSnapshot } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "../host";
import AgentShell from "../components/AgentShell.vue";
import { useAgentNav } from "../useAgentNav";
import type { PageContext } from "../page-context";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

/*
 * A page opened beside the conversation (a board, a report) is written on more than once. The page names itself on the
 * conversation's first message and is not repeated after it; the selection in it is carried every time.
 *
 * The first message of a new conversation creates that conversation while it is sent, and the shell then links its id.
 * That is not the reader opening another conversation: the page was just carried into the one being created, so the
 * second message in it carries the selection alone.
 */
const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const createdSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const workbench: ShellWorkbenchDeclaration = {
  id: "agents",
  label: "Agent platform",
  features: [{ id: "dashboards", label: "Dashboards", icon: "dashboard", availability: "page", withConversation: true }],
};
const labels = {
  placeholder: "Message", send: "Send", stop: "Stop",
  pageContext: (page: { label: string; url: string }) => `Current page: ${page.label} (${page.url})`,
  pageContextAddress: (url: string) => `Current page: ${url}`,
  selectionContext: (selection: string) => `Selected: ${selection}`,
} as unknown as ShellLabels;

const page: PageContext = {
  url: "/dashboards?dashboardId=board-a",
  label: "Dashboards",
  selection: [{ kind: "chart", id: "card-1", label: "e2e board card" }],
};

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
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * The shell beside a page, over a host that creates the conversation on its first message and admits every run. A host
 * may answer a conversation's history instead, to open one that already exists.
 */
function render(history?: { agentId: string; messages: { id: string; content: string }[] }, beside: PageContext = page) {
  const sent: string[] = [];
  const client = {
    listAgents: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    createSession: vi.fn().mockResolvedValue(created),
    send: vi.fn(async (_sessionId: string, input: { message: string }) => {
      sent.push(input.message);
      return {
        delivery: { messageId: runId, sessionRef: { providerId: "workbench", sessionId: createdSessionId }, runId, delivery: "run", status: "stopped" },
        input: { id: runId, runId, messageSeq: 1, contextSeq: 1, message: { role: "user", content: input.message, timestamp: 1 } },
        snapshot: admitted, pendingQuestions: [], replayed: false,
      };
    }),
    subscribe: () => () => {},
    sessionRuns: { read: vi.fn().mockResolvedValue({ sessions: [] }), subscribe: () => () => {} },
    readHistory: vi.fn().mockResolvedValue({
      pendingQuestions: [],
      session: history ? { ...created, agentId: history.agentId } : created,
      messages: (history?.messages ?? []).map((message, index) => ({
        id: message.id, runId, messageSeq: index + 1, contextSeq: index + 1,
        message: { role: "user", content: message.content, timestamp: index + 1 },
      })),
      runs: [], latestRun: null, page: { messageSeq: history?.messages.length ?? 0, olderCursor: null },
    }),
  } as unknown as AgentHostClient;
  const sessionId = ref<string | null>(history ? createdSessionId : null);
  const shell = ref<{ send(text: string): Promise<void> } | null>(null);
  const shownAgent = ref<string | null>(agentId);
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client: () => client, agentId: () => shownAgent.value, setAgentId: (id) => (shownAgent.value = id),
        sessionId: () => sessionId.value, setSessionId: (id) => (sessionId.value = id),
      });
      return () => h(AgentShell, {
        ref: shell, workbench, client, labels, nav, agentId: shownAgent.value,
        "onUpdate:agentId": (id: string | null) => (shownAgent.value = id),
        featureId: "dashboards", pageContext: beside,
        sessionId: sessionId.value, "onUpdate:sessionId": (id: string | null) => (sessionId.value = id),
      });
    },
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp(Host);
  app.mount(root);
  return { sent, sessionId, shell, shownAgent };
}

it("names the page on the conversation's first message, and only the selection after it", async () => {
  const { sent, sessionId, shell } = render();
  await settle();

  await shell.value!.send("first on this board");
  await settle();
  // The conversation this send created is where the page went; linking it is not the reader moving elsewhere.
  expect(sessionId.value).toBe(createdSessionId);
  expect(sent[0]).toBe("first on this board\n\nCurrent page: Dashboards (/dashboards?dashboardId=board-a)；Selected: e2e board card");

  await shell.value!.send("second on the same board");
  await settle();
  // The page is the same one, so it is not named a second time; what the page reports as selected still rides.
  expect(sent[1]).toBe("second on the same board\n\nSelected: e2e board card");
});

it("names the page at once, before the page reports what is selected in it", async () => {
  // The page has just opened and has reported nothing: what the shell opened is the dashboard application's page at its
  // own address, and that is what the first message carries. Nothing is invented for the selection.
  const quiet: PageContext = { url: page.url, label: page.label, selection: [] };
  const { sent, shell } = render(undefined, quiet);
  await settle();

  await shell.value!.send("what is this");
  await settle();
  expect(sent[0]).toBe("what is this\n\nCurrent page: Dashboards (/dashboards?dashboardId=board-a)");
});

it("names the page again in a conversation the reader opened instead", async () => {
  const { sent, sessionId, shell } = render();
  await settle();

  await shell.value!.send("first");
  await settle();
  // Another conversation is another page-less page until a message names the page there.
  sessionId.value = null;
  await settle();

  await shell.value!.send("in a new conversation");
  await settle();
  expect(sent[1]).toBe("in a new conversation\n\nCurrent page: Dashboards (/dashboards?dashboardId=board-a)；Selected: e2e board card");
});

it("does not name the page again in a conversation that already named it", async () => {
  // The conversation was written on this board before; reopening it shows a message that names it, so this board is what
  // it already carries. The address is the same and appears nowhere again — only what the reader selects now does.
  const { sent, sessionId, shell } = render({
    agentId,
    messages: [
      { id: "m1", content: "earlier on this board\n\nCurrent page: Dashboards (/dashboards?dashboardId=board-a)；Selected: e2e board card" },
      { id: "m2", content: "later on this board\n\nSelected: e2e board card" },
    ],
  });
  await settle();

  expect(sessionId.value).toBe(createdSessionId);
  await shell.value!.send("again on the same board");
  await settle();
  expect(sent[0]).toBe("again on the same board\n\nSelected: e2e board card");
});

it("names the page beside a conversation reopened on a same-titled page at another address", async () => {
  // Two applications show one panel of the same title at their own addresses. The conversation was written beside the
  // first; reopened beside the second, the page it carries is another one, so it is named.
  const { sent, sessionId, shell } = render({
    agentId,
    messages: [
      { id: "m1", content: "earlier beside the first\n\nCurrent page: Dashboards (/applications/app-a/tasks)；Selected: e2e board card" },
    ],
  });
  await settle();

  expect(sessionId.value).toBe(createdSessionId);
  await shell.value!.send("write about this one");
  await settle();
  expect(sent[0]).toBe(
    "write about this one\n\nCurrent page: Dashboards (/dashboards?dashboardId=board-a)；Selected: e2e board card",
  );
});

it("shows the agent the opened conversation runs on, and writes in it", async () => {
  // The address names the conversation and no agent: the composer shows the agent it runs on, not the one this tab used.
  const governanceAgent = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const { sent, sessionId, shell, shownAgent } = render({ agentId: governanceAgent, messages: [] });
  await settle();

  expect(shownAgent.value).toBe(governanceAgent);
  expect(sessionId.value).toBe(createdSessionId);
  await shell.value!.send("into the opened conversation");
  await settle();
  // The message goes into the conversation that was opened, as its own agent.
  expect(sessionId.value).toBe(createdSessionId);
  expect(sent).toHaveLength(1);
});
