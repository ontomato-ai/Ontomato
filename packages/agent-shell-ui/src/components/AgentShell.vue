<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, toRef, useId, useSlots, watch } from "vue";
import { PanelLeft, PanelRightOpen, X } from "lucide-vue-next";
import { conversationQuestions, displayPlacementKey, shellContextKey, type ShellContext } from "../context";
import { entryAgent, servePageComposerKey, type ComposerEntry, type PageComposerExpand } from "../page-composer-entry";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import {
  CLOSED_TARGET,
  carriedTargetIn,
  fileContextLine,
  pageContextLine,
  pageMoved,
  samePageAddress,
  type CarriedTarget,
} from "../page-context";
import { fileName } from "../artifacts";
import { displayLink, type ConversationDisplay, type DisplayPage } from "../conversation-display";
import type { AgentHostClient } from "../host";
import type { AgentNav } from "../useAgentNav";
import type { UserItem } from "../view";
import type {
  ArtifactRendererOverride,
  ShellBottomEntry,
  ShellFeedbackPort,
  ShellLabels,
  ShellPanelOperationsPort,
  ShellRunChange,
  ShellWorkbenchDeclaration,
  ToolRendererOverride,
} from "../types";
import { pageSessionStream, sessionRunNotices } from "../session-run-notices";
import { documentVisible } from "@ontomato/foundation-ui/visibility";
import { useAgentConversation } from "../useAgentConversation";
import ShellColumn from "./ShellColumn.vue";
import ShellConversation from "./ShellConversation.vue";
import ShellNavBody from "./ShellNavBody.vue";
import ShellPagePane from "./ShellPagePane.vue";
import ShellSidePanel from "./ShellSidePanel.vue";
import TaskDrawer from "./tasks/TaskDrawer.vue";

/**
 * A conversation application inside the area the platform gives it: its own column, then the conversation with the right
 * outlet for an artifact (the page beside it, or the page full).
 *
 * The column belongs to the application (DESIGN.md "Applications and shells"): this component draws its frame and, by
 * default, the application's navigation — the agent switch or the application's name, a new conversation, the
 * application's own pages, the recent conversations and the application's own entry at the foot. A host that needs a
 * different column (the agent platform's settings navigation) fills the `column` slot instead. One `nav` is shared with
 * the conversation, so a conversation created while sending appears in the column and the agents and sessions are read
 * once.
 *
 * Rendering defaults live here; hosts pass overrides and fill the slots `feature` (feature pages), `artifact-actions` and
 * `message-actions`.
 *
 * What sits beside the conversation is the host's `display` (`useConversationDisplay`): this shell draws it and hands every
 * reader gesture on it — a card, a link, the column, closing, enlarging, collapsing — to that one controller.
 *
 * A feature declared `withConversation` follows the agent-app states (DESIGN "Agent apps"): conversation only, the
 * page beside the conversation, or the page full with a composer. Once such a page is closed, the conversation's top
 * right corner opens it beside the conversation again. Messages sent while such a page is open end with the display's
 * page context line, so the agent knows what "this" refers to; the first message after it is no longer shown says so. Such a page may fill `page-header` (its own controls, in
 * the row of the shell's expand and close buttons) and `composer-context` (with whichever composer is in view: above
 * the conversation's, `inline` in the full page's single row; `pageOpen` tells whether a message sent now carries the
 * page context; `unstarted` tells that the conversation in view has not started: the shell holds no session for it and
 * no message is on its way).
 *
 * `run` reports the open conversation's run starting and stopping, with the workspace commit a stopped run saved.
 */
