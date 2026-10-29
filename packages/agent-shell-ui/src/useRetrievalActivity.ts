import { onBeforeUnmount, shallowReactive } from "vue";
import type { RetrievalSnapshot } from "@ontomato/contracts/data-retrieval";
import type { RetrievalLink } from "./conversation";

const POLL_INTERVAL_MS = 1000;

export interface RetrievalState {
  /** Latest snapshot, or null before the first response. */
  snapshot: RetrievalSnapshot | null;
  error: boolean;
}

/**
 * Polls one retrieval snapshot while its run is active. Stops automatically when the run ends
 * (status !== "running") or when `stop()` is called. The retrieval ID is the stable key across
 * continuations and is used as the fold state key by the caller.
 */
export function useRetrievalActivity(
  read: (retrievalId: string) => Promise<RetrievalSnapshot>,
  retrievalId: string,
  runActive: () => boolean,
) {
  const state = shallowReactive<RetrievalState>({ snapshot: null, error: false });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function poll() {
    if (stopped) return;
    try {
      const snapshot = await read(retrievalId);
      if (stopped) return;
      state.snapshot = snapshot;
      state.error = false;
      const done = !runActive() || snapshot.run?.status === "stopped";
      if (!done) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    } catch {
      if (!stopped) {
        state.error = true;
        // Keep trying while the run is active; the run may have just started.
        if (runActive()) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    }
  }

  function stop() {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Start immediately.
  void poll();

  onBeforeUnmount(stop);

  return { state, stop };
}
