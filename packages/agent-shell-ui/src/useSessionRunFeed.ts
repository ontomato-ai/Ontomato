import { onBeforeUnmount, onMounted, watch } from "vue";
import type {
  AgentHostSession,
  AgentHostSessionRunFrame,
  AgentHostSessionRunSnapshot,
} from "@ontomato/contracts/agent-host";
import { SessionRunStreamError, type SessionRunPort } from "./host";
import { RECONNECT_DELAYS } from "./run-subscription";

export interface SessionRunFeedOptions {
  /** The host's passive notice port of the same prefix every list on this page reads from. */
  port: SessionRunPort;
  /** Every loaded row of the page's lists; a change of members or of row objects reads their state again. */
  sessions(): readonly AgentHostSession[];
  /** Every frame, also for a conversation no list shows, so the page can refresh its own facts. */
  onNotice?(frame: AgentHostSessionRunFrame): void;
  onError(error: unknown): void;
}

/**
 * The page's one list notice feed: a single user-level stream, and the light state reads it triggers on the rows the
 * page already has. Hosts call it once per page and hand it every list they show, so switching agent, workspace or a
 * page's expanded lists changes the rows read, never the connection. A notice only says that something changed; the
 * state itself comes from the snapshot, and a conversation no list shows is not added.
 */
export function useSessionRunFeed(options: SessionRunFeedOptions) {
  const ids = () => [...new Set(options.sessions().map((row) => row.id))];
  let detach: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  /** The stream ended for good, or the page went away: no frame, read or reconnect after it. */
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  /** Writes a light snapshot into the rows still listed; a conversation that left meanwhile is not touched. */
  function apply(snapshot: AgentHostSessionRunSnapshot) {
    const latest = new Map(snapshot.sessions.map((status) => [status.sessionId, status.latestRun]));
    for (const row of options.sessions()) {
      if (latest.has(row.id)) row.latestRun = latest.get(row.id)!;
    }
  }

  /**
   * Reads these conversations' current state after every read already queued, so a late answer cannot overwrite a newer
   * one. Writing a row's run state does not change the row collection, so it triggers no further read.
   */
  function read(sessionIds: string[]) {
    if (sessionIds.length === 0) return queue;
    queue = queue
      .then(async () => {
        if (stopped) return;
        apply(await options.port.read(sessionIds));
      })
      .catch(options.onError);
    return queue;
  }

  function connect() {
    detach = options.port.subscribe({
      async frame(frame) {
        if (stopped) return;
        options.onNotice?.(frame);
        // `ready` is the runtime's barrier: every change from here on is a frame, so the rows are read once now.
        if (frame.type === "ready") {
          attempt = 0;
          await read(ids());
          return;
        }
        if (options.sessions().some((row) => row.id === frame.sessionId)) await read([frame.sessionId]);
      },
      error(error) {
        if (stopped) return;
        detach = null;
        // A frame off the contract is not a dropped line: present it and stop.
        if (error instanceof SessionRunStreamError) {
          stopped = true;
          options.onError(error);
          return;
        }
        // Anything else — a stream that could not be opened, a line that dropped, a host error — is opened again, and
        // its `ready` reads every row.
        timer = setTimeout(() => {
          timer = null;
          if (!stopped) connect();
        }, RECONNECT_DELAYS[Math.min(attempt++, RECONNECT_DELAYS.length - 1)]);
      },
    });
  }

  // A page of the list, a conversation just promoted, a re-read, a workspace hand-over, or a row object swapped
  // where it stands changes what is listed; writing a row's own run state does not.
  watch(() => options.sessions().slice(), () => void read(ids()));

  onMounted(connect);
  onBeforeUnmount(() => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    detach?.();
    detach = null;
  });
}
