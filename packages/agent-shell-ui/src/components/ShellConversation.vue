<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowDown, CircleAlert, Clock } from "lucide-vue-next";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { ShellFeedbackPort } from "../types";
import { shellContextKey } from "../context";
import type { ConversationItem } from "../view";
import ShellComposer from "./ShellComposer.vue";
import type { ComposerEntry } from "../page-composer-entry";
import { writtenText } from "../page-context";
import ShellQuestions from "./ShellQuestions.vue";
import ShellResponse from "./ShellResponse.vue";
import AgentAvatar from "./AgentAvatar.vue";
import QuestionAnswer from "./QuestionAnswer.vue";

const props = defineProps<{
  items: ConversationItem[];
  sessionId: string | null;
  agent: AgentHostAgent | null;
  loading: boolean;
  loadError: string | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderError: string | null;
  historyRevision: number;
  sendError: string | null;
  pendingInput: string | null;
  revealLatestInput?: number;
  customInput?: (text: string) => boolean;
  busy: boolean;
  /** A panel's conversation entry for the composer here; see ShellComposer. */
  entry?: ComposerEntry | null;
  /** A message is on its way: the composer holds the next one until it has arrived. */
  sending: boolean;
  feedback?: ShellFeedbackPort;
  collapsed?: boolean;
  greeting?: string;
  description?: string;
}>();
const emit = defineEmits<{ send: [text: string]; stop: []; retry: []; loadOlder: []; expand: [] }>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value);
/** The reader's message as written: the page or file line it carries is the agent's, not shown in the bubble. */
const written = (text: string) => writtenText(text, {
  page: labels.value.pageContext,
  pageAddress: labels.value.pageContextAddress,
  selection: labels.value.selectionContext,
  highlight: labels.value.highlightContext,
  state: labels.value.stateContext,
  forms: labels.value.formsContext,
  file: labels.value.fileContext,
  closed: labels.value.pageContextClosed,
});

const scroller = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
/** Blank room under the thread, so the pinned turn can reach the top while its reply is still short. */
const room = ref<HTMLElement | null>(null);
/** The reader is at the bottom; otherwise the way back to the latest content shows. */
const stick = ref(true);
/**
 * The reader started a turn here: it stays where sending put it, its question at the top with the reply growing under
 * it, and the view no longer follows the tail. Opening a conversation clears it.
 */
const pinned = ref(false);
/** The message on its way starts a new turn: it was sent while nothing ran, so it is not an input to a running reply. */
const pendingTurn = ref(false);
let observer: ResizeObserver | null = null;
let lastScrollTop = 0;
/** The gap left above the pinned question, the thread's own top padding. */
const PIN_GAP = 24;
const PENDING = "pending";

const empty = computed(
  () => !props.loading && !props.loadError && props.items.length === 0 && !props.pendingInput,
);
const lastItem = computed(() => props.items.at(-1));
/** A run is admitted but has produced no assistant message yet. */
const waiting = computed(
  () => props.busy && (props.pendingInput !== null || (lastItem.value?.kind === "user" && !lastItem.value.queued)),
);
const lastUserKey = computed(() => [...props.items].reverse().find((item) => item.kind === "user")?.key ?? null);
/** The question at the top of the latest turn, once the reader started one here. */
const pinTarget = computed(() => {
  if (!pinned.value) return null;
  return pendingTurn.value && props.pendingInput !== null ? PENDING : lastUserKey.value;
});

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  const upward = el.scrollTop < lastScrollTop;
  lastScrollTop = el.scrollTop;
  atBottom();
  if (upward && el.scrollTop < 80 && props.hasOlder && !props.loadingOlder && !props.olderError)
    requestOlder();
}

