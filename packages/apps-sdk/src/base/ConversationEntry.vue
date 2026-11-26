<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  AgentPicker,
  ShellComposer,
  entryAgent,
  servePageComposerKey,
  usePageCounter,
  type AgentHostAgent,
  type ComposerEntry,
  type PageComposerExpand,
} from "@ontomato/agent-shell-ui";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import { usePanelContext, useProjectionSlot } from "../panel/context";

/**
 * Generic conversation entry (U18):
 * - `presentation="button"` (default): renders a button bound to the projection's `conversationEntry` that asks the
 *   host to expand the page's composer with the declared agent target and optional opening sentence, never sending.
 * - `presentation="inline"`: embeds the platform's own inline composer (`ShellComposer` + `AgentPicker`) directly inside
 *   the page (paired with `pageComposer: "none"` on the application entry to avoid a duplicate bottom composer) and
 *   registers itself via `servePageComposerKey` so sibling `ConversationEntry` triggers expand and prefill it.
 */
const props = withDefaults(
  defineProps<{
    /** Visual presentation: `"button"` opens the page composer; `"inline"` renders the composer in place. */
    presentation?: "button" | "inline";
    /** Optional panel message key for the button label (resolved via `panel.t`; falls back to projection name). */
    labelKey?: string;
    /** Optional panel message key for the inline composer placeholder. */
    placeholderKey?: string;
    /** Minimum visible text rows for the inline composer. */
    minLines?: number;
    /** When true in inline mode, passes the current page address to the counter so it stays docked beside the chat. */
    attachPage?: boolean;
    /** Button visual emphasis (used in `"button"` presentation). */
    type?: "primary" | "default";
    /** Optional leading icon on the button (`book-open` for knowledge/guide entries). */
    icon?: "book-open";
    /** Disables the entry control. */
    disabled?: boolean;
    prefill?: string;
  }>(),
  {
    presentation: "button",
    labelKey: undefined,
    placeholderKey: undefined,
    minLines: 3,
    attachPage: false,
    type: "default",
    icon: undefined,
    disabled: false,
  },
);

const emit = defineEmits<{
  /** Emitted after the host accepts the request to expand the page's composer. */
  expanded: [];
  /** Emitted after the reader submits a message from the inline composer. */
  sent: [text: string];
  /** Emitted when the projection lacks a declared conversationEntry or a host/counter operation fails. */
  error: [error: Error];
}>();

defineSlots<{
  /**
   * The inline composer's agent picker: a page whose own composer skin differs supplies its picker here, and the entry
   * draws the standard pill picker when none is given.
   */
  "agent-picker"?(props: {
    agents: readonly AgentHostAgent[];
    agentId: string | null;
    label: string;
    select: (id: string) => void;
  }): unknown;
}>();

const { t } = useI18n();
const panel = usePanelContext();
const slot = useProjectionSlot();
const counter = usePageCounter();
const serve = inject(servePageComposerKey, null);

const opening = ref(false);
const failure = shallowRef<Error | null>(null);

const buttonLabel = computed(() => {
  if (props.labelKey) return panel.t(props.labelKey);
  if (slot.projection.name) return slot.projection.name;
  return t("platform.conversationEntryOpen");
});

async function openComposer(event: MouseEvent) {
  if (props.disabled || opening.value) return;
  failure.value = null;
  const entry = slot.projection.conversationEntry;
  if (!entry) {
    const err = new Error(`The projection in slot '${slot.slot}' declares no conversationEntry`);
    failure.value = err;
    emit("error", err);
    return;
  }
  opening.value = true;
  try {
    // The panel's text answers the key itself where neither the reader's language nor the default has words for it:
    // the composer then opens with no sentence, never with the key.
    const keyed = entry.prefillKey !== undefined ? panel.t(entry.prefillKey) : undefined;
    const prefill = props.prefill ?? (keyed === entry.prefillKey ? undefined : keyed) ?? entry.prefill;
    await panel.expandPageComposer({
      slot: slot.slot,
      target: entry.target,
      ...(entry.submit !== undefined ? { submit: entry.submit } : {}),
      ...(entry.newSession !== undefined ? { newSession: entry.newSession } : {}),
      ...(prefill !== undefined ? { prefill } : {}),
    }, event);
    emit("expanded");
  } catch (reason: unknown) {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    failure.value = err;
    emit("error", err);
  } finally {
    opening.value = false;
  }
}

// Inline composer state (active only when `presentation === "inline"`).
const agents = ref<readonly AgentHostAgent[]>([]);
const chosen = ref<string | null>(null);
const readingAgents = ref(false);
const inlineEntry = shallowRef<ComposerEntry | null>(null);
let pendingExpand: PanelConversationEntry | null = null;
let loadSeq = 0;
let newSession = false;

const inlinePlaceholder = computed(() => {
  if (props.placeholderKey) {
    const translated = panel.t(props.placeholderKey);
    if (translated !== props.placeholderKey) return translated;
  }
  return t("assistant.placeholder");
});

const inlineLabels = computed(() => ({
  placeholder: inlinePlaceholder.value,
  send: t("assistant.send"),
  stop: t("assistant.stop"),
  agent: t("assistant.agent"),
}));

const activeAgentId = computed(() => chosen.value ?? agents.value[0]?.id ?? null);

