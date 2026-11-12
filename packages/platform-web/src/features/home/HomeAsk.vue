<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { AgentPicker, ShellComposer, type AgentHostAgent } from "@ontomato/agent-shell-ui";
import { PlatformBrandMark } from "@ontomato/platform-shell";
import { platformBrandKey } from "../../apps";

/**
 * The home's welcome and its first answer to "what do I do today": the edition's mark, a greeting and today's date, and
 * the platform's message box with an agent picker at its lower left. The reader picks one of the domain's enabled
 * agents (the one they last used in the agent platform, when it is still one of them) and asks; the question opens a
 * new conversation with that agent in the agent platform and is sent there.
 */
const props = defineProps<{
  /** The enabled agents, in the agent list's order. */
  agents: readonly AgentHostAgent[];
  /** The agent the agent platform remembers for this reader. */
  remembered: string | null;
  /** The reader's name; null in an edition without sign-in. */
  userName: string | null;
}>();
const emit = defineEmits<{ ask: [agentId: string, question: string] }>();
const { t, locale } = useI18n();
const brand = inject(platformBrandKey)!;

const now = new Date();
const hour = now.getHours();
const period = hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
const greeting = computed(() =>
  props.userName ? t(`home.greetingNamed.${period}`, { name: props.userName }) : t(`home.greeting.${period}`),
);
const today = computed(() => new Intl.DateTimeFormat(locale.value, { month: "long", day: "numeric", weekday: "long" }).format(now));

const agentId = ref(props.agents.find((agent) => agent.id === props.remembered)?.id ?? props.agents[0]?.id ?? null);
const labels = computed(() => ({ placeholder: t("home.askPlaceholder"), send: t("assistant.send"), stop: t("assistant.stop") }));

function ask(question: string) {
  emit("ask", agentId.value!, question.trim());
}
</script>

<template>
  <div class="home-welcome">
    <div class="home-brand"><PlatformBrandMark :brand="brand" :size="40" /></div>
    <h1 class="home-greeting">{{ greeting }}</h1>
    <p class="home-date">{{ today }}</p>
    <div v-if="agents.length > 0" class="home-ask">
      <ShellComposer :busy="false" :labels="labels" @send="ask">
        <template #tools>
          <AgentPicker variant="pill" :agents="agents" :agent-id="agentId" :label="t('assistant.agent')" @select="agentId = $event" />
        </template>
      </ShellComposer>
    </div>
  </div>
</template>

<style scoped>
.home-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 760px;
  margin-inline: auto;
}
.home-brand {
  display: flex;
  margin-bottom: var(--spacing-lg);
}
/* The display role: the welcome only (DESIGN.md "Foundation tokens"), as the conversation's own welcome. */
.home-greeting {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-3xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-3xl);
  letter-spacing: var(--tracking-display);
  text-align: center;
}
.home-date {
  margin: var(--spacing-xs) 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
/* The box floats as the conversation's does. */
.home-ask {
  --shell-composer-shadow: var(--elevation-composer);
  width: 100%;
  margin-top: var(--spacing-xl);
}
</style>
