import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, shallowRef, type App } from "vue";
import AgentShell from "../components/AgentShell.vue";
import type { AgentHostClient } from "../host";
import { useAgentNav } from "../useAgentNav";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

const workbench: ShellWorkbenchDeclaration = { id: "builder", label: "Builder", features: [] };
const labels = { placeholder: "Message", send: "Send", stop: "Stop" } as unknown as ShellLabels;
const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const createdSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
    readHistory: vi.fn(),
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
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
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
  return { root, client, sessionId, shell };
}

it("hands the host a conversation it created even when the run was refused", async () => {
  const host = port(() => Promise.reject(new Error("Workspace busy")));
  const { root, sessionId, shell } = render(host);
  await settle();

  await shell.value!.send("hello");
  await settle();

  expect(sessionId.value).toBe(createdSessionId);
  expect(host.listSessions).toHaveBeenCalledTimes(1);
  expect(root.textContent).toContain("Workspace busy");
});

it("drops a first message's conversation once the host has moved to another context, keeping the new draft", async () => {
  let admit!: (snapshot: unknown) => void;
  const a = port(() => new Promise((resolve) => (admit = resolve)));
  const b = port(() => Promise.resolve(admitted));
  const { root, client, sessionId, shell } = render(a);
  await settle();

  const sent = shell.value!.send("for workspace A");
  await settle();
  client.value = b;
  await settle();
  const composer = root.querySelector<HTMLTextAreaElement>("textarea")!;
  composer.value = "draft for B";
  composer.dispatchEvent(new Event("input"));
  admit(admitted);
  await sent;
  await settle();

  expect(sessionId.value).toBeNull();
  expect(root.querySelector(".unstarted")!.textContent).toBe("true");
  expect(root.textContent).not.toContain("for workspace A");
  expect(composer.value).toBe("draft for B");
});
