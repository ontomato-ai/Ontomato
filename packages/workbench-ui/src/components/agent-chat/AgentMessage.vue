<script setup lang="ts">
import type { AgentChatMessage, AgentChatToolSegment } from "@ontomato/contracts/agent-chat";
import { computed, ref } from "vue";
import { Brain, Check, ChevronRight, CircleAlert, Loader2 } from "lucide-vue-next";

import { renderAgentMarkdown } from "../../utils/agent-markdown";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{ message: AgentChatMessage }>();

/** Consecutive tool calls read as one step of work; text and thinking keep their own blocks. */
type Block =
  | { kind: "text" | "thinking"; key: string; content: string }
  | { kind: "tools"; key: string; tools: AgentChatToolSegment[]; failed: number; running?: string };

const blocks = computed(() => {
  const result: Block[] = [];
  props.message.segments?.forEach((seg, index) => {
    if (seg.type !== "tool_call") {
      // Whitespace between two tool calls does not split them into separate steps.
      if (seg.content.trim())
        result.push({ kind: seg.type, key: `${seg.type}:${index}`, content: seg.content });
      return;
    }
    let group = result.at(-1);
    if (group?.kind !== "tools") {
      group = { kind: "tools", key: `tools:${seg.toolCallId}`, tools: [], failed: 0 };
      result.push(group);
    }
    group.tools.push(seg);
    if (seg.isError) group.failed++;
    if (seg.status === "running") group.running = seg.tool;
  });
  return result;
});

const expanded = ref(new Set<string>());

function toggle(key: string) {
  if (!expanded.value.delete(key)) expanded.value.add(key);
}

