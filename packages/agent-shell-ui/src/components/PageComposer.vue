<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import type { ShellLabels } from "../types";
import { usePageCounter } from "../page-counter";
import { entryAgent, servePageComposerKey, type ComposerEntry, type PageComposerExpand } from "../page-composer-entry";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
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
  labels: Pick<ShellLabels, "placeholder" | "send" | "stop" | "agent" | "pageAgentUnavailable" | "collapseComposer" | "expandComposer">;
  /** The page's own skill declaration, when it has one; it is the one the page hands its conversation too. */
  pageSkill?: PageSkillContext;
}>();
const emit = defineEmits<{ error: [message: string] }>();
const counter = usePageCounter()!;
/**
 * The agents are read when the page draws its composer, not when the platform starts: the counter answers, and the page
 * only shows what it may talk to. A page with a skill is answered by that page's directory, and its refusal is shown as
 * the configuration error it is rather than being covered by another agent.
 *
 * The page's own default wins over the agent this tab last used: DESIGN "Applications and shells" — a page that
 * registered a default starts from it while it is available, and the remembered agent is the choice of pages without a
 * declaration. Someone who has just talked to another agent still opens a report on the agent the report is mapped to.
 */
const agents = ref<readonly AgentHostAgent[]>([]);
const chosen = ref<string | null>(null);
/** The page's registered default among its candidates, and which candidate is which preset: what an entry may name. */
const pageDefault = ref<string | null>(null);
const presets = shallowRef<Readonly<Record<string, string>> | undefined>(undefined);
/** Whether the page's candidates are being read; a panel's entry that arrives meanwhile waits for them, the latest one counting. */
const reading = ref(false);
let waiting: PanelConversationEntry | null = null;
let load = 0;

watch(
  () => (props.pageSkill ? JSON.stringify(props.pageSkill) : null),
  () => {
    const skill = props.pageSkill;
    const seq = ++load;
    agents.value = [];
    chosen.value = null;
    pageDefault.value = null;
    presets.value = undefined;
    waiting = null;
    reading.value = false;
    if (skill?.mode === "member" && skill.member === null) return;
    reading.value = true;
    const candidates = skill
      ? counter.pageAgents(skill)
      : counter.agents().then((list) => ({ agents: list, defaultAgentId: undefined as string | undefined, presetAgentIds: undefined }));
    void candidates
      .then(({ agents: list, defaultAgentId, presetAgentIds }) => {
        if (seq !== load) return;
        agents.value = list.filter((agent) => agent.enabled);
        const offered = (id: string | null | undefined) => agents.value.some((agent) => agent.id === id);
        const remembered = skill ? null : counter.preferredAgentId.value;
        // The page's registered default (the platform's own agent when it registered none), else the remembered one, else the first.
        const initial = offered(defaultAgentId) ? defaultAgentId : offered(remembered) ? remembered : agents.value[0]?.id;
        chosen.value = initial ?? null;
        pageDefault.value = defaultAgentId ?? null;
        presets.value = presetAgentIds;
        reading.value = false;
        const asked = waiting;
        waiting = null;
        // Applied once the composer is drawn, so it opens with the entry's sentence in it.
        if (asked && agents.value.length) void nextTick(() => expand(asked));
      })
      // The page's own configuration keeps its own words and the service's reason; anything else is the service's error.
      .catch((reason: unknown) => {
        if (seq !== load) return;
        // No candidates to open on: an entry that waited ends here, the page showing why.
        reading.value = false;
        waiting = null;
        emit("error", candidatesFailureReason(reason, props.labels.pageAgentUnavailable));
      });
  },
  { immediate: true },
);
/** The agent the message goes to: the one chosen here, else the one selected when the page opened. */
const agentId = computed(() => chosen.value ?? agents.value[0]?.id ?? null);

/**
 * Why the page offered no agent. A page whose mapping or registered default is gone is the page's configuration — the
 * page's own sentence, with the service's reason for it; a network failure or a refused request is that error, word for
 * word, so the reader can tell a broken page from a broken connection.
 */
function candidatesFailureReason(reason: unknown, own: string): string {
  const code = (reason as { code?: unknown } | null)?.code;
  const detail = reason instanceof Error ? reason.message : String(reason);
  return code === "PAGE_DEFAULT_AGENT_UNAVAILABLE" ? `${own} ${detail}` : detail;
}

function ask(text: string) {
  if (!agentId.value) return;
  counter.ask(agentId.value, text, props.page);
}

/**
 * A panel's conversation entry on this page (design U18): the composer opens, takes the agent the entry names when it is
 * one of this page's candidates, and fills the entry's sentence for the reader to send. An agent it cannot name leaves
 * the composer on its own agent and only opens it. Nothing is sent from here.
 */
const entry = shallowRef<ComposerEntry | null>(null);
const expand: PageComposerExpand = (request) => {
  if (reading.value) {
    waiting = request;
    return;
  }
  const named = entryAgent(request.target, agents.value, pageDefault.value, presets.value);
  if (named) chosen.value = named;
  entry.value = { text: named ? request.prefill ?? null : null, seq: (entry.value?.seq ?? 0) + 1 };
};
/** The composer serves the page's entries while it is drawn or about to be: the page offers it an agent, or is being asked. */
const serve = inject(servePageComposerKey, null);
let withdraw: (() => void) | null = null;
watch(
  () => reading.value || agents.value.length > 0,
  (drawn) => {
    withdraw?.();
    withdraw = drawn && serve ? serve(expand) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => withdraw?.());
</script>

<template>
  <div v-if="agents.length" class="page-ask">
    <ShellComposer floating :busy="false" :labels="labels" :entry="entry" @send="ask">
      <template #agent>
        <AgentPicker variant="pill" :agents="agents" :agent-id="agentId" :label="labels.agent" @select="chosen = $event" />
      </template>
    </ShellComposer>
  </div>
</template>

<style scoped>
/*
 * At the foot of the page, the platform's one composer: what a message asks about is the page above it. It stays one row
 * high until the message needs more, and stands as far above the page's bottom edge as the conversation's composer does
 * above its own — one value for both, so it takes as little of the page as it can.
 */
.page-ask {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 100%;
  padding: var(--spacing-sm) 0 var(--shell-composer-foot);
  background: var(--el-bg-color);
  box-sizing: border-box;
}
.page-ask > :deep(.composer) {
  width: min(760px, 100%);
  margin-inline: auto;
}
/* Folded into its round button, the foot stays in flow below the content box so the button never overlaps page controls. */
.page-ask:has(.composer-unfold) {
  padding: var(--spacing-xs) 0 var(--shell-composer-foot);
  background: transparent;
}
</style>