function atBottom() {
  const el = scroller.value;
  if (el) stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function requestOlder() {
  stick.value = false;
  emit("loadOlder");
}

watch(() => props.historyRevision, async (revision) => {
  const el = scroller.value, session = props.sessionId;
  if (!el || revision === 0 || stick.value) return;
  // Capture immediately before the prepend renders, not before its network request.
  const height = el.scrollHeight, top = el.scrollTop;
  stick.value = false;
  await nextTick();
  if (session === props.sessionId) {
    el.scrollTop = top + el.scrollHeight - height;
    lastScrollTop = el.scrollTop;
  }
}, { flush: "pre" });

function toBottom(smooth = false) {
  const el = scroller.value;
  if (el) {
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    if (!smooth) lastScrollTop = el.scrollTop;
  }
}

/** Sizes the room under the thread so the pinned question can sit at the top; it shrinks as the reply grows. */
function measureRoom() {
  const el = scroller.value, thread = content.value, spacer = room.value;
  if (!el || !thread || !spacer) return;
  const target = pinTarget.value ? thread.querySelector<HTMLElement>("[data-pin]") : null;
  const below = target ? thread.getBoundingClientRect().bottom - target.getBoundingClientRect().top : 0;
  spacer.style.height = target ? `${Math.max(0, el.clientHeight - PIN_GAP - below)}px` : "0px";
}

/** Puts the pinned question at the top of the view. */
function pin() {
  const el = scroller.value, target = content.value?.querySelector<HTMLElement>("[data-pin]");
  if (!el || !target) return;
  measureRoom();
  el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - PIN_GAP;
  lastScrollTop = el.scrollTop;
  atBottom();
}

onMounted(() => {
  // The tail is followed only while an opened conversation lays out, never while a run adds to it or after the reader
  // started a turn here.
  observer = new ResizeObserver(() => {
    measureRoom();
    if (stick.value && !pinned.value && !props.busy) toBottom();
    atBottom();
  });
  if (content.value) observer.observe(content.value);
  if (scroller.value) observer.observe(scroller.value);
});
onBeforeUnmount(() => observer?.disconnect());

// The empty/conversation branch can replace these elements after the component has mounted.
watch([content, scroller], ([el, outer], [previous, previousOuter]) => {
  if (previous) observer?.unobserve(previous);
  if (previousOuter) observer?.unobserve(previousOuter);
  if (el) observer?.observe(el);
  if (outer) observer?.observe(outer);
}, { flush: "post" });

/**
 * Opening a conversation or starting a new one starts the view over. A first message's conversation getting its id does
 * not: the reader is still in it.
 */
function startOver() {
  pinned.value = false;
  stick.value = true;
  lastScrollTop = 0;
}
watch(() => props.sessionId, (id) => id === null && startOver());
watch(() => props.loading, (loading) => loading && startOver());

watch([() => props.sessionId, () => props.loading], ([, loading]) => {
  if (loading || props.loadError || pinned.value) return;
  // Opening positions the freshly rendered tail; older-page prepends use historyRevision instead.
  stick.value = true;
  toBottom();
}, { flush: "post" });

watch(() => props.pendingInput, (text) => {
  if (text === null) pendingTurn.value = false;
});

// A new question at the end, the sent message or one that arrived as a new turn, takes the top of the view.
watch(lastUserKey, (key, previous) => {
  if (pinned.value && key !== null && key !== previous) pin();
}, { flush: "post" });

watch(() => props.revealLatestInput, async () => {
  pinned.value = true;
  await nextTick();
  pin();
}, { flush: "post" });

/** A message sent while nothing runs starts a turn and takes the top; one sent into a running reply joins its process. */
function expandFromComposer(event: MouseEvent) {
  if (props.collapsed && event.target instanceof HTMLElement && !event.target.closest("button")) emit("expand");
}

async function send(text: string) {
  if (props.collapsed) emit("expand");
  const starts = !props.busy;
  if (starts) {
    pinned.value = true;
    pendingTurn.value = true;
  }
  emit("send", text);
  if (!starts) return;
  await nextTick();
  pin();
}
</script>

<template>
  <div class="conversation">
    <div v-if="empty && !collapsed" class="empty">
      <div class="empty-inner" :class="{ 'custom-welcome': $slots.welcome }">
        <slot name="welcome" :agent="agent">
          <div v-if="agent" class="empty-agent">
            <AgentAvatar :icon="agent.icon" :size="36" />
            <span>{{ agent.name }}</span>
          </div>
          <h1 class="greeting">{{ greeting ?? labels.greeting }}</h1>
          <p v-if="description ?? agent?.description" class="agent-description">{{ description ?? agent?.description }}</p>
        </slot>
        <ShellQuestions />
        <div v-if="$slots['composer-context']" class="composer-context"><slot name="composer-context" /></div>
        <ShellComposer :busy="busy" :sending="sending" :disabled="!agent?.enabled" autofocus :labels="labels" :entry="entry" @send="send" @stop="emit('stop')" />
        <p v-if="sendError" class="send-error" role="alert"><CircleAlert :size="14" />{{ sendError }}</p>
      </div>
    </div>
    <template v-else>
      <div
         v-show="!collapsed"
         ref="scroller"
         class="scroller"
        :class="{ 'initial-load-error': loadError && !loading && !items.length && pendingInput === null }"
        @scroll.passive="onScroll"
      >
        <div ref="content" class="thread">
          <div v-if="hasOlder && !loading" class="history-more">
            <span v-if="olderError" role="alert">{{ labels.loadFailed }}</span>
            <button type="button" :disabled="loadingOlder" @click="requestOlder">
              {{ loadingOlder ? labels.loading : olderError ? labels.retry : labels.more }}
            </button>
          </div>
          <div v-if="loading && !items.length" class="thread-loading" aria-busy="true">
            <span class="line w60" /><span class="line w90" /><span class="line w75" />
          </div>
          <div v-else-if="!loading && loadError" class="load-error" role="alert">
            <CircleAlert :size="16" aria-hidden="true" />
            <span>{{ labels.loadFailed }}</span>
            <button type="button" @click="emit('retry')">{{ labels.retry }}</button>
          </div>
          <template v-for="item in items" :key="item.key">
            <div v-if="item.kind === 'user'" class="user-turn" :class="{ queued: item.queued }" :data-pin="item.key === pinTarget || undefined">
              <div v-if="item.answer" class="user-bubble">
                <QuestionAnswer :text="written(item.text)" :question="item.question" />
              </div>
              <slot v-else-if="customInput?.(written(item.text))" name="input" :input-id="item.key" :text="written(item.text)" :queued="Boolean(item.queued)" />
              <div v-else class="user-bubble">{{ written(item.text) }}</div>
              <div v-if="item.queued" class="user-queued" role="status" aria-live="polite">
                <Clock :size="12" aria-hidden="true" />
                <span>{{ labels.queuedWaiting }}</span>
              </div>
            </div>
            <div v-else-if="item.kind === 'notification'" class="agent-notification" :class="{ failed: item.error }" :role="item.error ? 'alert' : 'note'"><CircleAlert :size="14" /><span>{{ item.text }}</span></div>
            <ShellResponse v-else :item="item" :session-id="sessionId" :feedback="feedback" />
          </template>
          <div v-if="pendingInput !== null" class="user-turn" :data-pin="pinTarget === PENDING || undefined">
            <slot v-if="customInput?.(written(pendingInput))" name="input" :input-id="null" :text="written(pendingInput)" :queued="false" />
            <div v-else class="user-bubble pending">{{ written(pendingInput) }}</div>
          </div>
          <div v-if="waiting" class="waiting" aria-live="polite" :aria-label="labels.working">
            <span class="dot" /><span class="dot" /><span class="dot" />
          </div>
        </div>
        <div ref="room" aria-hidden="true" />
      </div>
      <div class="dock" :class="{ compact: collapsed }">
        <button
          v-if="!collapsed && !stick"
          type="button"
          class="to-bottom"
          :aria-label="labels.scrollToBottom"
          @click="toBottom(true)"
        >
          <ArrowDown :size="16" />
        </button>
        <p v-if="sendError" class="send-error" role="alert"><CircleAlert :size="14" />{{ sendError }}</p>
        <ShellQuestions />
        <div v-if="$slots['composer-context']" class="composer-context"><slot name="composer-context" /></div>
        <div @click="expandFromComposer">
          <ShellComposer :busy="busy" :sending="sending" :disabled="!agent?.enabled" :min-lines="collapsed ? 1 : undefined" :labels="labels" :entry="entry" @send="send" @stop="emit('stop')" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.agent-notification { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; margin: 12px 0; border-left: 2px solid var(--el-color-info); color: var(--el-text-color-secondary); font-size: var(--text-sm); white-space: pre-wrap; }
.agent-notification.failed { border-color: var(--el-color-danger); color: var(--el-color-danger); }
.agent-notification svg { flex-shrink: 0; margin-top: 3px; }
.conversation {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.empty-inner {
  width: min(100%, 720px);
  margin-top: -8vh;
}
.empty-inner.custom-welcome {
  max-inline-size: 520px;
  margin-block-start: 0;
}
.empty:has(> .custom-welcome) {
  min-block-size: 0;
  overflow-y: auto;
  align-items: safe center;
}
.custom-welcome :deep(.composer) {
  border-radius: 14px;
  box-shadow: none;
}
.custom-welcome :deep(.composer-body) { padding: 10px 14px; }
@container (min-width: 420px) {
  .custom-welcome :deep(.composer-body) { flex-direction: row; align-items: center; }
  .custom-welcome :deep(.composer-body textarea) { flex: 1 1 auto; }
  .custom-welcome :deep(.composer-controls) { flex: none; }
}
.empty-agent { display: flex; align-items: center; justify-content: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-md); color: var(--el-text-color-secondary); font-size: var(--text-sm); }
.empty-agent span:last-child { min-width: 0; overflow-wrap: anywhere; }
.greeting {
  margin: 0 0 8px;
  text-align: center;
  font-size: var(--text-3xl);
  line-height: var(--leading-3xl);
  font-weight: 600;
  letter-spacing: var(--tracking-display);
  color: var(--el-text-color-primary);
}
.agent-description {
  margin: 0 auto 24px;
  max-width: 520px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
.scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
/* Answers are `reading` text on the reading column (DESIGN.md "Typography", "Chat answer"). */
.thread {
  width: min(100% - 48px, var(--shell-content-max));
  margin: 0 auto;
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  gap: var(--conversation-message-gap);
  color: var(--el-text-color-primary);
  font-size: var(--text-reading);
  line-height: var(--leading-reading);
}
.history-more {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.history-more button {
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.history-more button:disabled { cursor: default; }
.user-turn {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}
.user-queued {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
/* A new question starts a new visual group; streaming and pending messages keep the same geometry. */
.thread > .response + .user-turn {
  margin-top: calc(var(--conversation-turn-gap) - var(--conversation-message-gap));
}
/* The question: a right-aligned sunken bubble. */
.user-bubble {
  max-width: min(85%, 620px);
  padding: 8px 14px;
  border-radius: var(--radius-lg);
  background: var(--chat-user-bubble, var(--el-fill-color));
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.user-bubble.pending {
  opacity: 0.7;
}
.waiting {
  display: flex;
  gap: 5px;
  padding: 4px 2px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  animation: pulse 1.2s ease-in-out infinite;
}
.dot:nth-child(2) {
  animation-delay: 0.15s;
}
.dot:nth-child(3) {
  animation-delay: 0.3s;
}
.thread-loading {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.line {
  height: 14px;
  border-radius: var(--radius-sm);
  background: var(--el-fill-color);
}
.w60 {
  width: 60%;
}
.w90 {
  width: 90%;
}
.w75 {
  width: 75%;
}
.load-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  color: var(--el-color-danger-text, var(--el-color-danger));
  font-size: var(--text-sm);
}
.initial-load-error .thread {
  box-sizing: border-box;
  min-block-size: 100%;
  justify-content: center;
}
.initial-load-error .load-error { justify-content: center; text-align: center; }
.load-error button {
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}
.dock {
  position: relative;
  width: min(100% - 48px, var(--shell-content-max));
  margin: 0 auto;
  padding: 0 0 var(--shell-composer-foot);
}
/*
 * Content scrolling under the composer fades out instead of being cut, into whatever the conversation sits on: the
 * application's area in the agent shell (in dark mode darker than a surface), a dialog's surface elsewhere.
 */
.dock.compact { padding-bottom: 0; }
.dock.compact::before { display: none; }
.dock::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -28px;
  height: 28px;
  background: linear-gradient(to bottom, transparent, var(--shell-conversation-ground, var(--el-bg-color)));
  pointer-events: none;
}
.to-bottom {
  position: absolute;
  top: -48px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  place-items: center;
  width: var(--control-height);
  height: var(--control-height);
  border: 0;
  border-radius: var(--radius-full);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-regular);
  box-shadow: var(--elevation-overlay);
  cursor: pointer;
}
.send-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px 12px;
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
/* The host's line about what a message carries; the composer under it keeps its own geometry. */
.composer-context {
  margin: 0 0 8px;
}
.composer-context:empty {
  display: none;
}
.empty .send-error {
  margin-top: 10px;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.85);
  }
  50% {
    opacity: 0.9;
    transform: scale(1);
  }
}
@media (max-width: 700px) {
  .thread,
  .dock {
    width: calc(100% - 28px);
  }
  .greeting {
    font-size: var(--text-2xl);
  }
}
</style>
