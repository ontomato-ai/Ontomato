<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { PageSkillContext } from "@ontomato/contracts/page-context";
import type { ShellLabels } from "../types";
import { usePageCounter } from "../page-counter";
import { entryAgent, servePageComposerKey, type ComposerEntry, type PageComposerExpand, type PageComposerRequest } from "../page-composer-entry";
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
/** Candidate read lifecycle: loading, settled (possibly empty when no agent is permitted), or failed with a reason. */
const candidatesState = ref<"loading" | "ready" | "error">("loading");
const candidatesError = ref<string | null>(null);
let waiting: PageComposerRequest | null = null;
let load = 0;
let newSession = false;

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
    newSession = false;
    candidatesError.value = null;
    candidatesState.value = "loading";
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
        candidatesState.value = "ready";
        const asked = waiting;
        waiting = null;
        // Applied once the composer is drawn, so it opens with the entry's sentence or reports an unavailable target.
        if (asked) void nextTick(() => expand(asked));
      })
      // The page's own configuration or permission refusal keeps its own words and the service's reason; anything else is the service's error.
      .catch((reason: unknown) => {
        if (seq !== load) return;
        // No candidates to open on: an entry that waited ends here, the page showing why.
        const message = candidatesFailureReason(reason, props.labels.pageAgentUnavailable);
        candidatesError.value = message;
        candidatesState.value = "error";
        waiting = null;
        emit("error", message);
      });
  },
  { immediate: true },
);
/** The agent the message goes to: the one chosen here, else the one selected when the page opened. */
const agentId = computed(() => chosen.value ?? agents.value[0]?.id ?? null);

/**
 * Why the page offered no agent. A page whose mapping or registered default is gone, or that refuses access, keeps the
 * page's own sentence with the service's reason for it; a network failure or a service error is shown word for word,
 * so the reader can tell a broken page from a broken connection.
 */
function candidatesFailureReason(reason: unknown, own: string): string {
  const error = reason as { code?: unknown; status?: unknown } | null;
  const detail = reason instanceof Error ? reason.message : String(reason);
  return error?.code === "PAGE_DEFAULT_AGENT_UNAVAILABLE" || error?.status === 403 ? `${own} ${detail}` : detail;
}

async function ask(text: string) {
  if (!agentId.value) return;
  try {
    if (newSession) await counter.ask(agentId.value, text, props.page, { submit: true, newSession: true, pageSkill: props.pageSkill });
    else await counter.ask(agentId.value, text, props.page);
    newSession = false;
  } catch (reason) {
    emit("error", reason instanceof Error ? reason.message : String(reason));
  }
}

/**
 * A panel's conversation entry on this page (design U18): the composer takes the agent the entry names when it is one
 * of this page's candidates and applies the click's declared behavior. When the named target is unavailable, it refuses
 * without switching agents, prefilling, or submitting, and reports the refusal through `error`.
 */
const entry = shallowRef<ComposerEntry | null>(null);
const expand: PageComposerExpand = async (request) => {
  if (candidatesState.value === "loading") {
    waiting = request;
    return;
  }
  const resolved = entryAgent(request.target, agents.value, pageDefault.value, presets.value);
  if (!resolved.ok) {
    emit("error", props.labels.pageAgentUnavailable);
    return;
  }
  const named = resolved.agentId;
  newSession = request.newSession === true;
  chosen.value = named;
  const text = request.prefill?.trim();
  if (request.submit && text) {
    try {
      await counter.ask(named, text, props.page, { submit: true, newSession: request.newSession, pageSkill: props.pageSkill });
    } catch (reason) {
      emit("error", reason instanceof Error ? reason.message : String(reason));
    }
    return;
  }
  entry.value = { text: request.prefill ?? null, seq: (entry.value?.seq ?? 0) + 1 };
};
/** The composer serves the page's entries while it is drawn or about to be: the page offers it an agent, or is being asked. */
const serve = inject(servePageComposerKey, null);
let withdraw: (() => void) | null = null;
watch(
  () => candidatesState.value === "loading" || agents.value.length > 0,
  (drawn) => {
    withdraw?.();
    withdraw = drawn && serve ? serve(expand) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => withdraw?.());
</script>

<template>
  <div v-if="agents.length || candidatesError !== null" class="page-ask" :class="{ 'page-ask-failed': candidatesError !== null }">
    <p v-if="candidatesError" class="page-ask-error" role="alert">{{ candidatesError }}</p>
    <ShellComposer floating :busy="false" :disabled="!agentId" :labels="labels" :entry="entry" @send="ask">
      <template v-if="agents.length" #agent>
        <AgentPicker variant="pill" :agents="agents" :agent-id="agentId" :label="labels.agent" @select="chosen = $event" />
      </template>
    </ShellComposer>
  </div>
</template>

<style scoped>
/*
 * Floating at the foot of the page, the platform's one composer: what a message asks about is the page behind it. It
 * stays one row high until the message needs more, and stands as far above the page's bottom edge as the conversation's
 * composer does above its own — one value for both. Its visible height is measured for the page only while it is on the
 * bottom line; folded or dragged upward, it floats over the page without that room.
 */
.page-ask {
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 0 0 var(--shell-composer-foot);
  background: none;
  box-sizing: border-box;
  pointer-events: none;
}
/* Dragged away from the bottom, the composer's placement is zero high and the foot no longer leaves even its bottom room. */
.page-ask:has(.composer-placement.off-bottom) {
  padding-bottom: 0;
}
/* Folded into its round corner button, the floating foot owns no height at all; the absolute button floats over the page. */
.page-ask:has(.composer-unfold) {
  height: 0;
  padding: 0;
  background: none;
}
/* Keep the failure message visible in place even when the floating composer was previously folded. */
.page-ask.page-ask-failed {
  height: auto;
  padding: 0 0 var(--shell-composer-foot);
}
.page-ask-error {
  pointer-events: auto;
  width: min(760px, 100%);
  margin: 0 auto var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-md);
  box-sizing: border-box;
  border: 1px solid var(--el-color-danger-light-5, var(--el-color-danger));
  border-radius: var(--radius-lg, 12px);
  background: var(--el-color-danger-light-9, var(--el-bg-color));
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
