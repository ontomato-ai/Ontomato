import { computed, onBeforeUnmount, reactive, ref } from "vue";
import type { AgentHostRunSnapshot, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "./host";
import type { RuntimeStreamFrame } from "@ontomato/contracts/agent-runtime-events";
import {
  applyEnvelope,
  applyRunSnapshot,
  applySessionSnapshot,
  emptyConversation,
  findArtifact,
  type ConversationState,
} from "./conversation";
import { conversationItems } from "./view";

const RECONNECT_DELAYS = [500, 1000, 2000, 5000, 10000];
const MAX_QUEUED_FRAMES = 2000;
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
  let detach: (() => void) | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: RuntimeStreamFrame[] = [];
  let flushHandle: number | null = null;

  const items = computed(() => conversationItems(state));
  const activeRunId = computed(
    () => Object.values(state.runs).find((run) => run.status === "running")?.id ?? null,
  );
  const busy = computed(() => sending.value || activeRunId.value !== null);

  function stopStream() {
    detach?.();
    detach = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (flushHandle !== null) cancelAnimationFrame(flushHandle);
    flushHandle = null;
    queue = [];
  }

  function reset(sessionId: string | null) {
    token++;
    stopStream();
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
      if (snapshot.latestRun?.run.status === "running") attach(snapshot.latestRun.run.id, 0);
    } catch (error) {
      if (current === token) loadError.value = errorText(error);
    } finally {
      if (current === token) loading.value = false;
    }
  }

  function flush() {
    flushHandle = null;
    const frames = queue;
    queue = [];
    for (const frame of frames) {
      if (frame.type === "snapshot_required") {
        void refreshRun(frame.runId, token, 0);
        return;
      }
      applyEnvelope(state, frame.envelope);
      const type = frame.envelope.event.type;
      if (type === "artifact_registered") artifactRevision.value++;
      if (type === "tool_execution_start") {
        // The ask command blocks until the retrieval ends, so tool_execution_end is too late.
        // Start looking for the association when the bash call starts; it appears once ask is
        // accepted. Detection is the analyst entry script followed by its ask subcommand, which
        // covers "node skills/ontomato-analyst/ontomato.mjs ask", "cd …/ontomato-analyst && node
        // ontomato.mjs ask" and quoted paths. A wrapper script or variable that hides
        // "ontomato.mjs ask" is not covered; its retrievals arrive on the next run snapshot read.
        const event = frame.envelope.event;
        const command = event.args.command;
        if (event.toolName === "bash" && typeof command === "string" && ANALYST_ASK.test(command))
          void watchRetrievals(frame.envelope.cursor.runId, event.toolCallId, token);
      }
      if (type === "agent_end") {
        stopStream();
        return;
      }
    }
  }

  /**
   * Reads the run until its retrieval associations appear, then hands over to the activity
   * area's own polling. Each read happens before the stop check, so a retrieval that finishes
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

  function attach(runId: string, attempt: number) {
    stopStream();
    const run = state.runs[runId];
    const sessionId = state.sessionId;
    if (!sessionId || !run?.cursor || run.status !== "running") return;
    const current = token;
    detach = port().subscribe(sessionId, runId, run.cursor, {
      frame(frame) {
        if (current !== token) return;
        queue.push(frame);
        // Bounded: when rendering falls far behind, replace the backlog with a snapshot read.
        if (queue.length > MAX_QUEUED_FRAMES)
          queue = [{ type: "snapshot_required", runId, reason: "buffer_lost" }];
        flushHandle ??= requestAnimationFrame(flush);
      },
      error() {
        if (current !== token) return;
        detach = null;
        scheduleRefresh(runId, current, attempt + 1);
      },
    });
  }

  function scheduleRefresh(runId: string, current: number, attempt: number) {
    const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
    reconnectTimer = setTimeout(() => void refreshRun(runId, current, attempt), delay);
  }

  async function refreshRun(runId: string, current: number, attempt: number) {
    stopStream();
    const sessionId = state.sessionId;
    if (!sessionId) return;
    try {
      const snapshot = await port().readRun(sessionId, runId);
      if (current !== token) return;
      applyRunSnapshot(state, snapshot);
      artifactRevision.value++;
      attach(runId, attempt);
    } catch {
      if (current === token) scheduleRefresh(runId, current, attempt + 1);
    }
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
      attach(snapshot.run.id, 0);
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
      if (current === token) await refreshRun(runId, current, 0);
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
    stopStream();
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
