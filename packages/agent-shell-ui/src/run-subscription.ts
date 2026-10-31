import type { AgentHostRunSnapshot } from "@ontomato/contracts/agent-host";
import type { RuntimeEventEnvelope, RuntimeStreamFrame } from "@ontomato/contracts/agent-runtime-events";
import type { RunView } from "./conversation";
import type { HostStreamHandlers } from "./host";

const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 10000];
const MAX_QUEUED_FRAMES = 2000;

export interface RunSubscription<T = AgentHostRunSnapshot> {
  runId: string;
  current(): RunView | undefined;
  read(): Promise<T>;
  snapshot(snapshot: T): void;
  event(envelope: RuntimeEventEnvelope): void;
  subscribe(after: { seq: number; streamId: string }, handlers: HostStreamHandlers): () => void;
}

/** One run's snapshot/cursor recovery and batched event delivery, shared by both shell views. */
export function createRunSubscription<T = AgentHostRunSnapshot>() {
  let target: RunSubscription<T> | null = null;
  let generation = 0;
  let detach: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: RuntimeStreamFrame[] = [];
  let flushHandle: number | null = null;

  function disconnect() {
    generation++;
    detach?.();
    detach = null;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (flushHandle !== null) cancelAnimationFrame(flushHandle);
    flushHandle = null;
    queue = [];
  }

  function stop() {
    disconnect();
    target = null;
  }

  function flush() {
    flushHandle = null;
    const frames = queue;
    queue = [];
    let ended = false;
    for (const frame of frames) {
      // A required snapshot supersedes the batch; its read is authoritative for everything queued.
      if (frame.type === "snapshot_required") {
        void refresh(0);
        return;
      }
      target!.event(frame.envelope);
      // The run's last frames can share this batch; they still belong to the run just ended.
      if (frame.envelope.event.type === "agent_end") ended = true;
    }
    if (ended) stop();
  }

  function connect(attempt: number) {
    disconnect();
    const run = target!.current();
    if (!run?.cursor || run.status !== "running") return;
    const current = generation;
    detach = target!.subscribe(run.cursor, {
      frame(frame) {
        if (current !== generation) return;
        queue.push(frame);
        if (queue.length > MAX_QUEUED_FRAMES)
          queue = [{ type: "snapshot_required", runId: target!.runId, reason: "buffer_lost" }];
        flushHandle ??= requestAnimationFrame(flush);
      },
      error() {
        if (current !== generation) return;
        disconnect();
        schedule(attempt + 1, connect);
      },
    });
  }

  function schedule(attempt: number, resume: (attempt: number) => void | Promise<void>) {
    const current = generation;
    const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
    reconnectTimer = setTimeout(() => {
      if (current === generation) void resume(attempt);
    }, delay);
  }

  async function refresh(attempt: number) {
    disconnect();
    const current = generation;
    try {
      const snapshot = await target!.read();
      if (current !== generation) return;
      target!.snapshot(snapshot);
      connect(attempt);
    } catch {
      if (current === generation) schedule(attempt + 1, refresh);
    }
  }

  return {
    /** Attach after the caller has already applied an authoritative snapshot. */
    start(next: RunSubscription<T>) {
      stop();
      target = next;
      connect(0);
    },
    /** Read a snapshot before attaching, including on initial activity load. */
    load(next: RunSubscription<T>) {
      stop();
      target = next;
      return refresh(0);
    },
    stop,
  };
}
