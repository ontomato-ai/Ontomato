<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowUp } from "lucide-vue-next";
import type { HomeItem } from "./items";

/**
 * The home's first answer to "what do I do today": a greeting and a question box. The reader picks one of the domain's
 * enabled agents (the one they last used in the agent platform, when it is still one of them) and asks; the question
 * opens a new conversation with that agent in the agent platform and is sent there.
 */
const props = defineProps<{
  /** The enabled agents, in the agent list's order. */
  agents: readonly HomeItem[];
  /** The agent the agent platform remembers for this reader. */
  remembered: string | null;
  /** The reader's name; null in an edition without sign-in. */
  userName: string | null;
}>();
const emit = defineEmits<{ ask: [agentId: string, question: string] }>();
const { t } = useI18n();

const hour = new Date().getHours();
const period = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
const greeting = computed(() =>
  props.userName ? t(`home.greetingNamed.${period}`, { name: props.userName }) : t(`home.greeting.${period}`),
);

const agentId = ref(props.agents.find((agent) => agent.id === props.remembered)?.id ?? props.agents[0]?.id ?? null);
const question = ref("");
const ready = computed(() => agentId.value !== null && question.value.trim() !== "");

function submit() {
  if (ready.value) emit("ask", agentId.value!, question.value.trim());
}

/** Enter sends; Shift+Enter starts a new line, and Enter that confirms an input method's candidate does neither. */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  submit();
}
</script>

<template>
  <div class="home-ask">
    <h1 class="home-greeting">{{ greeting }}</h1>
    <div v-if="agents.length > 0" class="home-ask-box">
      <el-input
        v-model="question"
        class="home-ask-input"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        resize="none"
        :placeholder="t('home.ask.placeholder')"
        :aria-label="t('home.ask.placeholder')"
        @keydown="onKeydown"
      />
      <div class="home-ask-bar">
        <el-select v-model="agentId" class="home-ask-agent" :aria-label="t('home.ask.agent')" filterable>
          <el-option v-for="agent in agents" :key="agent.id" :label="agent.label" :value="agent.id" />
        </el-select>
        <el-button type="primary" circle :disabled="!ready" :aria-label="t('home.ask.send')" :title="t('home.ask.send')" @click="submit">
          <ArrowUp :size="16" aria-hidden="true" />
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-ask {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--spacing-lg);
  width: 100%;
  max-width: 760px;
  margin-inline: auto;
}
.home-greeting {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-title-lg);
  text-align: center;
}
.home-ask-box {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-lg);
  background: var(--el-fill-color-blank);
  transition: border-color var(--transition-fast);
}
.home-ask-box:focus-within {
  border-color: var(--el-color-primary);
}
/* The box draws the frame; the text area inside it has none of its own. */
.home-ask-input :deep(.el-textarea__inner) {
  padding: 0;
  border: 0;
  box-shadow: none;
  background: transparent;
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
.home-ask-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}
.home-ask-agent {
  width: 220px;
  max-width: 60%;
}
</style>
