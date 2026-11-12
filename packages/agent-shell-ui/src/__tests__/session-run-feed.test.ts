import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import type { AgentHostSession, AgentHostSessionRunFrame, AgentHostSessionRunSnapshot } from "@ontomato/contracts/agent-host";
import { SessionRunStreamError, type SessionRunHandlers, type SessionRunPort } from "../host";
import { useSessionRunFeed } from "../useSessionRunFeed";

/*
 * The page's one list notice feed: one stream for every list the page shows, the light read it triggers on the rows
 * already loaded, and the rule that writing a row's run state never starts another read.
 */

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const c = "33333333-3333-4333-8333-333333333333";
const runId = "99999999-9999-4999-8999-999999999999";
const runOf = (status: "running" | "stopped" = "running") => ({ id: runId, status, stopReason: null });
const row = (id: string, latestRun: AgentHostSession["latestRun"] = null): AgentHostSession => ({
  id, agentId: a, title: id, origin: "user", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), latestRun,
});

/** A port whose reads resolve when the test says so, so a late snapshot can be applied deliberately. */
function port() {
  const handlers = ref<SessionRunHandlers | null>(null);
  const reads: { ids: string[]; resolve(snapshot: AgentHostSessionRunSnapshot): void }[] = [];
  const snapshot = (ids: string[], status: "running" | "stopped" = "running"): AgentHostSessionRunSnapshot => ({
    sessions: ids.map((id) => ({ sessionId: id, latestRun: runOf(status) })),
  });
  const read = vi.fn(
    (ids: string[]) => new Promise<AgentHostSessionRunSnapshot>((resolve) => reads.push({ ids, resolve })),
  );
  const subscribe = vi.fn((next: SessionRunHandlers) => {
    handlers.value = next;
    return () => {
      handlers.value = null;
    };
  });
  return { port: { read, subscribe } as SessionRunPort, read, subscribe, reads, handlers, snapshot };
}

let app: App | null = null;
afterEach(() => {
  app?.unmount();
  app = null;
});

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Mounts a page that keeps its rows and hands them to one feed. */
function page(host: ReturnType<typeof port>, onNotice = vi.fn(), onError = vi.fn()) {
  const sessions = ref<AgentHostSession[]>([row(a), row(b, runOf())]);
  const Host = defineComponent({
    setup() {
      useSessionRunFeed({ port: host.port, sessions: () => sessions.value, onNotice, onError });
      return () => h("div");
    },
  });
  const root = document.createElement("div");
  document.body.appendChild(root);
  app = createApp(Host);
  app.mount(root);
  return { sessions, onNotice, onError };
}

/** Delivers a frame and lets the read it queues start. */
async function dispatch(host: ReturnType<typeof port>, frame: AgentHostSessionRunFrame) {
  void host.handlers.value!.frame(frame);
  await settle();
}

