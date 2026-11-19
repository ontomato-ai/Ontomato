import type { PresentationBinding } from "@ontomato/contracts/agent-presentation";
import { historyCursor } from "@ontomato/contracts/session-history";
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import type { AgentTasksSnapshot } from "@ontomato/contracts/agent-tasks";
import type { AgentHostRunSnapshot, AgentHostSendResult, AgentHostSessionHistory, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "./host";
import type { RuntimeEventEnvelope } from "@ontomato/contracts/agent-runtime-events";
import { createRunSubscription, type RunSubscription } from "./run-subscription";
import {
  applyEnvelope,
  applyRunSnapshot,
  applyHistoryPage,
  applyHistoryLive,
  emptyConversation,
  applyNotifications,
  findArtifact,
  type ConversationState,
} from "./conversation";
import { conversationItems } from "./view";
import { documentVisible, onDocumentVisibility } from "@ontomato/foundation-ui/visibility";

/** A task stream that broke before settling is opened again after this long, and reads the whole snapshot again. */
const TASK_RECONNECT_MS = 2000;

/**
 * Drives one selected conversation through the host port. Every async continuation checks the
 * selection token, so a late response for a previous session never writes into the current one.
 * Frames are applied in batches once per animation frame.
 */
/**
 * `presentation` is the page's live display binding, when it has one: a run this conversation starts may then show
 * what it presents beside the conversation the reader is in.
 */
export function useAgentConversation(
  port: () => AgentHostClient,
  agent: () => string | null,
  presentation: () => PresentationBinding | null = () => null,
) {
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

  const pendingQuestions=computed(()=>state.pendingQuestions);
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
   * Follows the conversation's tasks: the host keeps the stream open and starts it with the whole snapshot, so a review
   * that arrives after the reply still shows; each new run opens it again. A hidden tab holds no stream: it is opened
   * again, snapshot first, when the tab comes back.
   */
  function followTasks(sessionId: string) {
    stopTasks();
    const host = port().tasks, selection = token;
    if (!host || !documentVisible()) return;
    detachTasks = host.subscribe(sessionId, {
      frame(frame) {
        if (selection === token) {
          tasks.value = { sessionId: frame.sessionId, tasks: frame.tasks, qualityResults: frame.qualityResults, preparationFailures: frame.preparationFailures };
          if (frame.notifications) applyNotifications(state, frame.notifications);
          // The questions waiting for the reader belong to the conversation, not to a run: one may arrive after the reply
          // that led to it has ended, so the session's own list replaces what the last run reported.
          if (frame.pendingQuestions) state.pendingQuestions = frame.pendingQuestions;
        }
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

  /**
   * The open conversation's live run. Without `runId` it is whichever run the history's next read reports as the latest:
   * the conversation catching up after the tab was hidden, when a round may have started meanwhile.
   */
  function subscription(runId?: string): RunSubscription<AgentHostSessionHistory[]> {
    const sessionId = state.sessionId!, client = port(), selection = token;
    let selectedRunId = runId;
    return {
      get runId() { return selectedRunId!; },
      current: () => (selectedRunId ? state.runs[selectedRunId] : undefined),
      async read() {
        const after = historyCursor(sessionId, knownMessageSeq);
        const first = await client.readHistory(sessionId, selectedRunId ? { after, runId: selectedRunId } : { after });
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
      subscribe: (after, handlers) => client.subscribe(sessionId, selectedRunId!, after, handlers),
    };
  }

  /**
   * Starts a run, creating the session first for a new conversation. Resolves to the created session (if any) and the
   * admitted run so the session list can update, unless the host has moved to another client or agent meanwhile; a
   * created session whose run was refused comes back without a run, so the host still takes it. Null when sending
   * failed without creating a session.
   *
   * An answer to a question addressed to the reader comes back as a receipt (`delivery: "receipt"`, no snapshot): the
   * conversation recorded it and started nothing, so no run is attached; the agent that asked is woken on its own side.
   */
  async function send(
    agentId: string,
    text: string,
    reply?: { replyTo: string; selectedOption?: number },
  ): Promise<
    | ({ createdSession: AgentHostSession | null } & AgentHostSendResult)
    | { createdSession: AgentHostSession; snapshot: null; delivery: null }
    | null
  > {
    if (sending.value) return null;
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
      const binding = presentation();
      const result = await client.send(state.sessionId!, { message: text, ...reply, ...(binding ? { presentationBinding: binding } : {}) });
      if (current !== token) return moved() ? null : { createdSession, ...result };
      applyNotifications(state,[result.input]);
      state.pendingQuestions=result.pendingQuestions;
      if(result.snapshot) {
        if(state.runs[result.snapshot.run.id]) applyRunSnapshot(state,result.snapshot);
        else attach(result.snapshot);
      }
      pendingInput.value = null;
      return { createdSession, ...result };
    } catch (error) {
      if (current === token) {
        sendError.value = errorText(error);
        pendingInput.value = null;
        if (createdSession) return { createdSession, snapshot: null, delivery: null };
      }
      return null;
    } finally {
      if (current === token) sending.value = false;
    }
  }

  async function answerQuestion(requestId: string, answer: string, selectedOption?: number) {
    const id = agent();
    return id ? send(id, answer, { replyTo: requestId, selectedOption }) : null;
  }

  function attach(snapshot: AgentHostRunSnapshot) {
    applyRunSnapshot(state, snapshot);
    for (const message of snapshot.messages) knownMessageSeq = Math.max(knownMessageSeq, message.messageSeq);
    artifactRevision.value++;
    followTasks(state.sessionId!);
    stream.start(subscription(snapshot.run.id));
  }
  async function followRun(runId: string) {
    const selected = token, session = state.sessionId;
    if (!session || state.runs[runId] || activeRunId.value === runId) return;
    const snapshot = await port().readRun(session, runId);
    if (selected !== token || state.runs[runId]) return;
    attach(snapshot);
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

  /*
   * A hidden tab stops watching the open conversation and keeps everything it showed; the run itself goes on. Back in the
   * foreground the conversation reads what it missed from its cursor — the messages, the latest run, which may be a round
   * that started meanwhile, and the questions waiting — and follows a live run from there; the task stream reopens with
   * its snapshot. A run that was being followed catches up through its own subscription.
   */
  const stopVisibility = onDocumentVisibility((visible) => {
    if (!visible) return stopTasks();
    const sessionId = state.sessionId;
    if (!sessionId || loading.value || sending.value) return;
    followTasks(sessionId);
    if (!stream.following()) void stream.load(subscription());
  });

  onBeforeUnmount(() => {
    token++;
    stream.stop();
    stopTasks();
    stopVisibility();
  });

  return {
    state,
    items,
    tasks,
    pendingQuestions,
    answerQuestion,
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
    followRun,
    send,
    cancel,
    resolveArtifact,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