const props = withDefaults(
  defineProps<{
    workbench: ShellWorkbenchDeclaration;
    client: AgentHostClient;
    labels: ShellLabels;
    feedback?: ShellFeedbackPort;
    /** Whether agents ask before they run a panel operation, for a host whose conversations can run them. */
    panelOperations?: ShellPanelOperationsPort;
    artifactRenderers?: readonly ArtifactRendererOverride[];
    toolRenderers?: readonly ToolRendererOverride[];
    /** What is shown beside the conversation: the one controller this shell's gestures and the host's address go through. */
    display: ConversationDisplay;
    /**
     * Recognises an in-app address in an answer that is no page of the display (another application's page) and returns
     * how to open it; null leaves it as text.
     */
    pageLinks?: ShellContext["pageLink"];
    /**
     * The navigation state the host shares with its column: one instance, so a conversation created while sending
     * appears in the column and the agents and sessions are read once.
     */
    nav: AgentNav;
    /** The application's name, at the top of the column when the application runs on one agent. */
    title?: string;
    /** The application's own entry at the foot of its column (its settings, the model the diagnosis runs on). */
    bottom?: ShellBottomEntry | null;
    /** Whether the reader may hold conversations here; without it the column lists only the pages and the foot. */
    conversations?: boolean;
    /**
     * The application runs on more than one agent (the agent platform), so its column heads with the agent chooser
     * whatever the chooser lists at the moment — a page beside the conversation may narrow it to one. An application that
     * runs on a single agent heads its column with its name.
     */
    agentPicker?: boolean;
  }>(),
  { artifactRenderers: () => [], toolRenderers: () => [], title: "", bottom: null, conversations: true, agentPicker: false },
);
const slots = useSlots();
const emit = defineEmits<{
  error: [message: string];
  featureAction: [id: string];
  openBottom: [];
  run: [change: ShellRunChange];
}>();
const agentId = defineModel<string | null>("agentId", { default: null });
const sessionId = defineModel<string | null>("sessionId", { default: null });
const display = props.display;
const taskFocus = ref<{ taskId: string; at: number } | null>(null);
const navOpen = ref(false);
const navId = useId();
const navToggle = ref<HTMLButtonElement>();
const navClose = ref<HTMLButtonElement>();
async function toggleNav() {
  if (navOpen.value) return closeNav(true);
  navOpen.value = true;
  await nextTick();
  navClose.value?.focus();
}
function closeNav(restoreFocus = false) {
  if (!navOpen.value) return;
  navOpen.value = false;
  if (restoreFocus) navToggle.value?.focus();
}
watch([sessionId, () => display.page.value?.featureId], () => closeNav(true));

/**
 * The page view's session stream, where its feed serves one: the runs this conversation starts carry the view's binding,
 * and the stream's live frames come back here. A presentation is shown only while the tab is in the foreground and this
 * is still the conversation in view; an object an agent changed is read again by the shown page only when it was changed
 * in this conversation; and a stream that is ready again has the page read everything it shows.
 */
const sessionStream = inject(pageSessionStream, null);
const conversation = useAgentConversation(
  () => props.client, () => agentId.value, () => sessionStream?.binding ?? null, () => pageSkill.value,
);
if (sessionStream) {
  onBeforeUnmount(
    sessionStream.attach({
      present: async (frame) =>
        !documentVisible()
          ? { status: "not_opened", reason: "view_unavailable", current: display.snapshot() }
          : frame.sessionId === conversation.state.sessionId
            ? display.present(frame)
            : { status: "not_opened", reason: "not_viewing_session", current: display.snapshot() },
      objectChanged: ({ session, target, affected }) => {
        if (session.sessionId === conversation.state.sessionId) display.refreshObjects(affected ? { target, affected } : { target });
      },
      ready: () => display.refreshObjects({ target: null }),
    }),
  );
}
provide(displayPlacementKey, display.placed);
const notice = inject(sessionRunNotices, null);
if (notice) watch(notice, frame => {
  if (frame?.type !== "run_started" || frame.sessionId !== conversation.state.sessionId || frame.runId in conversation.state.runs || frame.runId === conversation.activeRunId.value) return;
  void conversation.followRun(frame.runId).catch(report);
});
const nav = props.nav;
const { currentAgent } = nav;
const currentFeature = display.feature;
/**
 * The page skill of the page shown: what its own snapshot named for the instance shown, else the page's declaration. It
 * narrows who may take a message, and it travels with every message sent while that page is shown.
 */
const pageSkill = computed(() => display.pageSkill.value ?? currentFeature.value?.pageSkill ?? null);
/** A page that sits in the agent-app states rather than replacing the conversation. */
const pairedPage = computed(() => currentFeature.value?.withConversation === true);
const pageFull = computed(() => pairedPage.value && display.view.value === "full");
const openArtifact = computed(() => (display.target.value?.kind === "artifact" ? display.target.value.open : null));
/** The conversation in view has not started: no session yet, and no message on its way to make one. */
const unstarted = computed(() => !conversation.sending.value && conversation.state.sessionId === null);

