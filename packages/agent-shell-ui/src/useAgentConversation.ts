import { historyCursor } from "@ontomato/contracts/session-history";
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import type { AgentHostRunSnapshot, AgentHostSessionHistory, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "./host";
import type { RuntimeEventEnvelope } from "@ontomato/contracts/agent-runtime-events";
import { createRunSubscription, type RunSubscription } from "./run-subscription";
import {
  applyEnvelope,
  applyRunSnapshot,
  applyHistoryPage,
  applyHistoryLive,
  emptyConversation,
  findArtifact,
  type ConversationState,
} from "./conversation";
import { conversationItems } from "./view";
import { runsAnalystAsk } from "./tools";

const RETRIEVAL_LINK_RETRY_MS = 1500;

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
  const stream = createRunSubscription<AgentHostSessionHistory[]>();
  const olderCursor = ref<string | null>(null);
  const loadingOlder = ref(false);
  const olderError = ref<string | null>(null);
  const historyRevision = ref(0);
  let knownMessageSeq = 0;

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
    olderCursor.value = null;
    loadingOlder.value = false;
    olderError.value = null;
    historyRevision.value = 0;
    knownMessageSeq = 0;
  }

  async function open(sessionId: string | null) {
    reset(sessionId);
    if (!sessionId) return;
    const current = token;
    loading.value = true;
    try {
      const snapshot = await port().readHistory(sessionId);
      if (current !== token) return;
      applyHistoryPage(state, snapshot);
      if (snapshot.latestRun) applyHistoryLive(state, snapshot.latestRun);
      knownMessageSeq = snapshot.page.messageSeq;
      olderCursor.value = snapshot.page.olderCursor;
      artifactRevision.value++;
      if (snapshot.latestRun?.run.status === "running") stream.start(subscription(snapshot.latestRun.run.id));
    } catch (error) {
      if (current === token) loadError.value = errorText(error);
    } finally {
      if (current === token) loading.value = false;
    }
  }

  async function loadOlder() {
    const sessionId = state.sessionId, before = olderCursor.value, current = token;
    if (!sessionId || !before || loadingOlder.value) return;
    loadingOlder.value = true;
    olderError.value = null;
    try {
      const page = await port().readHistory(sessionId, { before });
      if (current !== token) return;
      applyHistoryPage(state, page, true);
      olderCursor.value = page.page.olderCursor;
      historyRevision.value++;
    } catch (error) {
      if (current === token) olderError.value = errorText(error);
    } finally {
      if (current === token) loadingOlder.value = false;
    }
  }

  function applyEvent(envelope: RuntimeEventEnvelope) {
    if (!applyEnvelope(state, envelope)) return;
    const type = envelope.event.type;
    if (envelope.event.type === "message_end") knownMessageSeq = Math.max(knownMessageSeq, envelope.event.messageSeq);
    if (type === "artifact_registered") artifactRevision.value++;
    if (type === "tool_execution_start") {
      // The ask command blocks until the retrieval ends, so tool_execution_end is too late: start
      // looking when the bash call starts. A wrapper script that hides the analyst entry is not
      // covered; its retrievals arrive on the next history read.
      const event = envelope.event;
      const command = event.args.command;
      if (event.toolName === "bash" && typeof command === "string" && runsAnalystAsk(command))
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

  function subscription(runId: string): RunSubscription<AgentHostSessionHistory[]> {
    const sessionId = state.sessionId!, client = port(), selection = token;
    let selectedRunId = runId;
    return {
      get runId() { return selectedRunId; },
      current: () => state.runs[selectedRunId],
      async read() {
        const first = await client.readHistory(sessionId, { after: historyCursor(sessionId, knownMessageSeq), runId: selectedRunId });
        const pages = [first];
        let next = first.page.nextCursor;
        while (next && selection === token) {
          const page = await client.readHistory(sessionId, { after: next, through: first.page.throughCursor });
          pages.push(page);
          next = page.page.nextCursor;
        }
        return pages;
      },
      snapshot(pages) {
        for (const page of pages) applyHistoryPage(state, page);
        const first = pages[0];
        if (first.latestRun) {
          applyHistoryLive(state, first.latestRun);
          selectedRunId = first.latestRun.run.id;
        }
        knownMessageSeq = Math.max(knownMessageSeq, pages[pages.length - 1].page.messageSeq);
        artifactRevision.value++;
      },
      event: applyEvent,
      subscribe: (after, handlers) => client.subscribe(sessionId, selectedRunId, after, handlers),
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
      for (const message of snapshot.messages) knownMessageSeq = Math.max(knownMessageSeq, message.messageSeq);
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
    olderCursor,
    loadingOlder,
    olderError,
    historyRevision,
    loadOlder,
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
