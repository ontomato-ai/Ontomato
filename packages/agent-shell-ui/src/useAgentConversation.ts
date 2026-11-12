import { historyCursor } from "@ontomato/contracts/session-history";
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import type { AgentTasksSnapshot } from "@ontomato/contracts/agent-tasks";
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

/** A task stream that broke before settling is opened again after this long, and reads the whole snapshot again. */
const TASK_RECONNECT_MS = 2000;

/**
 * Drives one selected conversation through the host port. Every async continuation checks the
 * selection token, so a late response for a previous session never writes into the current one.
 * Frames are applied in batches once per animation frame.
 */
export function useAgentConversation(port: () => AgentHostClient, agent: () => string | null) {
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
  /** The conversation's delegated work, as the host's task stream last reported it. */
  const tasks = shallowRef<AgentTasksSnapshot | null>(null);
  let detachTasks: (() => void) | null = null;
  let taskTimer: ReturnType<typeof setTimeout> | null = null;

  const items = computed(() => conversationItems(state, tasks.value));
  const activeRunId = computed(
    () => Object.values(state.runs).find((run) => run.status === "running")?.id ?? null,
  );
  const busy = computed(() => sending.value || activeRunId.value !== null);

  function stopTasks() {
    detachTasks?.();
    detachTasks = null;
    if (taskTimer !== null) clearTimeout(taskTimer);
    taskTimer = null;
  }

  /**
   * Follows the conversation's tasks until they settle. The stream outlives the run that delegated them, so a review
   * that arrives after the reply still shows; each new run opens it again.
   */
  function followTasks(sessionId: string) {
    stopTasks();
    const host = port().tasks, selection = token;
    if (!host) return;
    detachTasks = host.subscribe(sessionId, {
      frame(frame) {
        if (selection === token) tasks.value = { sessionId: frame.sessionId, tasks: frame.tasks, qualityResults: frame.qualityResults };
      },
      error() {
        if (selection !== token) return;
        detachTasks = null;
        taskTimer = setTimeout(() => followTasks(sessionId), TASK_RECONNECT_MS);
      },
    });
  }

  function reset(sessionId: string | null) {
    token++;
    stopTasks();
    tasks.value = null;
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
      followTasks(sessionId);
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
   * Starts a run, creating the session first for a new conversation. Resolves to the created session (if any) and the
   * admitted run so the session list can update, unless the host has moved to another client or agent meanwhile; a
   * created session whose run was refused comes back without a run, so the host still takes it. Null when sending
   * failed without creating a session.
   */
  async function send(
    agentId: string,
    text: string,
  ): Promise<
    | { createdSession: AgentHostSession | null; snapshot: AgentHostRunSnapshot }
    | { createdSession: AgentHostSession; snapshot: null }
    | null
  > {
    if (busy.value) return null;
    const current = token, client = port();
    /**
     * The host has moved to another client or agent since this send started, which dropped it (the watch below), as
     * opposed to the reader opening another conversation in the same context.
     */
    const moved = () => port() !== client || agent() !== agentId;
    sending.value = true;
    sendError.value = null;
    pendingInput.value = text;
    let createdSession: AgentHostSession | null = null;
    try {
      createdSession = state.sessionId ? null : await client.createSession(agentId);
      if (current !== token) return null;
      if (createdSession) state.sessionId = createdSession.id;
      const snapshot = await client.startRun(state.sessionId!, text);
      if (current !== token) return moved() ? null : { createdSession, snapshot };
      applyRunSnapshot(state, snapshot);
      for (const message of snapshot.messages) knownMessageSeq = Math.max(knownMessageSeq, message.messageSeq);
      pendingInput.value = null;
      artifactRevision.value++;
      followTasks(state.sessionId!);
      stream.start(subscription(snapshot.run.id));
      return { createdSession, snapshot };
    } catch (error) {
      if (current === token) {
        sendError.value = errorText(error);
        pendingInput.value = null;
        if (createdSession) return { createdSession, snapshot: null };
      }
      return null;
    } finally {
      if (current === token) sending.value = false;
    }
  }

  /*
   * A send belongs to the client and agent it started with. When the host moves to another (another workspace, another
   * agent) while one is on its way, the conversation drops it at once and is the new one's blank conversation; what
   * returns later is stale. Without a send on its way, nothing changes: a blank conversation stays as it is.
   */
  watch([port, agent], () => {
    if (sending.value) reset(null);
  });

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
    stopTasks();
  });

  return {
    state,
    items,
    tasks,
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
