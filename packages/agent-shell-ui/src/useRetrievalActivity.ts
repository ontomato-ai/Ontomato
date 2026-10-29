import { onBeforeUnmount, shallowReactive } from "vue";
import type { RetrievalSnapshot } from "@ontomato/contracts/data-retrieval";

const POLL_INTERVAL_MS = 1000;

export interface RetrievalState {
  /** Latest snapshot, or null before the first response. */
  snapshot: RetrievalSnapshot | null;
  error: boolean;
}

/**
 * Polls one retrieval snapshot while its run is active. Stops automatically when the run ends
 * (status !== "running") or when `stop()` is called; `restart()` resumes after a continuation.
 * The retrieval ID is the stable key across continuations and is the caller's fold state key.
 */
export function useRetrievalActivity(
  read: (retrievalId: string) => Promise<RetrievalSnapshot>,
  retrievalId: string,
  runActive: () => boolean,
) {
  const state = shallowReactive<RetrievalState>({ snapshot: null, error: false });
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped by every (re)start and by stop, so a stale in-flight read never schedules again. */
  let generation = 0;

  async function poll(current: number) {
    try {
      const snapshot = await read(retrievalId);
      if (current !== generation) return;
      state.snapshot = snapshot;
      state.error = false;
      const retrieverPending = snapshot.retrieverPending ?? snapshot.run?.status === "running";
      const done = !runActive() || (!retrieverPending && !(snapshot.bindingPending ?? snapshot.bindings?.status === "running"));
      if (!done) timer = setTimeout(() => void poll(current), POLL_INTERVAL_MS);
    } catch {
      if (current !== generation) return;
      state.error = true;
      // Keep trying while the run is active; the run may have just started.
      if (runActive()) timer = setTimeout(() => void poll(current), POLL_INTERVAL_MS);
    }
  }

  function stop() {
    generation++;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Polls again from now, e.g. when a continuation moved the retrieval to a new run. */
  function restart() {
    stop();
    void poll(generation);
  }

  restart();
  onBeforeUnmount(stop);

  return { state, stop, restart };
}
