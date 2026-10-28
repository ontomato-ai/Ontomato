<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowDown, CircleAlert } from "lucide-vue-next";
import type { HostAgent } from "../host";
import type { ShellFeedbackPort } from "../types";
import { shellContextKey } from "../context";
import type { ConversationItem } from "../view";
import ShellComposer from "./ShellComposer.vue";
import ShellResponse from "./ShellResponse.vue";

const props = defineProps<{
  items: ConversationItem[];
  sessionId: string | null;
  agent: HostAgent | null;
  loading: boolean;
  loadError: string | null;
  sendError: string | null;
  pendingInput: string | null;
  busy: boolean;
  feedback?: ShellFeedbackPort;
}>();
const emit = defineEmits<{ send: [text: string]; stop: []; retry: [] }>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value);

const scroller = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const stick = ref(true);
let observer: ResizeObserver | null = null;

const empty = computed(
  () => !props.loading && !props.loadError && props.items.length === 0 && !props.pendingInput,
);
const lastItem = computed(() => props.items.at(-1));
/** A run is admitted but has produced no assistant message yet. */
const waiting = computed(
  () => props.busy && (props.pendingInput !== null || lastItem.value?.kind === "user"),
);

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function toBottom(smooth = false) {
  const el = scroller.value;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

onMounted(() => {
  // Follow new content once per layout change, only while the reader is already at the bottom.
  observer = new ResizeObserver(() => {
    if (stick.value) toBottom();
  });
  if (content.value) observer.observe(content.value);
});
onBeforeUnmount(() => observer?.disconnect());

watch(
  () => props.sessionId,
  () => {
    stick.value = true;
  },
);

function send(text: string) {
  stick.value = true;
  emit("send", text);
}
</script>

<template>
  <div class="conversation">
    <div v-if="empty" class="empty">
      <div class="empty-inner">
        <h1 class="greeting">{{ labels.greeting }}</h1>
        <p v-if="agent?.description" class="agent-description">{{ agent.description }}</p>
        <ShellComposer :busy="busy" :disabled="!agent?.enabled" autofocus @send="send" @stop="emit('stop')" />
        <p v-if="sendError" class="send-error" role="alert"><CircleAlert :size="14" />{{ sendError }}</p>
      </div>
    </div>
    <template v-else>
      <div ref="scroller" class="scroller" @scroll.passive="onScroll">
        <div ref="content" class="thread">
          <div v-if="loading" class="thread-loading" aria-busy="true">
            <span class="line w60" /><span class="line w90" /><span class="line w75" />
          </div>
          <div v-else-if="loadError" class="load-error" role="alert">
            <CircleAlert :size="16" />
            <span>{{ labels.loadFailed }}</span>
            <button type="button" @click="emit('retry')">{{ labels.retry }}</button>
          </div>
          <template v-for="item in items" :key="item.key">
            <div v-if="item.kind === 'user'" class="user-turn">
              <div class="user-bubble">{{ item.text }}</div>
            </div>
            <ShellResponse v-else :item="item" :session-id="sessionId" :feedback="feedback" />
          </template>
          <div v-if="pendingInput !== null" class="user-turn">
            <div class="user-bubble pending">{{ pendingInput }}</div>
          </div>
          <div v-if="waiting" class="waiting" aria-live="polite" :aria-label="labels.working">
            <span class="dot" /><span class="dot" /><span class="dot" />
          </div>
        </div>
      </div>
      <div class="dock">
        <button
          v-if="!stick"
          type="button"
          class="to-bottom"
          :aria-label="labels.scrollToBottom"
          @click="toBottom(true)"
        >
          <ArrowDown :size="16" />
        </button>
        <p v-if="sendError" class="send-error" role="alert"><CircleAlert :size="14" />{{ sendError }}</p>
        <ShellComposer :busy="busy" :disabled="!agent?.enabled" @send="send" @stop="emit('stop')" />
      </div>
    </template>
  </div>
</template>

<style scoped>
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
.greeting {
  margin: 0 0 8px;
  text-align: center;
  font-size: var(--text-3xl, 30px);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--el-text-color-primary);
}
.agent-description {
  margin: 0 auto 28px;
  max-width: 520px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: var(--text-base, 15px);
  line-height: 1.6;
}
.scroller {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.thread {
  width: min(100% - 48px, 760px);
  margin: 0 auto;
  padding: 28px 0 24px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  color: var(--el-text-color-primary);
  font-size: var(--text-base, 15px);
  line-height: 1.7;
}
.user-turn {
  display: flex;
  justify-content: flex-end;
}
.user-bubble {
  max-width: min(85%, 620px);
  padding: 10px 16px;
  border-radius: 20px 20px 6px 20px;
  background: var(--el-fill-color-dark);
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
  border-radius: 7px;
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
  gap: 8px;
  color: var(--el-color-danger);
  font-size: var(--text-sm, 13px);
}
.load-error button {
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}
.dock {
  position: relative;
  width: min(100% - 48px, 760px);
  margin: 0 auto;
  padding: 0 0 18px;
}
/* Content scrolling under the composer fades out instead of being cut. */
.dock::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -28px;
  height: 28px;
  background: linear-gradient(to bottom, transparent, var(--el-bg-color));
  pointer-events: none;
}
.to-bottom {
  position: absolute;
  top: -48px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--el-border-color);
  border-radius: 50%;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  box-shadow: var(--el-shadow-sm);
  cursor: pointer;
}
.send-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px 12px;
  color: var(--el-color-danger);
  font-size: var(--text-sm, 13px);
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
    font-size: var(--text-2xl, 24px);
  }
}
</style>