function formatToolResult(result: unknown): string {
  if (result == null) return t("diagnosis.noResult");
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function formatToolArgs(args: string): string {
  if (!args) return "";
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

const fallbackMarkdown = computed(() => {
  const msg = props.message;
  if (msg.role === "user" || blocks.value.length || !msg.content.trim()) return "";
  return renderAgentMarkdown(msg.content);
});
</script>

<template>
  <!-- User message -->
  <div v-if="message.role === 'user'" class="agent-msg agent-msg--user">
    <div class="agent-msg__bubble">
      {{ message.content }}
    </div>
  </div>

  <!-- Assistant message: the explanation leads; work steps are compact lines opened on demand. -->
  <div v-else class="agent-msg agent-msg--assistant">
    <template v-for="block in blocks" :key="block.key">
      <div
        v-if="block.kind === 'text'"
        class="agent-msg__markdown markdown-content"
        v-html="renderAgentMarkdown(block.content)"
      />

      <div v-else-if="block.kind === 'thinking'" class="agent-step">
        <div
          class="agent-step__row"
          role="button"
          tabindex="0"
          :aria-expanded="expanded.has(block.key)"
          @click="toggle(block.key)"
          @keydown.enter.space.prevent="toggle(block.key)"
        >
          <Brain :size="14" class="agent-step__icon" />
          <span>{{ t("thinking.thinkingProcess") }}</span>
          <ChevronRight :size="14" class="agent-step__chevron" />
        </div>
        <pre v-if="expanded.has(block.key)" class="agent-step__detail agent-step__thinking">{{
          block.content
        }}</pre>
      </div>

      <div
        v-else-if="block.kind === 'tools'"
        :class="['agent-step', { 'agent-step--group': block.tools.length > 1 }]"
      >
        <!-- Several calls in a row collapse to one summary line that names the running call. -->
        <div
          v-if="block.tools.length > 1"
          class="agent-step__row"
          role="button"
          tabindex="0"
          :aria-expanded="expanded.has(block.key)"
          @click="toggle(block.key)"
          @keydown.enter.space.prevent="toggle(block.key)"
        >
          <Loader2 v-if="block.running" :size="14" class="agent-step__icon agent-step__icon--running" />
          <CircleAlert
            v-else-if="block.failed"
            :size="14"
            class="agent-step__icon agent-step__icon--failed"
          />
          <Check v-else :size="14" class="agent-step__icon" />
          <span>{{ t("chat.toolCalls", block.tools.length) }}</span>
          <code v-if="block.running" class="agent-step__name">{{ block.running }}</code>
          <span v-if="block.failed" class="agent-step__failed">
            {{ t("chat.toolFailures", { count: block.failed }) }}
          </span>
          <ChevronRight :size="14" class="agent-step__chevron" />
        </div>

        <div v-if="block.tools.length === 1 || expanded.has(block.key)" class="agent-step__list">
          <div
            v-for="seg in block.tools"
            :key="seg.toolCallId"
            :class="['agent-tool', { 'agent-tool--error': seg.isError }]"
          >
            <div
              class="agent-tool__header agent-step__row"
              role="button"
              tabindex="0"
              :aria-expanded="expanded.has(seg.toolCallId)"
              @click="toggle(seg.toolCallId)"
              @keydown.enter.space.prevent="toggle(seg.toolCallId)"
            >
              <Loader2
                v-if="seg.status === 'running'"
                :size="14"
                class="agent-step__icon agent-step__icon--running"
              />
              <CircleAlert
                v-else-if="seg.isError"
                :size="14"
                class="agent-step__icon agent-step__icon--failed"
              />
              <Check v-else :size="14" class="agent-step__icon" />
              <code class="agent-tool__name agent-step__name">{{ seg.tool }}</code>
              <span v-if="seg.status === 'running'" class="agent-step__sr">
                {{ t("diagnosis.executing") }}
              </span>
              <span v-else-if="seg.isError" class="agent-step__failed">
                {{ t("common.failed") }}
              </span>
              <span v-else class="agent-step__sr">{{ t("common.complete") }}</span>
              <ChevronRight :size="14" class="agent-step__chevron" />
            </div>
            <div v-if="expanded.has(seg.toolCallId)" class="agent-tool__detail agent-step__detail">
              <template v-if="seg.args">
                <div class="agent-step__section">{{ t("common.parameters") }}</div>
                <pre class="agent-step__text">{{ formatToolArgs(seg.args) }}</pre>
              </template>
              <template v-if="seg.status === 'done'">
                <div class="agent-step__section">{{ t("common.result") }}</div>
                <pre :class="['agent-step__text', { 'agent-step__text--error': seg.isError }]">{{
                  formatToolResult(seg.result)
                }}</pre>
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Fallback for legacy/plain-text assistant messages. -->
    <div
      v-if="fallbackMarkdown"
      class="agent-msg__markdown markdown-content"
      v-html="fallbackMarkdown"
    />
  </div>
</template>

<style scoped>
/* User message: a quiet bubble, so the Agent's explanation stays the main reading line. */
.agent-msg--user {
  display: flex;
  justify-content: flex-end;
}

.agent-msg__bubble {
  max-width: min(80%, 560px);
  padding: 9px 14px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}

.agent-msg--assistant {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

/* Markdown content inherits global .markdown-content styles from style.css */
.agent-msg__markdown {
  font-size: 14px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
}

.agent-msg__markdown :deep(> *:first-child) {
  margin-top: 0;
}

.agent-msg__markdown :deep(> *:last-child) {
  margin-bottom: 0;
}

/* ================================================================== */
/*  Work steps: borderless muted lines, details open beneath their line */
/* ================================================================== */

.agent-step {
  min-width: 0;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

.agent-step__row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  min-height: 26px;
  box-sizing: border-box;
  padding: 2px 6px;
  margin-inline-start: -6px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}

.agent-step__row:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}

.agent-step__row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 0;
}

.agent-step__icon {
  flex-shrink: 0;
}

.agent-step__icon--running {
  color: var(--el-color-primary);
  animation: agent-step-spin 1s linear infinite;
}

.agent-step__icon--failed,
.agent-step__failed {
  color: var(--el-color-danger);
}

.agent-step__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 12px;
  background: none;
  padding: 0;
  color: inherit;
}

/* Always faintly visible: touch screens have no hover to reveal that a line expands. */
.agent-step__chevron {
  flex-shrink: 0;
  opacity: 0.4;
  transition:
    opacity var(--transition-fast),
    transform var(--transition-fast);
}

.agent-step__row:hover .agent-step__chevron,
.agent-step__row:focus-visible .agent-step__chevron,
.agent-step__row[aria-expanded="true"] .agent-step__chevron {
  opacity: 0.8;
}

