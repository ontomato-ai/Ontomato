import { onBeforeUnmount, onMounted, watch, provide, shallowRef, readonly } from "vue";
import { pageSessionStream, sessionRunNotices, type SessionStreamShell } from "./session-run-notices";
import { randomId } from "@ontomato/contracts/random-id";
import type { PresentationBinding, PresentationFrame, PresentationReceipt } from "@ontomato/contracts/agent-presentation";
import type {
  AgentHostSession,
  AgentHostSessionLiveFrame,
  AgentHostSessionRunFrame,
  AgentHostSessionRunSnapshot,
} from "@ontomato/contracts/agent-host";
import { SessionRunStreamError, type SessionRunPort } from "./host";
import { sseReconnectDelay } from "@ontomato/contracts/sse";
import { documentVisible, onDocumentVisibility } from "@ontomato/foundation-ui/visibility";

export interface SessionRunFeedOptions {
  /** The host's passive notice port of the same prefix every list on this page reads from. */
  port: SessionRunPort;
  /** Every loaded row of the page's lists; a change of members or of row objects reads their state again. */
  sessions(): readonly AgentHostSession[];
  /** Every frame, also for a conversation no list shows, so the page can refresh its own facts. */
  onNotice?(frame: AgentHostSessionRunFrame): void;
  /**
   * The page shows a conversation shell with a display: the stream serves this page view, the runs the shell starts carry
   * the view's binding, and the view's live frames — presentation requests, objects agents changed — go to that shell,
   * never to `onNotice`.
   */
  presentation?: boolean;
  onError(error: unknown): void;
}

/**
 * The page's one list notice feed: a single user-level stream, and the light state reads it triggers on the rows the
 * page already has. Hosts call it once per page and hand it every list they show, so switching agent, workspace or a
 * page's expanded lists changes the rows read, never the connection. A notice only says that something changed; the
 * state itself comes from the snapshot, and a conversation no list shows is not added.
 *
 * A background tab holds no stream (design "long connections" 2): hidden, the feed closes its connection, schedules no
 * reconnect and drops the connection's display binding; back in the foreground it opens a new one, whose `ready` reads the
 * listed rows again. Lifecycle notices are not replayed, so what changed meanwhile is what that read reports.
 */
export function useSessionRunFeed(options: SessionRunFeedOptions) {
  const notice = shallowRef<AgentHostSessionRunFrame | null>(null);
  provide(sessionRunNotices, readonly(notice));
  const ids = () => [...new Set(options.sessions().map((row) => row.id))];
  let detach: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Which connection is current: a frame or failure of one closed since is not this feed's any more. */
  let generation = 0;
  let attempt = 0;
  /** The stream ended for good, or the page went away: no frame, read or reconnect after it. */
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();
  /**
   * The page view this feed serves when the page shows a conversation display: one ID, made here in memory, for as long
   * as the view is mounted — hidden and reconnected it stays, a reload or another window is another view. It is never
   * written to the address or to storage.
   */
  const view: PresentationBinding | null = options.presentation ? { viewId: randomId() } : null;
  /** The connection now serving the view, once ready; a request is answered on the connection it came on. */
  let connection: string | null = null;
  let shell: SessionStreamShell | null = null;
  if (view) {
    provide(pageSessionStream, {
      binding: view,
      attach(next) {
        shell = next;
        return () => {
          if (shell === next) shell = null;
        };
      },
    });
  }

  /**
   * One request, one answer. The shell checks it still shows the conversation and lets its display decide; with no
   * shell on the page there is no conversation in view. An answer for a connection that has since closed is not sent:
   * the host already settled that call as unknown, and an answer never goes to the connection that replaced it.
   */
  async function answer(frame: PresentationFrame, own: string) {
    const result: PresentationReceipt["result"] = shell
      ? await shell.present(frame)
      : { status: "not_opened", reason: "not_viewing_session", current: { known: false, reason: "not_viewing_session" } };
    if (stopped || connection !== own) return;
    await options.port
      .presentationResult(frame.sessionId, frame.runId, { connectionId: own, toolCallId: frame.toolCallId, result })
      .catch(options.onError);
  }

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

  function disconnect() {
    generation++;
    detach?.();
    detach = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    // A request that came on this connection is not answered on the next one.
    connection = null;
  }

  function connect() {
    if (stopped || !documentVisible()) return;
    const current = ++generation;
    detach = options.port.subscribe({
      async frame(frame) {
        if (stopped || current !== generation) return;
        notice.value = frame;
        options.onNotice?.(frame);
        // `ready` is the runtime's barrier: every change from here on is a frame, so the rows are read once now.
        if (frame.type === "ready") {
          attempt = 0;
          if ("connectionId" in frame) {
            connection = frame.connectionId;
            // What agents changed while no connection served the view reached nobody: the display reads its objects again.
            shell?.ready();
          }
          await read(ids());
          return;
        }
        if (options.sessions().some((row) => row.id === frame.sessionId)) await read([frame.sessionId]);
      },
      // The view's live frames: a request to show something, an object an agent changed. Neither is a lifecycle notice.
      ...(view
        ? {
            view: {
              id: view.viewId,
              frame(live: AgentHostSessionLiveFrame) {
                if (stopped || current !== generation) return;
                if (live.type === "presentation") void answer(live, connection!);
                else shell?.objectChanged(live);
              },
            },
          }
        : {}),
      error(error) {
        if (stopped || current !== generation) return;
        detach = null;
        connection = null;
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
          connect();
        }, sseReconnectDelay(attempt++));
      },
    });
  }

  // A page of the list, a conversation just promoted, a re-read, a workspace hand-over, or a row object swapped
  // where it stands changes what is listed; writing a row's own run state does not.
  watch(() => options.sessions().slice(), () => void read(ids()));

  onMounted(connect);
  const stopVisibility = onDocumentVisibility((visible) => (visible ? connect() : disconnect()));
  onBeforeUnmount(() => {
    stopped = true;
    disconnect();
    stopVisibility();
  });
}
