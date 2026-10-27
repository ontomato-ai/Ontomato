import { computed, onUnmounted, ref } from "vue";
import {
  governanceStreamEventSchema,
  type GovernanceSession,
  type GovernanceStreamEvent,
  type GovernanceSummary,
  type GovernanceSourceRead,
} from "@ontomato/contracts/knowledge-governance";
import {
  joinAssistantTurns,
  readSseData,
  reduceAgentLiveTail,
  SseProtocolError,
  type AgentLiveTail,
} from "../../utils/agent-chat-stream";
import { governanceApi } from "./api";

const RECONNECT_DELAY_MS = 500;
// Consecutive reconnects without any event before live updates are reported as lost.
const MAX_RECONNECTS = 3;
const idleTail = (): AgentLiveTail => ({ messages: [], status: "idle" });

export function useGovernance() {
  const session = ref<GovernanceSession | null>(null);
  // The running turn, rebuilt from its replayable stream; settled turns live only in `session`.
  const live = ref<AgentLiveTail>(idleTail());
  const rounds = ref<GovernanceSummary[]>([]);
  const loading = ref(false),
    sending = ref(false),
    stopping = ref(false);
  const error = ref("");
  // Live updates for a running round ended without a settled snapshot; only a reload recovers.
  const streamLost = ref(false);
  const source = ref<GovernanceSourceRead | null>(null);
  let generation = 0,
    sourceGeneration = 0;
  let controller = new AbortController();
  let subscription: { controller: AbortController; lastSeq: number } | null =
    null;
  // A round this page just created keeps its live state when the route catches up.
  let adopted: string | null = null;

  const messages = computed(() =>
    joinAssistantTurns([
      ...(session.value?.messages ?? []),
      ...live.value.messages,
    ]),
  );
  // Only a followed stream says a response is in flight; a stale snapshot never does.
  const running = computed(
    () => live.value.status === "starting" || live.value.status === "running",
  );

  const apply = (next: GovernanceSession) => {
    if (session.value?.id === next.id && session.value.revision > next.revision)
      return;
    session.value = next;
    if (next.status !== "running") stopping.value = false;
  };
  const failed = (reason: unknown, owner: number) => {
    if (generation === owner && !controller.signal.aborted)
      error.value = reason instanceof Error ? reason.message : String(reason);
  };
  // Detaching only ends this page's subscription; the server keeps running the turn.
  function detach() {
    subscription?.controller.abort();
    subscription = null;
  }
  function applyEvent(event: GovernanceStreamEvent): boolean {
    if (event.type === "snapshot") {
      live.value = { messages: event.messages, status: "running" };
      session.value = { ...session.value!, work: event.work };
      return false;
    }
    if (event.type === "work") {
      session.value = { ...session.value!, work: event.work };
      return false;
    }
    live.value = reduceAgentLiveTail(live.value, event);
    return (
      event.type === "response_end" ||
      event.type === "error" ||
      event.type === "response_unavailable"
    );
  }
  function wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      const abort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  /**
   * Follow one Harness turn. The cursor belongs to that turn only; when its stream is no
   * longer available the settled snapshot decides: finished, or a newer turn to follow.
   */
  function follow(id: string, turnId: string, owner: number) {
    detach();
    const current = { controller: new AbortController(), lastSeq: 0 };
    subscription = current;
    live.value = { messages: [], status: "starting" };
    streamLost.value = false;
    const isCurrent = () => subscription === current && generation === owner;
    const lose = (reason: unknown) => {
      subscription = null;
      live.value = { ...live.value, status: "idle" };
      streamLost.value = true;
      if (reason) failed(reason, owner);
    };
    void (async () => {
      let reconnects = 0;
      let lastFailure: unknown = null;
      while (true) {
        let settled = false;
        try {
          const response = await governanceApi.stream(
            id,
            turnId,
            current.lastSeq,
            current.controller.signal,
          );
          settled = await readSseData(
            response,
            (data, seq) => {
              const parsed = governanceStreamEventSchema.safeParse(data);
              if (!parsed.success)
                throw new SseProtocolError("Invalid governance stream event");
              if (
                parsed.data.type === "snapshot" &&
                parsed.data.runId !== turnId
              )
                throw new SseProtocolError("Snapshot belongs to another run");
              // A missing stream is not progress; only real events refill the budget.
              if (parsed.data.type !== "response_unavailable") reconnects = 0;
              if (seq !== undefined)
                current.lastSeq = Math.max(current.lastSeq, seq);
              return applyEvent(parsed.data);
            },
            isCurrent,
          );
        } catch (reason) {
          if (!isCurrent()) return;
          // Only a dropped connection is retried; HTTP and protocol failures are final.
          if (!(reason instanceof TypeError)) return lose(reason);
          lastFailure = reason;
        }
        if (!isCurrent()) return;
        if (settled) {
          let next: GovernanceSession;
          try {
            next = await governanceApi.read(id, controller.signal);
          } catch (reason) {
            if (isCurrent()) lose(reason);
            return;
          }
          if (!isCurrent()) return;
          if (next.status !== "running" || next.activeTurnId !== turnId) {
            subscription = null;
            apply(next);
            live.value = idleTail();
            error.value = "";
            if (next.status === "running")
              follow(id, next.activeTurnId!, owner);
            return;
          }
          // The same turn still runs but its stream was not ready yet: retry within budget.
        }
        if (++reconnects > MAX_RECONNECTS) return lose(lastFailure);
        await wait(RECONNECT_DELAY_MS, current.controller.signal);
        if (!isCurrent()) return;
      }
    })();
  }
  async function loadRounds(owner: number) {
    try {
      const list = await governanceApi.list(controller.signal);
      if (generation === owner) rounds.value = list;
    } catch (reason) {
      failed(reason, owner);
    }
  }
  async function select(id?: string) {
    if (id && id === adopted) {
      adopted = null;
      return;
    }
    adopted = null;
    const owner = ++generation;
    controller.abort();
    controller = new AbortController();
    detach();
    session.value = null;
    live.value = idleTail();
    source.value = null;
    ++sourceGeneration;
    error.value = "";
    streamLost.value = false;
    sending.value = false;
    stopping.value = false;
    // Only reading a saved round holds the page; a new conversation is writable at once.
    loading.value = Boolean(id);
    // The round list never holds back the conversation or its input.
    void loadRounds(owner);
    if (!id) return;
    try {
      const next = await governanceApi.read(id, controller.signal);
      if (generation !== owner) return;
      apply(next);
      if (next.status === "running") follow(id, next.activeTurnId!, owner);
    } catch (reason) {
      failed(reason, owner);
    } finally {
      if (generation === owner) loading.value = false;
    }
  }
  /** Sends a user message; the first one creates the round. Resolves to the round id on success. */
  async function send(message: string) {
    const text = message.trim();
    if (!text || sending.value || running.value) return;
    const owner = generation,
      current = session.value;
    sending.value = true;
    error.value = "";
    try {
      const next = current
        ? await governanceApi.respond(current.id, text, controller.signal)
        : await governanceApi.start(text, controller.signal);
      if (owner !== generation) return;
      apply(next);
      // A fast reply or early failure may already be settled; only a running turn has a stream.
      if (next.status === "running") follow(next.id, next.activeTurnId!, owner);
      else {
        live.value = idleTail();
        streamLost.value = false;
      }
      if (!current) {
        adopted = next.id;
        void loadRounds(owner);
      }
      return next.id;
    } catch (reason) {
      failed(reason, owner);
    } finally {
      if (owner === generation) sending.value = false;
    }
  }
  /** Reload the current round from its snapshot, resuming live updates if it still runs. */
  function reload() {
    if (session.value) void select(session.value.id);
  }
  async function stop() {
    const id = session.value?.id,
      owner = generation;
    if (!id || stopping.value || !running.value) return;
    stopping.value = true;
    try {
      await governanceApi.stop(id, controller.signal);
    } catch (reason) {
      failed(reason, owner);
      if (owner === generation) stopping.value = false;
    }
  }
  async function readSource(id: string, offset = 0) {
    const current = session.value?.id,
      owner = generation,
      sourceOwner = ++sourceGeneration;
    if (!current) return;
    try {
      const next = await governanceApi.source(
        current,
        id,
        offset,
        controller.signal,
      );
      if (owner === generation && sourceOwner === sourceGeneration)
        source.value = next;
    } catch (reason) {
      failed(reason, owner);
    }
  }
  onUnmounted(() => {
    ++generation;
    controller.abort();
    detach();
  });
  return {
    session,
    messages,
    running,
    rounds,
    loading,
    sending,
    stopping,
    error,
    streamLost,
    source,
    select,
    reload,
    send,
    stop,
    readSource,
  };
}