provide(shellContextKey, {
  labels: toRef(props, "labels"),
  artifactRenderers: toRef(props, "artifactRenderers"),
  toolRenderers: toRef(props, "toolRenderers"),
  slots: {
    get datasetSelectionActions() {
      return slots["dataset-selection-actions"];
    },
    get artifactActions() {
      return slots["artifact-actions"];
    },
    get messageActions() {
      return slots["message-actions"];
    },
  },
  resolveArtifact: conversation.resolveArtifact,
  artifactRevision: conversation.artifactRevision,
  readArtifact: (artifact) => props.client.readArtifact(artifact),
  tasks: props.client.tasks,
  taskFocus,
  openTasks: (runId) => {
    taskRound.value = runId;
    tasksOpen.value = true;
  },
  // The side holds one thing at a time: an expanded card replaces a page beside the conversation.
  openArtifact: (open) => void display.openArtifact(open),
  openArtifactKey: computed(() => openArtifact.value?.key ?? null),
  pageLink: (href) => displayLink(display, props.pageLinks)(href),
  continueConversation: async (message) => {
    if (conversation.sending.value) throw new Error(props.labels.working);
    await send(message);
  },
  questions: conversationQuestions(conversation),
});

/**
 * The open conversation's choice whether agents ask before a panel operation, once the host told it; null for a new
 * conversation, while it is being read, and where the host offers none (a reader who does not own the conversation, a
 * conversation that cannot be the root of a panel operation). Its column shows it on the
 * conversation's row and changes it from the row's menu.
 */
const panelConfirmation = ref<{ sessionId: string; confirmBeforeExecute: boolean } | null>(null);
watch(sessionId, async (id) => {
  panelConfirmation.value = null;
  const port = props.panelOperations;
  if (!port || id === null) return;
  try {
    const confirmBeforeExecute = await port.read(id);
    if (sessionId.value === id && confirmBeforeExecute !== null) panelConfirmation.value = { sessionId: id, confirmBeforeExecute };
  } catch (error) {
    if (sessionId.value === id) report(error);
  }
}, { immediate: true });
async function setPanelConfirmation(id: string, confirm: boolean) {
  try {
    const confirmBeforeExecute = await props.panelOperations!.write(id, confirm);
    if (sessionId.value === id) panelConfirmation.value = { sessionId: id, confirmBeforeExecute };
  } catch (error) {
    report(error);
  }
}

/** The replies that delegated work, in order; a reply's own entry opens the task list at it. */
const taskRounds = computed(() => [...new Set(conversation.tasks.value?.tasks.map((task) => task.root.runId) ?? [])]);
const taskRound = ref<string | null>(null);
const tasksOpen = ref(false);
const shownRound = computed({
  get: () => (taskRound.value && taskRounds.value.includes(taskRound.value) ? taskRound.value : taskRounds.value.at(-1)!),
  set: (runId: string) => (taskRound.value = runId),
});
watch(sessionId, () => {
  tasksOpen.value = false;
  taskRound.value = null;
});

function report(error: unknown) {
  emit("error", error instanceof Error ? error.message : String(error));
}

// A new conversation writes its id while sending; that run is already open, so opening it again
// would reset the pending message and the admitted snapshot.
watch(sessionId, (id) => {
  if (id !== null && id === conversation.state.sessionId) return;
  // A card belongs to the conversation it was opened from.
  if (openArtifact.value) void display.close();
  void conversation.open(id);
}, { immediate: true });


/**
 * A conversation opened by its address names no agent, but it runs on one: the shell shows that agent in the composer and
 * sends as it, so the conversation the reader opened is the one they write in. Taken over from the host's report of the
 * conversation, not chosen by the reader, so nothing is rebound and nothing starts anew.
 */
watch(
  () => conversation.state.agentId,
  (id) => {
    if (id) nav.adoptAgent(id);
  },
);