.agent-step__row[aria-expanded="true"] .agent-step__chevron {
  transform: rotate(90deg);
}

.agent-step--group .agent-step__list {
  margin: 2px 0 0 6px;
  padding-inline-start: 10px;
  border-inline-start: 1px solid var(--el-border-color-lighter);
}

.agent-step__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.agent-step__detail {
  margin: 2px 0 6px 20px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}

.agent-step__section {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  margin-top: 4px;
}

.agent-step__text,
.agent-step__thinking {
  margin: 2px 0 4px;
  font-size: var(--text-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
  color: var(--el-text-color-regular);
}

.agent-step__text {
  font-family: var(--font-mono);
}

.agent-step__thinking {
  font-family: var(--font-sans);
  max-height: 300px;
}

.agent-step__text--error {
  color: var(--el-color-danger);
}

@keyframes agent-step-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-step__icon--running {
    animation: none;
  }
}

/* ================================================================== */
/*  highlight.js code block styling                                    */
/* ================================================================== */

.agent-msg__markdown :deep(.hljs-code-block) {
  background: var(--el-fill-color-light);
  border: 1px solid var(--observe-border, var(--el-border-color));
  border-radius: 8px;
  padding: 14px 16px;
  margin: 12px 0;
  overflow-x: auto;
}

.agent-msg__markdown :deep(.hljs-code-block code) {
  background: none;
  border: none;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
}

html.dark .agent-msg__markdown :deep(.hljs-code-block) {
  background: var(--el-fill-color-dark);
  border-color: var(--observe-border, var(--el-border-color-dark));
}

/* highlight.js token colors */
.agent-msg__markdown :deep(.hljs-keyword),
.agent-msg__markdown :deep(.hljs-selector-tag),
.agent-msg__markdown :deep(.hljs-built_in) {
  color: var(--el-color-primary);
}

.agent-msg__markdown :deep(.hljs-string),
.agent-msg__markdown :deep(.hljs-attr) {
  color: var(--el-text-color-primary);
}

.agent-msg__markdown :deep(.hljs-number),
.agent-msg__markdown :deep(.hljs-literal) {
  color: var(--el-color-primary-dark-2);
}

.agent-msg__markdown :deep(.hljs-comment) {
  color: var(--el-text-color-secondary);
  font-style: italic;
}

.agent-msg__markdown :deep(.hljs-title),
.agent-msg__markdown :deep(.hljs-function) {
  color: color-mix(in srgb, var(--el-color-primary) 70%, var(--el-text-color-primary));
}

.agent-msg__markdown :deep(.hljs-type),
.agent-msg__markdown :deep(.hljs-class) {
  color: color-mix(in srgb, var(--el-color-warning) 70%, var(--el-text-color-primary));
}

html.dark .agent-msg__markdown :deep(.hljs-keyword),
html.dark .agent-msg__markdown :deep(.hljs-selector-tag),
html.dark .agent-msg__markdown :deep(.hljs-built_in) {
  color: color-mix(in srgb, var(--el-color-primary) 60%, transparent);
}

html.dark .agent-msg__markdown :deep(.hljs-string),
html.dark .agent-msg__markdown :deep(.hljs-attr) {
  color: color-mix(in srgb, var(--el-color-primary) 50%, transparent);
}

html.dark .agent-msg__markdown :deep(.hljs-number),
html.dark .agent-msg__markdown :deep(.hljs-literal) {
  color: color-mix(in srgb, var(--el-color-primary) 40%, transparent);
}

html.dark .agent-msg__markdown :deep(.hljs-comment) {
  color: var(--el-text-color-tertiary);
}

html.dark .agent-msg__markdown :deep(.hljs-title),
html.dark .agent-msg__markdown :deep(.hljs-function) {
  color: color-mix(in srgb, var(--el-color-primary) 60%, transparent);
}

html.dark .agent-msg__markdown :deep(.hljs-type),
html.dark .agent-msg__markdown :deep(.hljs-class) {
  color: color-mix(in srgb, var(--el-color-warning) 70%, transparent);
}
</style>
