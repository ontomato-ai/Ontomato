import { computed, onBeforeUnmount, reactive, ref } from "vue";
import type { AgentHostRunSnapshot, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "./host";
import type { RuntimeEventEnvelope } from "@ontomato/contracts/agent-runtime-events";
import { createRunSubscription, type RunSubscription } from "./run-subscription";
import {
  applyEnvelope,
  applyRunSnapshot,
  applySessionSnapshot,
  emptyConversation,
  findArtifact,
  type ConversationState,
} from "./conversation";
import { conversationItems } from "./view";

const RETRIEVAL_LINK_RETRY_MS = 1500;
/** The ontomato-analyst entry script running its ask (retrieval) subcommand. */
const ANALYST_ASK = /ontomato\.mjs["']?\s+ask\b/;

/**
 * Drives one selected conversation through the host port. Every async continuation checks the
 * selection token, so a late response for a previous session never writes into the current one.
 * Frames are applied in batches once per animation frame.
 */
export function useAgentConversation(port: () => AgentHostClient) {
  const state = reactive<ConversationState>(emptyConversation());
  const loading = ref(false);
  const loadError = ref<string | null>(null);
  const sending = ref(false);
  const sendError = ref<string | null>(null);
  /** User text shown until the admitted run's snapshot contains the real message. */
  const pendingInput = ref<string | null>(null);
  const artifactRevision = ref(0);

  let token = 0;
  const stream = createRunSubscription();

  const items = computed(() => conversationItems(state));
  const activeRunId = computed(
    () => Object.values(state.runs).find((run) => run.status === "running")?.id ?? null,
  );
  const busy = computed(() => sending.value || activeRunId.value !== null);

  function reset(sessionId: string | null) {
    token++;
    stream.stop();
    Object.assign(state, emptyConversation(sessionId));
    loading.value = false;
    loadError.value = null;
    sending.value = false;
    sendError.value = null;
    pendingInput.value = null;
  }

  async function open(sessionId: string | null) {
    reset(sessionId);
    if (!sessionId) return;
    const current = token;
    loading.value = true;
    try {
      const snapshot = await port().readSession(sessionId);
      if (current !== token) return;
      applySessionSnapshot(state, snapshot);
      artifactRevision.value++;
      if (snapshot.latestRun?.run.status === "running") stream.start(subscription(snapshot.latestRun.run.id));
      void loadEarlierRetrievals(sessionId, snapshot.latestRun?.run.id ?? null, current);
    } catch (error) {
      if (current === token) loadError.value = errorText(error);
    } finally {
      if (current === token) loading.value = false;
    }
  }

  /**
   * The session snapshot carries only the latest run. Earlier runs that called the analyst ask
   * get their own run snapshot, so their retrieval activity survives a reload.
   */
  async function loadEarlierRetrievals(sessionId: string, latestRunId: string | null, current: number) {
    const runIds = new Set<string>();
    for (const entry of Object.values(state.messages)) {
      const message = entry.message;
      if (entry.runId === latestRunId || message.role !== "assistant") continue;
      for (const block of message.content) {
        const command = block.type === "toolCall" && block.name === "bash" ? block.arguments.command : undefined;
        if (typeof command === "string" && ANALYST_ASK.test(command)) runIds.add(entry.runId);
      }
    }
    await Promise.all([...runIds].map(async (runId) => {
      try {
        const snapshot = await port().readRun(sessionId, runId);
        if (current === token) applyRunSnapshot(state, snapshot);
      } catch {
        // Best-effort: without it the earlier run still renders, only without its activity area.
      }
    }));
  }

  function applyEvent(envelope: RuntimeEventEnvelope) {
    if (!applyEnvelope(state, envelope)) return;
    const type = envelope.event.type;
    if (type === "artifact_registered") artifactRevision.value++;
    if (type === "tool_execution_start") {
      // The ask command blocks until the retrieval ends, so tool_execution_end is too late.
      // Start looking for the association when the bash call starts; it appears once ask is
      // accepted. Detection is the analyst entry script followed by its ask subcommand, which
      // covers "node skills/ontomato-analyst/ontomato.mjs ask", "cd …/ontomato-analyst && node
      // ontomato.mjs ask" and quoted paths. A wrapper script or variable that hides
      // "ontomato.mjs ask" is not covered; its retrievals arrive on the next run snapshot read.
      const event = envelope.event;
      const command = event.args.command;
      if (event.toolName === "bash" && typeof command === "string" && ANALYST_ASK.test(command))
        void watchRetrievals(envelope.cursor.runId, event.toolCallId, token);
    }
  }

  /**
   * Reads the run until its retrieval associations appear, then hands over to the activity
   * area's child-run subscription. Each read happens before the stop check, so a retrieval that finishes
   * within one interval is still picked up.
   */
  async function watchRetrievals(runId: string, toolCallId: string, current: number) {
    const sessionId = state.sessionId;
    if (!sessionId) return;
    const linkKey = (links: readonly { retrievalId: string; runId: string }[]) =>
      links.map((link) => `${link.retrievalId}:${link.runId}`).join(",");
    // A new retrieval adds a link; a continuation moves an existing link to its new run.
    const known = linkKey(state.runs[runId]?.retrievals ?? []);
    for (;;) {
      try {
        const snapshot = await port().readRun(sessionId, runId);
        if (current !== token) return;
        const retrievals = snapshot.run.retrievals ?? [];
        const run = state.runs[runId];
        if (run && linkKey(retrievals) !== known) {
          run.retrievals = retrievals;
          return;
        }
      } catch {
        if (current !== token) return;
      }
      const run = state.runs[runId];
      if (!run || run.status !== "running" || run.tools[toolCallId]?.status !== "running") return;
      await new Promise((resolve) => setTimeout(resolve, RETRIEVAL_LINK_RETRY_MS));
      if (current !== token) return;
    }
  }

  function subscription(runId: string): RunSubscription {
    const sessionId = state.sessionId!;
    const client = port();
    return {
      runId,
      current: () => state.runs[runId],
      read: () => client.readRun(sessionId, runId),
      snapshot(snapshot) {
        applyRunSnapshot(state, snapshot);
        artifactRevision.value++;
      },
      event: applyEvent,
      subscribe: (after, handlers) => client.subscribe(sessionId, runId, after, handlers),
    };
  }

  /**
   * Starts a run, creating the session first for a new conversation. Resolves to the created
   * session (if any) and the admitted run so the session list can update; null when sending failed.
   */
  async function send(
    agentId: string,
    text: string,
  ): Promise<{ createdSession: AgentHostSession | null; snapshot: AgentHostRunSnapshot } | null> {
    if (busy.value) return null;
    const current = token;
    sending.value = true;
    sendError.value = null;
    pendingInput.value = text;
    try {
      const createdSession = state.sessionId ? null : await port().createSession(agentId);
      if (current !== token) return null;
      if (createdSession) state.sessionId = createdSession.id;
      const snapshot = await port().startRun(state.sessionId!, text);
      if (current !== token) return { createdSession, snapshot };
      applyRunSnapshot(state, snapshot);
      pendingInput.value = null;
      artifactRevision.value++;
      stream.start(subscription(snapshot.run.id));
      return { createdSession, snapshot };
    } catch (error) {
      if (current === token) {
        sendError.value = errorText(error);
        pendingInput.value = null;
      }
      return null;
    } finally {
      if (current === token) sending.value = false;
    }
  }

  async function cancel() {
    const runId = activeRunId.value;
    const sessionId = state.sessionId;
    if (!runId || !sessionId) return;
    const current = token;
    try {
      await port().cancel(sessionId, runId);
    } finally {
      if (current === token) await stream.load(subscription(runId));
    }
  }

  async function resolveArtifact(runId: string, path: string) {
    const local = findArtifact(state.runs[runId], path);
    if (local) return local;
    const sessionId = state.sessionId;
    return sessionId ? port().resolveArtifact(sessionId, runId, path) : null;
  }

  onBeforeUnmount(() => {
    token++;
    stream.stop();
  });

  return {
    state,
    items,
    loading,
    loadError,
    sending,
    sendError,
    pendingInput,
    busy,
    activeRunId,
    artifactRevision,
    open,
    send,
    cancel,
    resolveArtifact,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