/** The paired page that left the side last, closed or replaced by a card: the conversation's corner reopens it. */
const closedPage = shallowRef<DisplayPage | null>(null);
watch(display.page, (current, previous) => {
  if (!previous || current?.featureId === previous.featureId) return;
  if (props.workbench.features.find((feature) => feature.id === previous.featureId)?.withConversation) closedPage.value = previous;
});

/**
 * The open page's own skill narrows who may take the message: the chooser offers the agents that carry it, and the
 * page's registered default when it has one. A page without the declaration leaves the platform's whole agent list. It
 * applies from the start too: an address that opens with a page beside the conversation narrows the list the same way as
 * opening that page later does.
 */
watch(pageSkill, (page) => void nav.setPage(page).catch(report), { immediate: true });

/**
 * The agent is chosen at the head of the application's column (the user's place for it, 2026-11-06): one chooser for the
 * whole conversation, never a second one in its composers. The reader chooses only between conversations; a reply still
 * running keeps the agent it started with, so the choice waits until it ends rather than moving the running conversation
 * to another agent.
 */
function chooseAgent(id: string) {
  if (id === agentId.value) return;
  if (conversation.busy.value) {
    emit("error", props.labels.switchWhileRunning);
    return;
  }
  agentId.value = id;
}

/**
 * A panel's conversation entry on the page beside this conversation (design U18): when the agent it names is this
 * conversation's, its sentence is filled here; when it is another of the page's candidates, a new conversation starts
 * with that agent and takes the sentence, the open one keeping its own agent and the page staying open. An agent it
 * cannot name, or a run still going, only opens the composer. Nothing is sent from here.
 */
const entry = shallowRef<ComposerEntry | null>(null);
function showEntry(text: string | null) {
  entry.value = { text, seq: (entry.value?.seq ?? 0) + 1 };
}
/** An entry that arrived while the page's agents were being read; it waits for them, the latest one counting. */
let waitingEntry: PanelConversationEntry | null = null;
const expandEntry: PageComposerExpand = (request) => {
  if (nav.agentsState.value === "loading") {
    waitingEntry = request;
    return;
  }
  const named = entryAgent(request.target, nav.agents.value, nav.pageAgents.value?.defaultAgentId, nav.pageAgents.value?.presetAgentIds);
  if (!named) return showEntry(null);
  if (named === agentId.value) return showEntry(request.prefill ?? null);
  if (conversation.busy.value) {
    emit("error", props.labels.switchWhileRunning);
    return showEntry(null);
  }
  nav.beginWith(named);
  void nextTick(() => showEntry(request.prefill ?? null));
};
watch(() => nav.agentsState.value, (state) => {
  const asked = waitingEntry;
  if (state === "loading" || !asked) return;
  waitingEntry = null;
  // Read: the entry takes effect among them. Failed: it ends here, the read's error shown where it failed.
  if (state === "ready") expandEntry(asked);
});
const serveEntry = inject(servePageComposerKey, null);
const withdrawEntry = serveEntry?.(expandEntry);
onBeforeUnmount(() => withdrawEntry?.());

/** Sending from a full page brings the conversation back beside it, so the reply is visible. */
function sendFromPage(text: string) {
  void display.setView("side");
  void send(text);
}

/**
 * What the conversation's last carried message told about the target beside it, per conversation: a page's address or a
 * file's path, `""` once it said the target was closed, null for one the shell has not sent in (just opened, so its first
 * message carries the target again). A draft parameter or a fragment is the same page.
 *
 * `carriedIn` is the conversation that message went to. Sending the first message of a new conversation is not the
 * reader moving: the conversation it created is where the page was just carried, so the note stands until another
 * conversation is opened or a new one is started.
 */
const carriedPage = ref<CarriedTarget>(null);
let carriedIn: string | null = null;
watch(sessionId, (id) => {
  if (id === carriedIn) return;
  carriedPage.value = null;
  carriedIn = id;
});

const linePrompts = () => ({ page: props.labels.pageContext, pageAddress: props.labels.pageContextAddress, selection: props.labels.selectionContext });
/**
 * What a reopened conversation already carries, read when the shell first sends in it: its history shows the line each
 * message ended with, so the page or file the last such line named is known, and a message written beside that same
 * target does not name it again; a last line that said the target was closed is not said again. Two pages with one title
 * are two addresses, which is what the line names them by. A conversation whose messages name nothing names nothing here:
 * the target rides on its next message.
 */
