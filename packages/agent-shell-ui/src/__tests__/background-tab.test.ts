import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import type { AgentHostSessionHistory } from "@ontomato/contracts/agent-host";
import AgentShell from "../components/AgentShell.vue";
import { createAgentHostClient } from "../host";
import { useAgentNav } from "../useAgentNav";
import { useSessionRunFeed } from "../useSessionRunFeed";
import type { ShellLabels, ShellWorkbenchDeclaration } from "../types";
import { testDisplay } from "./display";

/*
 * A background tab holds no long connection (design "long connections" 2). The real shell over the real host client,
 * with only the network stood in for: hidden, the page's notice stream, the open run's stream and the task stream are
 * closed and nothing reopens them — not a late frame, not a dropped line; the run is not cancelled. Visible again, the
 * notice stream reconnects, the conversation reads what it missed from its cursor and follows the run that is live now,
 * which may be another round than the one it was following, and the task stream reopens.
 */
const session = "11111111-1111-4111-8111-111111111111";
const first = "22222222-2222-4222-8222-222222222222";
const second = "33333333-3333-4333-8333-333333333333";
const stream = "44444444-4444-4444-8444-444444444444";
const at = new Date(0).toISOString();
const workbench: ShellWorkbenchDeclaration = { id: "agents", label: "Agents", features: [] };
/** Every label is its own name, called or shown. */
const labels = new Proxy({}, {
  get: (_target, key) => (typeof key === "string" ? Object.assign(() => key, { toString: () => key }) : undefined),
}) as unknown as ShellLabels;

const runView = (id: string, status: "running" | "stopped" = "running") => ({
  id, sessionId: session, status, stopReason: status === "stopped" ? ("stop" as const) : null, errorMessage: null, answerMessageId: null,
  workspaceCommit: null, createdAt: at, finishedAt: null, resolvedSkills: [], executionUserId: null,
});
/** The conversation's history from `seq` on, with `run` as its latest round. */
function history(run: string, seq: number, status: "running" | "stopped" = "running"): AgentHostSessionHistory {
  return {
    session: {
      id: session, agentId: "55555555-5555-4555-8555-555555555555", title: "", createdAt: at, updatedAt: at,
      latestRun: { id: run, status, stopReason: runView(run, status).stopReason },
    },
    messages: [],
    pendingQuestions: [],
    runs: [runView(run, status)],
    latestRun: {
      run: runView(run, status), cursor: { runId: run, seq, streamId: stream }, messages: [], pendingQuestions: [],
      pendingMessages: [], toolExecutions: [], artifacts: [],
    },
    page: { olderCursor: null, nextCursor: null, throughCursor: `${session}:${seq}`, messageSeq: seq },
  };
}

/** The host as the network answers it: every request it saw, and the streams it holds open. */
function network(latest: () => { run: string; status?: "running" | "stopped" }) {
  const requests: { path: string; signal?: AbortSignal | null }[] = [];
  const open: { path: string; signal: AbortSignal; push(data: unknown): void; fail(): void }[] = [];
  const request = vi.fn(async (path: string, init: RequestInit) => {
    requests.push({ path, signal: init.signal });
    if (path.startsWith("/sessions/run-events") || path.includes("/events")) {
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({ start: (value) => (controller = value) });
      const entry = {
        path,
        signal: init.signal!,
        push: (data: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)),
        fail: () => controller.error(new Error("dropped")),
      };
      open.push(entry);
      if (path.startsWith("/sessions/run-events")) queueMicrotask(() => entry.push({ type: "ready" }));
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (path.startsWith(`/sessions/${session}/history`)) return Response.json(history(latest().run, 5, latest().status));
    if (path === "/sessions/status") return Response.json({ sessions: [] });
    if (path.startsWith("/sessions?")) return Response.json({ sessions: [], nextCursor: null });
    if (path === "/agents") return Response.json({ agents: [] });
    throw new Error(`Nothing at ${path}`);
  });
  const live = () => open.filter((entry) => !entry.signal.aborted).map((entry) => entry.path.split("?")[0]).sort();
  return { request, requests, open, live };
}

function report(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}
async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
  report("visible");
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** The agent platform's page as it holds a conversation: its notice feed, and the shell open on the conversation. */
async function mountConversation(host: ReturnType<typeof network>) {
  const client = createAgentHostClient({ request: host.request, tasks: true });
  const Host = defineComponent({
    setup() {
      const nav = useAgentNav({ client: () => client, agentId: () => null, setAgentId: () => {}, sessionId: () => session, setSessionId: () => {} });
      useSessionRunFeed({ port: client.sessionRuns, sessions: () => nav.sessions.value, onError: (error) => { throw error; } });
      return () => h(AgentShell, { workbench, display: testDisplay(workbench), client, labels, nav, sessionId: session });
    },
  });
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(Host);
  app.mount(root);
  await settle();
}

it("closes every stream of a hidden tab, opens none while hidden, and follows what is live when it is back", async () => {
  let latest = { run: first };
  const host = network(() => latest);
  await mountConversation(host);
  expect(host.live()).toEqual([`/sessions/${session}/runs/${first}/events`, `/sessions/${session}/tasks/events`, "/sessions/run-events"].sort());

  report("hidden");
  await settle();
  expect(host.live()).toEqual([]);
  const opened = host.open.length;
  // What the closed streams still deliver, or how they fail, opens nothing while the tab is hidden; no reconnect is due.
  vi.useFakeTimers();
  for (const entry of host.open) entry.fail();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  await settle();
  expect(host.open).toHaveLength(opened);
  // The run went on: nothing asked the host to cancel it.
  expect(host.requests.some((entry) => entry.path.endsWith("/cancel"))).toBe(false);

  // Meanwhile another round started. Back in the foreground the conversation reads from its cursor and follows it.
  latest = { run: second };
  report("visible");
  await settle();
  expect(host.requests.some((entry) => entry.path.startsWith(`/sessions/${session}/history?after=${encodeURIComponent(`${session}:5`)}`))).toBe(true);
  expect(host.live()).toEqual([`/sessions/${session}/runs/${second}/events`, `/sessions/${session}/tasks/events`, "/sessions/run-events"].sort());
});

it("follows a round that started while the tab was hidden, when no run was live as it went", async () => {
  let latest: { run: string; status?: "running" | "stopped" } = { run: first, status: "stopped" };
  const host = network(() => latest);
  await mountConversation(host);
  expect(host.live()).toEqual([`/sessions/${session}/tasks/events`, "/sessions/run-events"].sort());

  report("hidden");
  await settle();
  expect(host.live()).toEqual([]);
  // A notification woke the conversation meanwhile; its lifecycle notice went to no stream.
  latest = { run: second };
  report("visible");
  await settle();
  expect(host.live()).toEqual([`/sessions/${session}/runs/${second}/events`, `/sessions/${session}/tasks/events`, "/sessions/run-events"].sort());
});
