<script setup lang="ts">
import { computed, ref } from "vue";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { ShellLabels } from "../types";
import { usePageCounter } from "../page-counter";
import AgentPicker from "./AgentPicker.vue";
import ShellComposer from "./ShellComposer.vue";

/**
 * The composer at the foot of a page at its own address: the conversation's own composer, with the agent the counter
 * last used, and what the page is written on carried with the message. Sending hands the message to the platform
 * assembly, which opens the counter with this page beside it; nothing is sent from here.
 */
const props = defineProps<{
  /** The page's address, as the counter opens it beside the message. */
  page: string;
  labels: Pick<ShellLabels, "placeholder" | "send" | "stop" | "agent">;
}>();
const counter = usePageCounter()!;
/**
 * The agents are read when the page draws its composer, not when the platform starts: the counter answers, and the page
 * only shows what it may talk to.
 */
const agents = ref<readonly AgentHostAgent[]>([]);
void counter.agents().then((list) => (agents.value = list.filter((agent) => agent.enabled)));
/** The agent the message goes to: the one chosen here, else the one the counter last used, else its first agent. */
const chosen = ref<string | null>(counter.preferredAgentId.value);
const agentId = computed(() => chosen.value ?? agents.value[0]?.id ?? null);

function ask(text: string) {
  if (!agentId.value) return;
  counter.ask(agentId.value, text, props.page);
}
</script>

<template>
  <div v-if="agents.length" class="page-ask">
    <ShellComposer :busy="false" :labels="labels" @send="ask">
      <template #agent>
        <AgentPicker variant="pill" :agents="agents" :agent-id="agentId" :label="labels.agent" @select="chosen = $event" />
      </template>
    </ShellComposer>
  </div>
</template>

<style scoped>
/* At the foot of the page, the platform's one composer: what a message asks about is the page above it. */
.page-ask {
  position: sticky;
  bottom: 0;
  z-index: 1;
  width: min(760px, 100%);
  margin-inline: auto;
  padding: var(--spacing-md) 0;
  background: var(--el-bg-color);
}
</style>
