import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, shallowRef, type App } from "vue";
import AgentShell from "../components/AgentShell.vue";
import type { AgentHostClient } from "../host";
import { useAgentNav, type AgentNav } from "../useAgentNav";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

const workbench: ShellWorkbenchDeclaration = { id: "builder", label: "Builder", features: [] };
const labels = { placeholder: "Message", send: "Send", stop: "Stop" } as unknown as ShellLabels;
const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const createdSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** A conversation the reader already has, opened while a message is on its way. */
const otherSessionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const other = { id: otherSessionId, agentId, title: "Earlier", origin: "user", createdAt: new Date(0).toISOString(), latestRun: null };
const created = { id: createdSessionId, agentId, title: "", origin: "user", createdAt: new Date(0).toISOString(), latestRun: null };
const admitted = {
  run: {
    id: runId, sessionId: createdSessionId, status: "running", stopReason: null, errorMessage: null, workspaceCommit: null,
    createdAt: new Date(0).toISOString(), finishedAt: null, resolvedSkills: [],
  },
  cursor: { runId, seq: 1, streamId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
  messages: [], pendingMessages: [], toolExecutions: [], artifacts: [],
};

/** One host context: the app builder makes one of these per workspace. */
function port(startRun: () => Promise<unknown>) {
  return {
    listAgents: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [], nextCursor: null }),
    createSession: vi.fn().mockResolvedValue(created),
    startRun: vi.fn(startRun),
    subscribe: () => () => {},
    // A conversation opened meanwhile is still loading when the message returns.
    readHistory: vi.fn(() => new Promise(() => {})),
  } as unknown as AgentHostClient;
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

/** The app builder's arrangement: one shell whose `client` changes with the workspace, the host owning the session. */
function render(first: AgentHostClient) {
  const client = shallowRef(first);
  const sessionId = ref<string | null>(null);
  const shell = ref<{ send(text: string): Promise<void> } | null>(null);
  let nav!: AgentNav;
  const Host = defineComponent({
    setup() {
      nav = useAgentNav({
        client: () => client.value,
        agentId: () => agentId,
        setAgentId: () => {},
        sessionId: () => sessionId.value,
        setSessionId: (id) => (sessionId.value = id),
      });
      return () =>
        h(
          AgentShell,
          {
            ref: shell,
            workbench,
            client: client.value,
            labels,
            nav,
            agentId,
            sessionId: sessionId.value,
            "onUpdate:sessionId": (id: string | null) => (sessionId.value = id),
          },
          { "composer-context": ({ unstarted }: { unstarted: boolean }) => h("span", { class: "unstarted" }, String(unstarted)) },
        );
    },
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp(Host);
  app.mount(root);
  return { root, client, sessionId, shell, nav: () => nav };
}

it("hands the host a conversation it created even when the run was refused, and marks that conversation when sent again", async () => {
  let admit!: (snapshot: unknown) => void;
  const host = port(() => Promise.reject(new Error("Workspace busy")));
  (host.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [created, other], nextCursor: null });
  const { root, sessionId, shell, nav } = render(host);
  await settle();

  await shell.value!.send("hello");
  await settle();

  expect(sessionId.value).toBe(createdSessionId);
  expect(host.listSessions).toHaveBeenCalledTimes(1);
  expect(root.textContent).toContain("Workspace busy");

  // Sent again, and the reader opens another conversation before the run is admitted: the run marks its own
  // conversation, which takes the message as its title, and leaves the open one alone.
  (host.startRun as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise((resolve) => (admit = resolve)));
  const sent = shell.value!.send("hello");
  await settle();
  sessionId.value = otherSessionId;
  await settle();
  admit(admitted);
  await sent;
  await settle();

  expect(nav().sessions.value.map((session) => [session.id, session.title, session.latestRun?.id ?? null])).toEqual([
    [createdSessionId, "hello", runId],
    [otherSessionId, "Earlier", null],
  ]);
});

it("lists a first message's conversation but leaves the reader in the conversation they opened meanwhile", async () => {
  let admit!: (snapshot: unknown) => void;
  const host = port(() => new Promise((resolve) => (admit = resolve)));
  (host.listSessions as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [other], nextCursor: null });
  const { sessionId, shell, nav } = render(host);
  await nav().loadSessions();
  await settle();

  const sent = shell.value!.send("hello");
  await settle();
  sessionId.value = otherSessionId;
  await settle();
  admit(admitted);
  await sent;
  await settle();

  expect(sessionId.value).toBe(otherSessionId);
  expect(nav().sessions.value.map((session) => [session.id, session.latestRun?.id ?? null])).toEqual([
    [createdSessionId, runId],
    [otherSessionId, null],
  ]);
});

it("drops a first message on its way as soon as the host moves to another context, and ignores its return", async () => {
  let admit!: (snapshot: unknown) => void;
  const a = port(() => new Promise((resolve) => (admit = resolve)));
  const b = port(() => Promise.resolve(admitted));
  const { root, client, sessionId, shell } = render(a);
  await settle();

  const sent = shell.value!.send("for workspace A");
  await settle();
  client.value = b;
  await settle();

  // Before A's send returns, the shell is already B's blank conversation.
  expect(root.querySelector(".unstarted")!.textContent).toBe("true");
  expect(root.textContent).not.toContain("for workspace A");

  admit(admitted);
  await sent;
  await settle();

  expect(sessionId.value).toBeNull();
  expect(root.querySelector(".unstarted")!.textContent).toBe("true");
  expect(root.textContent).not.toContain("for workspace A");
});
