import type { AgentHostRunSnapshot } from "@ontomato/contracts/agent-host";
import type { RuntimeEventEnvelope, RuntimeStreamFrame } from "@ontomato/contracts/agent-runtime-events";
import { sseReconnectDelay } from "@ontomato/contracts/sse";
import { documentVisible, onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import type { RunView } from "./conversation";
import type { HostStreamHandlers } from "./host";

const MAX_QUEUED_FRAMES = 2000;

export interface RunSubscription<T = AgentHostRunSnapshot> {
  runId: string;
  current(): RunView | undefined;
  read(): Promise<T>;
  snapshot(snapshot: T): void;
  event(envelope: RuntimeEventEnvelope): void;
  subscribe(after: { seq: number; streamId: string }, handlers: HostStreamHandlers): () => void;
}

/**
 * One run's snapshot/cursor recovery and batched event delivery, shared by both shell views.
 *
 * A background tab holds no stream (design "long connections" 2): while the document is hidden the stream is closed and
 * no reconnect is scheduled, but the run it follows, its cursor and what it already applied stay. Nothing a late
 * callback or a new attachment does while hidden opens one. Back in the foreground the run is read again from its own
 * snapshot or cursor — it may have ended, or another round may have started, meanwhile — and only then followed live.
 * Hiding only stops watching; it never cancels the run.
 */
export function createRunSubscription<T = AgentHostRunSnapshot>() {
  let target: RunSubscription<T> | null = null;
  let stopFollowing: (() => void) | null = null;
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
    stopFollowing?.();
    stopFollowing = null;
  }

  /** Follows the tab's visibility for as long as there is a run to follow. */
  function follow(next: RunSubscription<T>) {
    stop();
    target = next;
    stopFollowing = onDocumentVisibility((visible) => (visible ? void refresh(0) : disconnect()));
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
    if (!documentVisible()) return;
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
    if (!documentVisible()) return;
    const current = generation;
    const delay = sseReconnectDelay(attempt);
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
      follow(next);
      connect(0);
    },
    /** Read a snapshot before attaching, including on initial activity load. */
    load(next: RunSubscription<T>) {
      follow(next);
      return refresh(0);
    },
    /** Whether a run is being followed (live, or paused while the tab is hidden). */
    following: () => target !== null,
    stop,
  };
}
