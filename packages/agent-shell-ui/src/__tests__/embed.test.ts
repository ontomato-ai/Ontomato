/* eslint-disable vue/one-component-per-file -- each test defines the host component that owns the navigation */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, onMounted, ref, type App } from "vue";
import AgentShell from "../components/AgentShell.vue";
import { shellContextKey, type ShellContext } from "../context";
import type { AgentHostClient } from "../host";
import { useAgentNav } from "../useAgentNav";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";

const workbench: ShellWorkbenchDeclaration = {
  id: "business",
  label: "Agent Platform",
  features: [{ id: "dashboards", label: "Dashboards", icon: "dashboard", availability: "page" }],
};

const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const createdSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const streamId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const labels = { placeholder: "Message", send: "Send", stop: "Stop" } as unknown as ShellLabels;

/**
 * A host port that records what the shell asks for, so the test can tell a second read from the first: a single
 * navigation state reads the agents and sessions once, a forked one reads them twice.
 */
function client() {
  const read = { agents: vi.fn(), sessions: vi.fn(), createSession: vi.fn(), startRun: vi.fn() };
  read.agents.mockResolvedValue([
    { id: agentId, name: "assistant", description: "", icon: null, enabled: true },
  ]);
  read.sessions.mockResolvedValue({ sessions: [], nextCursor: null });
  read.createSession.mockResolvedValue({
    id: createdSessionId,
    agentId,
    title: "",
    origin: "user",
    createdAt: new Date(0).toISOString(),
    latestRun: null,
  });
  read.startRun.mockResolvedValue({
    run: {
      id: runId,
      sessionId: createdSessionId,
      status: "running",
      stopReason: null,
      errorMessage: null,
      createdAt: new Date(0).toISOString(),
      finishedAt: null,
      resolvedSkills: [],
      retrievals: [],
    },
    cursor: { runId, seq: 1, streamId },
    messages: [],
    pendingMessages: [],
    toolExecutions: [],
    artifacts: [],
  });
  const port = {
    listAgents: read.agents,
    listSessions: read.sessions,
    createSession: read.createSession,
    startRun: read.startRun,
    subscribe: () => () => {},
    readRun: vi.fn(),
    readHistory: vi.fn(),
    deleteSession: vi.fn(),
    cancel: vi.fn(),
    resolveArtifact: vi.fn(),
    readArtifact: vi.fn(),
    readRetrieval: vi.fn(),
    readRetrievalRun: vi.fn(),
    subscribeRetrieval: vi.fn(),
  } as unknown as AgentHostClient;
  return { port, read };
}

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

/**
 * The platform shell's arrangement: the host owns one navigation state and draws the panel itself, so the panel's list
 * and the conversation read and write the same sessions.
 */
/** Lets the host's mount-time loads (two awaits deep) settle before the test reads the result. */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function renderEmbedded() {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const { port, read } = client();
  const hostAgentId = ref<string | null>(agentId);
  const sessionId = ref<string | null>(null);

  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({
        client: () => port,
        agentId: () => hostAgentId.value,
        setAgentId: (id) => (hostAgentId.value = id),
        sessionId: () => sessionId.value,
        setSessionId: (id) => (sessionId.value = id),
      });
      // Embedded, loading is the host's: the shell draws the column and the conversation from this one state.
      onMounted(async () => {
        await nav.loadAgents().catch(() => {});
        await nav.loadSessions();
      });
      return () => [
        // The host's own read of the same state, beside the shell: one instance, two readers.
        h(
          "ul",
          { class: "panel-sessions" },
          nav.sessions.value.map((session) => h("li", { class: "panel-session" }, session.title)),
        ),
        h(AgentShell, {
          workbench,
          client: port,
          labels,
          nav,
          title: workbench.label,
          "onUpdate:agentId": (id: string | null) => (hostAgentId.value = id),
          agentId: hostAgentId.value,
          "onUpdate:sessionId": (id: string | null) => (sessionId.value = id),
          sessionId: sessionId.value,
        }),
      ];
    },
  });

  app = createApp(Host);
  app.provide(shellContextKey, { labels: ref(labels) } as unknown as ShellContext);
  app.mount(root);
  await settle();
  return { root, read };
}

describe("the conversation application", () => {
  it("draws its own column and the conversation, and no chrome of the platform's", async () => {
    const { root } = await renderEmbedded();
    // The column belongs to the application (DESIGN.md "Applications and shells"): the shell draws it, and the
    // platform draws none of its own.
    expect(root.querySelector(".shell-column")).not.toBeNull();
    expect(root.querySelector(".shell-nav-body")).not.toBeNull();
    expect(root.querySelector(".mobile-bar")).toBeNull();
    expect(root.querySelector(".shell-main")).not.toBeNull();
  });

  it("builds no navigation state of its own: the host's agents and sessions are read once", async () => {
    const { read, root } = await renderEmbedded();
    // Only the host's load runs; a second navigation state inside the shell would read both again and pick an agent
    // a second time. The composer is enabled from the host's single state, which proves that state reached the shell.
    expect(read.agents).toHaveBeenCalledTimes(1);
    expect(read.sessions).toHaveBeenCalledTimes(1);
    expect(root.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(false);
  });

  it("shows a conversation created while sending in the host's panel list", async () => {
    const { root } = await renderEmbedded();
    const input = root.querySelector<HTMLTextAreaElement>("textarea");
    expect(input).not.toBeNull();
    input!.value = "How many orders last month?";
    input!.dispatchEvent(new Event("input"));
    await nextTick();
    root.querySelector<HTMLFormElement>("form.composer")!.dispatchEvent(new Event("submit"));
    await settle();

    const entries = [...root.querySelectorAll(".panel-session")].map((node) => node.textContent);
    expect(entries).toEqual(["How many orders last month?"]);
    // The column reads the same state: the new conversation is listed there too.
    expect([...root.querySelectorAll(".shell-column .session-title")].map((node) => node.textContent)).toEqual([
      "How many orders last month?",
    ]);
  });

});