describe("the page's one list feed", () => {
  it("opens one stream and reads every loaded row once it is ready", async () => {
    const host = port();
    const { sessions } = page(host);
    await settle();

    expect(host.subscribe).toHaveBeenCalledTimes(1);
    expect(host.read).not.toHaveBeenCalled();

    await dispatch(host, { type: "ready" });

    // Both rows change, one read: the answer is one snapshot of the whole page.
    expect(host.read).toHaveBeenCalledTimes(1);
    expect(host.read.mock.calls[0][0]).toEqual([a, b]);
    host.reads.shift()!.resolve(host.snapshot([a, b]));
    await settle();

    expect(sessions.value.map((entry) => entry.latestRun?.status)).toEqual(["running", "running"]);
  });

  it("reads only the listed conversation of a notice, and applies it to that row alone", async () => {
    const host = port();
    const { sessions } = page(host);
    await settle();
    await dispatch(host, { type: "ready" });
    host.reads.shift()!.resolve(host.snapshot([a, b], "stopped"));
    await settle();
    sessions.value[0]!.latestRun = null;

    await dispatch(host, { type: "run_started", sessionId: a, runId });

    expect(host.read).toHaveBeenCalledTimes(2);
    expect(host.read.mock.calls[1][0]).toEqual([a]);
    host.reads.shift()!.resolve(host.snapshot([a]));
    await settle();

    expect(sessions.value.map((entry) => entry.latestRun?.status ?? null)).toEqual(["running", "stopped"]);
  });

  it("hands the page a notice for a conversation no list shows, without reading or inserting it", async () => {
    const host = port();
    const { sessions, onNotice } = page(host);
    await settle();

    await dispatch(host, { type: "run_stopped", sessionId: c, runId });

    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(host.read).not.toHaveBeenCalled();
    expect(sessions.value.map((entry) => entry.id)).toEqual([a, b]);
  });

  it("reads the rows again when the list changes page or order, and not when a row's run state is written", async () => {
    const host = port();
    const { sessions } = page(host);
    await settle();
    await dispatch(host, { type: "ready" });
    host.reads.shift()!.resolve(host.snapshot([a, b]));
    await settle();

    // The feed's own write into a row must not start another read.
    sessions.value[0]!.latestRun = runOf("stopped");
    await settle();
    expect(host.read).toHaveBeenCalledTimes(1);

    // Another page arrives, and a locally created conversation is promoted: both change the rows read.
    sessions.value = [...sessions.value, row(c)];
    await settle();
    expect(host.read).toHaveBeenCalledTimes(2);
    expect(host.read.mock.calls[1][0]).toEqual([a, b, c]);
    host.reads.shift()!.resolve(host.snapshot([a, b, c]));
    await settle();

    sessions.value = [row(c), ...sessions.value.filter((entry) => entry.id !== c)];
    await settle();
    expect(host.read).toHaveBeenCalledTimes(3);
    expect(host.read.mock.calls[2][0]).toEqual([c, a, b]);
    host.reads.shift()!.resolve(host.snapshot([c, a, b]));
    await settle();

    // A row object replaced where it stands is a new row too.
    sessions.value[1] = row(a, runOf("stopped"));
    await settle();
    expect(host.read).toHaveBeenCalledTimes(4);
    host.reads.shift()!.resolve(host.snapshot([c, a, b]));
    await settle();
  });

  it("does not write a late snapshot onto a row that left meanwhile, and never reads twice at once", async () => {
    const host = port();
    const { sessions } = page(host);
    await settle();
    await dispatch(host, { type: "ready" });
    host.reads.shift()!.resolve(host.snapshot([a, b]));
    await settle();

    // The row for `b` goes and `c` arrives while the read for them is still on its way.
    sessions.value = [row(a), row(c)];
    await settle();
    expect(host.read).toHaveBeenCalledTimes(2);
    // A notice for `a` queues behind that read rather than starting another one.
    const stopped = host.handlers.value!.frame({ type: "run_stopped", sessionId: a, runId });
    await settle();
    expect(host.read).toHaveBeenCalledTimes(2);

    host.reads.shift()!.resolve(host.snapshot([a, c], "stopped"));
    await settle();
    expect(host.read).toHaveBeenCalledTimes(3);
    expect(host.read.mock.calls[2][0]).toEqual([a]);
    host.reads.shift()!.resolve(host.snapshot([a], "stopped"));
    await stopped;
    await settle();

    // Only `a` took that answer: `b` had left and `c` was read by the later request.
    expect(sessions.value.map((entry) => [entry.id, entry.latestRun?.status ?? null])).toEqual([
      [a, "stopped"],
      [c, "stopped"],
    ]);
  });

  it("reopens the same stream after a dropped line and reads every row again once it is ready", async () => {
    const host = port();
    const { onError } = page(host);
    await settle();
    await dispatch(host, { type: "ready" });
    host.reads.shift()!.resolve(host.snapshot([a, b]));
    await settle();

    host.handlers.value!.error(new Error("stream closed"));
    expect(onError).not.toHaveBeenCalled();
    expect(host.subscribe).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(host.subscribe).toHaveBeenCalledTimes(2);

    await dispatch(host, { type: "ready" });
    expect(host.read.mock.calls.at(-1)![0]).toEqual([a, b]);
  });

  it("opens the stream again when it could not be opened at all, and reads every row once it is ready", async () => {
    const host = port();
    const { onError } = page(host);
    await settle();

    // A gateway that answers 502 while a container restarts, or any failure before the stream opened, is a line to
    // retry: the notices resume without the reader reloading the page.
    host.handlers.value!.error(Object.assign(new Error("Bad Gateway"), { status: 502 }));
    expect(onError).not.toHaveBeenCalled();
    expect(host.subscribe).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(host.subscribe).toHaveBeenCalledTimes(2);

    await dispatch(host, { type: "ready" });
    expect(host.read.mock.calls.at(-1)![0]).toEqual([a, b]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops on a frame that breaks the contract instead of reconnecting", async () => {
    const host = port();
    const { onError } = page(host);
    await settle();

    host.handlers.value!.error(new SessionRunStreamError("run notice frame broke the contract"));
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(host.subscribe).toHaveBeenCalledTimes(1);
  });

  it("closes the one stream when the page goes away and ignores a frame that arrives as it closes", async () => {
    const host = port();
    page(host);
    await settle();
    const handlers = host.handlers.value!;

    app!.unmount();
    app = null;

    expect(host.handlers.value).toBeNull();
    void handlers.frame({ type: "ready" });
    await settle();
    expect(host.read).not.toHaveBeenCalled();
  });
});