function carried(): CarriedTarget {
  if (carriedPage.value !== null || !conversation.state.sessionId) return carriedPage.value;
  const texts = conversation.items.value.filter((item): item is UserItem => item.kind === "user").map((item) => item.text);
  return carriedTargetIn(texts, { ...linePrompts(), file: props.labels.fileContext, closed: props.labels.pageContextClosed });
}

async function send(input: string) {
  const agent = agentId.value;
  if (!agent) return;
  const page = pairedPage.value ? display.pageContext.value : null;
  const shown = display.target.value;
  const file = shown?.kind === "artifact" ? { label: shown.open.title || fileName(shown.open.artifact.path), path: shown.open.artifact.path } : null;
  // The target rides on the conversation's first message or when it changed: the reader already knows what is beside
  // them, and repeating it on every message would spend the agent's context on what changed once. A page's selection
  // rides every time.
  const told = carried();
  const carriesPage = page !== null && pageMoved(told, page);
  // A target the agent was told about and that is no longer shown is said once to be closed, so the agent does not take
  // the last one it heard of for the one in view.
  const closes = page === null && file === null && told !== null && told !== CLOSED_TARGET;
  const line = page
    ? pageContextLine(page, linePrompts(), carriesPage)
    : file
      ? (told === file.path ? "" : fileContextLine(file, props.labels.fileContext))
      : closes ? props.labels.pageContextClosed : "";
  const text = line ? `${input}\n\n${line}` : input;
  const result = await conversation.send(agent, text);
  if (!result) return;
  // Only a message the host accepted moved the conversation's page; a refused one carries it again next time. It went to
  // the conversation this send started, or to the one it was written in.
  carriedIn = result.createdSession?.id ?? conversation.state.sessionId ?? null;
  if (page) carriedPage.value = samePageAddress(page.url);
  else if (file) carriedPage.value = file.path;
  else if (closes) carriedPage.value = CLOSED_TARGET;
  if (!result.delivery) {
    // The conversation was created but its run refused: the host takes it as listed (still empty), so sending again
    // goes on in the conversation the host knows.
    void nav.loadSessions();
    sessionId.value = result.createdSession.id;
    return;
  }
  const created = result.createdSession;
  if (created) {
    // The state already carries this session; linking the id afterwards keeps the watch from opening it again and
    // discarding the pending message. A reader who opened another conversation meanwhile stays in it; the new one is
    // listed, and the notice feed reads its run state.
    nav.promoteSession(created, text);
    if (sessionId.value === null) sessionId.value = created.id;
    return;
  }
  // Sending in a conversation already listed moves it up, and titles it when the host has not yet. Its run state is the
  // feed's to read, from the admission onwards.
  const runSession = result.delivery.sessionRef.sessionId;
  const entry = nav.sessions.value.find((row) => row.id === runSession);
  if (entry) nav.promoteSession(entry, text);
}

/*
 * Tell the host what the open conversation's run is doing. A run left behind by opening another conversation is no
 * longer in the state, so only a run of this conversation reports stopping. The session list's run state is not written
 * here: the page's notice feed reads it for every listed conversation.
 */
watch(
  () => conversation.activeRunId.value,
  (current, previous) => {
    const run = previous ? conversation.state.runs[previous] : undefined;
    const session = conversation.state.sessionId;
    if (run?.status === "stopped" && session)
      emit("run", { sessionId: session, runId: run.id, status: "stopped", workspaceCommit: run.workspaceCommit });
    if (current && session) emit("run", { sessionId: session, runId: current, status: "running", workspaceCommit: null });
  },
);

/**
 * Hosts call `reloadAgents` after editing agent definitions; the column reads the same state. `send` sends a message in
 * the open conversation as the composer does, for a host that was handed the first question (a link from elsewhere).
 */
defineExpose({ reloadAgents: () => nav.loadAgents().catch(report), send });

onMounted(() => {
  // An address that names both a conversation and a paired page reopens them side by side.
  if (sessionId.value && pairedPage.value) void display.setView("side");
});
</script>

