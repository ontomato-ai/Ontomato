<script setup lang="ts">
import { computed, ref } from "vue";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { AgentPageQuery } from "../host";
import type { ShellLabels } from "../types";
import { usePageCounter } from "../page-counter";
import AgentPicker from "./AgentPicker.vue";
import ShellComposer from "./ShellComposer.vue";

/**
 * The composer at the foot of a page at its own address: the conversation's own composer, with the agent the counter
 * last used, and what the page is written on carried with the message. Sending hands the message to the platform
 * assembly, which opens the counter with this page beside it; nothing is sent from here.
 *
 * A page that declares its own skill (`pageSkill`, the same declaration the conversation beside it reads) narrows the
 * agents offered to the ones that carry it, and starts from the page's registered default: the alternative — every
 * agent, with the remembered one selected — would offer an agent that cannot work on this page at all.
 */
const props = defineProps<{
  /** The page's address, as the counter opens it beside the message. */
  page: string;
  labels: Pick<ShellLabels, "placeholder" | "send" | "stop" | "agent" | "pageAgentUnavailable">;
  /** The page's own skill declaration, when it has one; it is the one the page hands its conversation too. */
  pageSkill?: AgentPageQuery;
}>();
const emit = defineEmits<{ error: [message: string] }>();
const counter = usePageCounter()!;
/**
 * The agents are read when the page draws its composer, not when the platform starts: the counter answers, and the page
 * only shows what it may talk to. A page with a skill is answered by that page's directory, and its refusal is shown as
 * the configuration error it is rather than being covered by another agent.
 */
const agents = ref<readonly AgentHostAgent[]>([]);
const chosen = ref<string | null>(null);
const candidates = props.pageSkill
  ? counter.pageAgents(props.pageSkill)
  : counter.agents().then((list) => ({ agents: list, defaultAgentId: undefined as string | undefined }));
/** The agent this tab last used; it is a choice only where the page offers it. */
const preferred = counter.preferredAgentId.value;
void candidates
  .then(({ agents: list, defaultAgentId }) => {
    agents.value = list.filter((agent) => agent.enabled);
    // The agent this tab last used while the page offers it, else the page's registered default, else the first one.
    const offered = (id: string | null | undefined) => agents.value.some((agent) => agent.id === id);
    chosen.value = offered(preferred) ? preferred : offered(defaultAgentId) ? defaultAgentId! : agents.value[0]?.id ?? null;
  })
  // The page's own configuration: the reader is told the page cannot offer an agent, not shown the transport's words.
  .catch(() => emit("error", props.labels.pageAgentUnavailable));
/** The agent the message goes to: the one chosen here, else the one selected when the page opened. */
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