const expandInline: PageComposerExpand = async (request) => {
  if (readingAgents.value) {
    pendingExpand = request;
    return;
  }
  const named = entryAgent(request.target, agents.value, null, undefined);
  newSession = named !== null && request.newSession === true;
  if (named) chosen.value = named;
  const text = request.prefill?.trim();
  if (named && request.submit && text) {
    await sendInline(text, true);
    return;
  }
  inlineEntry.value = { text: request.prefill ?? (newSession ? "" : null), seq: (inlineEntry.value?.seq ?? 0) + 1 };
};

watch(
  () => props.presentation,
  (mode) => {
    const seq = ++loadSeq;
    agents.value = [];
    chosen.value = null;
    pendingExpand = null;
    newSession = false;
    readingAgents.value = false;
    if (mode !== "inline" || !counter) return;
    readingAgents.value = true;
    void counter
      .agents()
      .then((list) => {
        if (seq !== loadSeq) return;
        agents.value = list.filter((agent) => agent.enabled);
        const offered = (id: string | null | undefined) => agents.value.some((agent) => agent.id === id);
        const declaredTarget = slot.projection.conversationEntry?.target;
        const declaredId = declaredTarget?.kind === "id" && offered(declaredTarget.id) ? declaredTarget.id : null;
        const remembered = offered(counter.preferredAgentId.value) ? counter.preferredAgentId.value : null;
        chosen.value = declaredId ?? remembered ?? agents.value[0]?.id ?? null;
        readingAgents.value = false;
        const waiting = pendingExpand;
        pendingExpand = null;
        if (waiting && agents.value.length) void nextTick(() => expandInline(waiting));
      })
      .catch((reason: unknown) => {
        if (seq !== loadSeq) return;
        readingAgents.value = false;
        pendingExpand = null;
        const err = reason instanceof Error ? reason : new Error(String(reason));
        failure.value = err;
        emit("error", err);
      });
  },
  { immediate: true },
);

let withdrawComposer: (() => void) | null = null;
watch(
  () => props.presentation === "inline" && (readingAgents.value || agents.value.length > 0),
  (serving) => {
    withdrawComposer?.();
    withdrawComposer = serving && serve ? serve(expandInline) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => withdrawComposer?.());

async function sendInline(text: string, submit = false) {
  if (props.disabled || !counter || !activeAgentId.value) return;
  const pageAddress = props.attachPage ? panel.instance.pageContext.value.url : undefined;
  try {
    if (submit || newSession) await counter.ask(activeAgentId.value, text, pageAddress, { submit: true, newSession });
    else await counter.ask(activeAgentId.value, text, pageAddress);
    newSession = false;
    emit("sent", text);
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    failure.value = error;
    emit("error", error);
  }
}
</script>

<template>
  <div v-if="presentation === 'inline'" class="sdk-conversation-entry sdk-conversation-entry-inline">
    <ShellComposer
      v-if="agents.length"
      :busy="false"
      :disabled="disabled || !activeAgentId"
      :min-lines="minLines"
      :labels="inlineLabels"
      :entry="inlineEntry"
      @send="sendInline"
    >
      <template #agent>
        <slot
          name="agent-picker"
          :agents="agents"
          :agent-id="activeAgentId"
          :label="inlineLabels.agent"
          :select="(id: string) => (chosen = id)"
        >
          <AgentPicker
            variant="pill"
            :agents="agents"
            :agent-id="activeAgentId"
            :label="inlineLabels.agent"
            @select="chosen = $event"
          />
        </slot>
      </template>
    </ShellComposer>
    <p v-if="failure" role="alert" class="sdk-conversation-entry-error">{{ failure.message }}</p>
  </div>
  <div v-else class="sdk-conversation-entry">
    <button
      type="button"
      class="sdk-conversation-entry-btn"
      :class="{ primary: type === 'primary' }"
      :disabled="disabled || opening"
      @click="openComposer"
    >
      <svg
        v-if="icon === 'book-open'"
        class="sdk-conversation-entry-icon"
        viewBox="0 0 24 24"
        width="15"
        height="15"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 7v14" />
        <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
      </svg>
      <span>{{ buttonLabel }}</span>
    </button>
    <p v-if="failure" role="alert" class="sdk-conversation-entry-error">{{ failure.message }}</p>
  </div>
</template>

<style scoped>
/* A primary action is solid; any other is a neutral outline with a quiet fill on hover and press (DESIGN.md). */
.sdk-conversation-entry {
  align-self: flex-start;
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
}

.sdk-conversation-entry-inline {
  align-self: stretch;
  display: flex;
  width: 100%;
}

.sdk-conversation-entry-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 14px;
  border-radius: var(--el-border-radius-base, 6px);
  border: 1px solid var(--el-border-color, #d4d7de);
  background: var(--el-fill-color-blank, #ffffff);
  color: var(--el-text-color-primary, #1f2329);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.sdk-conversation-entry-btn:hover:not(:disabled) {
  background: var(--el-fill-color-light, #f5f7fa);
  border-color: var(--el-border-color-hover, #b8bec9);
}

.sdk-conversation-entry-btn.primary {
  background: var(--el-color-primary, #2563eb);
  border-color: var(--el-color-primary, #2563eb);
  color: #ffffff;
}

.sdk-conversation-entry-btn.primary:hover:not(:disabled) {
  background: var(--el-color-primary-light-3, #3b82f6);
  border-color: var(--el-color-primary-light-3, #3b82f6);
}

.sdk-conversation-entry-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sdk-conversation-entry-icon {
  flex: none;
}

.sdk-conversation-entry-error {
  margin: 0;
  font-size: 12px;
  color: var(--el-color-danger, #dc2626);
}
</style>