<template>
  <div class="agent-shell" :class="{ 'panel-open': openArtifact }" @keydown.esc="closeNav(true)">
    <div class="compact-nav">
      <button ref="navToggle" type="button" class="compact-nav-toggle" :aria-expanded="navOpen"
        :aria-controls="navId" @click="toggleNav">
        <PanelLeft :size="16" aria-hidden="true" />
        <span>{{ title || workbench.label || labels.sessions }}</span>
      </button>
    </div>
    <!-- The application's own column. A host with its own navigation (the agent settings) fills the slot. -->
    <div v-if="navOpen" class="compact-nav-scrim" aria-hidden="true" @click="closeNav(true)" />
    <ShellColumn :id="navId" :label="title || workbench.label" :class="{ 'compact-nav-open': navOpen }">
      <div class="compact-nav-heading">
        <span>{{ title || workbench.label || labels.sessions }}</span>
        <button ref="navClose" type="button" class="compact-nav-close" :aria-label="labels.close" @click="closeNav(true)">
          <X :size="16" aria-hidden="true" />
        </button>
      </div>
      <slot name="column">
        <ShellNavBody
          :workbench="workbench"
          :title="title"
          :agents="nav.agents.value"
          :agent-id="agentId"
          :current-agent="currentAgent"
          :sessions="nav.sessions.value"
          :sessions-state="nav.sessionsState.value"
          :has-more="nav.nextCursor.value !== null"
          :session-id="sessionId"
          :feature-id="display.page.value?.featureId ?? null"
          :bottom="bottom"
          :conversations="conversations"
          :panel-confirmation="panelConfirmation"
          :agent-picker="agentPicker"
          :labels="labels"
          @new-conversation="nav.startNew(); closeNav(true)"
          @select-feature="display.openFeature($event)"
          @feature-action="emit('featureAction', $event)"
          @select-agent="chooseAgent"
          @select-session="nav.selectSession($event)"
          @delete-session="(id) => nav.removeSession(id).catch(report)"
          @rename-session="(id, title) => nav.renameSession(id, title).catch(report)"
          @set-panel-confirmation="setPanelConfirmation"
          @open-bottom="emit('openBottom')"
          @load-more="void nav.loadSessions(true)"
          @retry="void nav.loadSessions()"
        />
      </slot>
    </ShellColumn>

    <main v-show="!pageFull" class="shell-main">
      <button
        v-if="closedPage && !display.target.value"
        type="button"
        class="reopen-page"
        :title="labels.open"
        :aria-label="labels.open"
        @click="display.reopen(closedPage)"
      >
        <PanelRightOpen :size="16" />
      </button>
      <TaskDrawer
        v-if="tasksOpen && (!display.page.value || pairedPage) && conversation.tasks.value && taskRounds.length"
        v-model:run-id="shownRound"
        :snapshot="conversation.tasks.value"
        :rounds="taskRounds"
        @locate="taskFocus = { taskId: $event, at: Date.now() }"
        @close="tasksOpen = false"
      />
      <div v-if="display.page.value && !pairedPage" class="feature-page">
        <slot name="feature" :feature-id="display.page.value.featureId" view="full" />
      </div>
      <ShellConversation
        v-else
        :items="conversation.items.value"
        :session-id="sessionId"
        :agent="currentAgent"
        :loading="conversation.loading.value"
        :load-error="conversation.loadError.value"
        :has-older="conversation.olderCursor.value !== null"
        :loading-older="conversation.loadingOlder.value"
        :older-error="conversation.olderError.value"
        :history-revision="conversation.historyRevision.value"
        :send-error="conversation.sendError.value"
        :pending-input="conversation.pendingInput.value"
        :busy="conversation.busy.value"
        :sending="conversation.sending.value"
        :entry="entry"
        :feedback="feedback"
        @send="send"
        @stop="conversation.cancel"
        @retry="conversation.open(sessionId)"
        @load-older="conversation.loadOlder"
      >
        <template v-if="slots['composer-context']" #composer-context>
          <slot name="composer-context" :page-open="pairedPage" :inline="false" :unstarted="unstarted" />
        </template>
      </ShellConversation>
    </main>

    <ShellPagePane
      v-if="display.page.value && pairedPage"
      :feature="currentFeature"
      :view="display.view.value"
      :busy="conversation.busy.value"
      :sending="conversation.sending.value"
      :entry="entry"
      :disabled="!currentAgent?.enabled"
      @send="sendFromPage"
      @stop="conversation.cancel"
      @expand="display.setView('full')"
      @collapse="display.setView('side')"
      @close="display.close()"
    >
      <template v-if="slots['page-header']" #header>
        <slot name="page-header" :feature-id="display.page.value.featureId" :view="display.view.value" />
      </template>
      <template v-if="slots['composer-context']" #composer-context>
        <slot name="composer-context" :page-open="true" :inline="true" :unstarted="unstarted" />
      </template>
      <slot name="feature" :feature-id="display.page.value.featureId" :view="display.view.value" />
    </ShellPagePane>

    <ShellSidePanel v-if="openArtifact" :open="openArtifact" @close="display.close()" @loaded="display.loaded" />
  </div>
