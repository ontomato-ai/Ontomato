import { computed, onBeforeUnmount, reactive, shallowReactive } from "vue";
import type { RetrievalSnapshot } from "@ontomato/contracts/data-retrieval";
import { applyEnvelope, applyRunSnapshot, emptyConversation } from "./conversation";
import { createRunSubscription, type RunSubscription } from "./run-subscription";

const POLL_INTERVAL_MS = 1000;

export interface RetrievalState {
  snapshot: RetrievalSnapshot | null;
  error: boolean;
}

interface RetrievalSource {
  runId: string;
  read(): Promise<RetrievalSnapshot>;
  readRun: RunSubscription["read"];
  subscribe: RunSubscription["subscribe"];
}

/** Business state is polled until delivery; activity uses the child's independent event stream. */
export function useRetrievalActivity(source: () => RetrievalSource) {
  const state = shallowReactive<RetrievalState>({ snapshot: null, error: false });
  const conversation = reactive(emptyConversation());
  const stream = createRunSubscription();
  const run = computed(() => conversation.runs[source().runId]);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  function stop() {
    generation++;
    stream.stop();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function restart() {
    stop();
    state.snapshot = null;
    state.error = false;
    Object.assign(conversation, emptyConversation());
    const current = generation;
    const selected = source();
    let subscribed = false;

    async function poll() {
      try {
        const snapshot = await selected.read();
        if (current !== generation) return;
        state.snapshot = snapshot;
        state.error = false;
        // Admission can lag the association. Once admitted, only recovery re-reads messages.
        if (!subscribed && snapshot.runtimeRunId) {
          subscribed = true;
          void stream.load({
            runId: selected.runId,
            current: () => conversation.runs[selected.runId],
            read: selected.readRun,
            snapshot: (value) => applyRunSnapshot(conversation, value),
            event: (envelope) => { applyEnvelope(conversation, envelope); },
            subscribe: selected.subscribe,
          });
        }
        if (!snapshot.retrieverPending && !snapshot.bindingPending) return;
      } catch {
        if (current !== generation) return;
        state.error = true;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    void poll();
  }

  restart();
  onBeforeUnmount(stop);
  return { state, run, stop, restart };
}
