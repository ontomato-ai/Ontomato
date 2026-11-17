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
  pageContext: (page: string) => `Current page: ${page}`,
  selectionContext: (selection: string) => `Selected: ${selection}`,
} as unknown as ShellLabels;

const page: PageContext = {
  pageKey: "dashboard",
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

/** The shell beside a page, over a host that creates the conversation on its first message and admits every run. */
function render() {
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
      pendingQuestions: [], session: created, messages: [], runs: [], latestRun: null, page: { messageSeq: 0, olderCursor: null },
    }),
  } as unknown as AgentHostClient;
  const sessionId = ref<string | null>(null);
  const shell = ref<{ send(text: string): Promise<void> } | null>(null);
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client: () => client, agentId: () => agentId, setAgentId: () => {},
        sessionId: () => sessionId.value, setSessionId: (id) => (sessionId.value = id),
      });
      return () => h(AgentShell, {
        ref: shell, workbench, client, labels, nav, agentId,
        featureId: "dashboards", pageContext: page,
        sessionId: sessionId.value, "onUpdate:sessionId": (id: string | null) => (sessionId.value = id),
      });
    },
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp(Host);
  app.mount(root);
  return { sent, sessionId, shell };
}

it("names the page on the conversation's first message, and only the selection after it", async () => {
  const { sent, sessionId, shell } = render();
  await settle();

  await shell.value!.send("first on this board");
  await settle();
  // The conversation this send created is where the page went; linking it is not the reader moving elsewhere.
  expect(sessionId.value).toBe(createdSessionId);
  expect(sent[0]).toBe("first on this board\n\nCurrent page: Dashboards；Selected: e2e board card");

  await shell.value!.send("second on the same board");
  await settle();
  expect(sent[1]).toBe("second on the same board\n\nSelected: e2e board card");
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
  expect(sent[1]).toBe("in a new conversation\n\nCurrent page: Dashboards；Selected: e2e board card");
});