</template>

<style scoped>
/*
 * The conversation application, filling the surface the platform gives it: its own column, then the conversation on one
 * flat area, no gutter, no border and no shadow of its own (DESIGN.md "Applications and shells"). Its composer is raised.
 */
.agent-shell {
  position: relative;
  --shell-composer-shadow: var(--elevation-composer);
  display: flex;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-family: var(--font-sans, inherit);
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
/* The conversation's ground is the application's own area, the page tone; what fades into it fades into that. */
.shell-main {
  --shell-conversation-ground: var(--el-bg-color-page);
  /* The task list's own width, the room the conversation leaves it while it is open. */
  --shell-task-drawer-width: min(320px, 100%);
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
/* The task list is a column of its own, not a layer over the composer: the conversation keeps the rest of the width. */
.shell-main:has(> .task-drawer) {
  padding-right: var(--shell-task-drawer-width);
}
/* In the corner the page's close button left, over the conversation. */
.reopen-page {
  position: absolute;
  z-index: 2;
  top: var(--spacing-md);
  right: var(--spacing-md);
  display: grid;
  place-items: center;
  width: var(--control-height);
  height: var(--control-height);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.reopen-page:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.reopen-page:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
.feature-page {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.compact-nav, .compact-nav-heading, .compact-nav-scrim { display: none; }
@media (max-width: 760px) {
  .agent-shell { flex-direction: column; }
  .compact-nav {
    display: flex;
    flex: none;
    padding: var(--spacing-xs) var(--spacing-sm);
    border-bottom: 1px solid var(--el-border-color);
    background: var(--shell-panel-bg);
  }
  .compact-nav-toggle {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    max-width: 100%;
    min-height: var(--control-height);
    padding: 0 var(--spacing-sm);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .compact-nav-toggle:hover { background: var(--shell-panel-hover); }
  .compact-nav-toggle > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .compact-nav-toggle > svg { flex: none; }
  .compact-nav-scrim { display: block; position: absolute; inset: 0; z-index: 19; background: var(--el-overlay-color-lighter); }
  .agent-shell > :deep(.shell-column) {
    display: none;
    position: absolute;
    z-index: 20;
    inset-block: 0;
    inset-inline-start: 0;
    width: min(280px, calc(100% - 24px));
    overflow: auto;
    border-inline-end: 1px solid var(--el-border-color);
    box-shadow: var(--elevation-overlay);
  }
  .agent-shell > :deep(.shell-column.compact-nav-open) { display: flex; animation: compact-nav-in var(--transition-base) both; }
  .compact-nav-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-sm); flex: none; margin-bottom: var(--spacing-sm); font-weight: var(--font-semibold); }
  .compact-nav-close { display: grid; place-items: center; flex: none; width: var(--control-height); height: var(--control-height); padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--el-text-color-secondary); cursor: pointer; }
  .compact-nav-close:hover { background: var(--shell-panel-hover); }
  .shell-main { min-height: 0; }
}
@keyframes compact-nav-in {
  from { opacity: 0; translate: -8px 0; }
  to { opacity: 1; translate: 0 0; }
}
@media (prefers-reduced-motion: reduce) {
  .agent-shell > :deep(.shell-column.compact-nav-open) { animation: none; }
}
</style>
