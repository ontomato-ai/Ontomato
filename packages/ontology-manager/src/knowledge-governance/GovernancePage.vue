<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { AgentShell, createAgentHostClient, type AgentHostClient } from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import {
  governanceSourceReadSchema, governanceWorkResponseSchema,
  type GovernanceSourceRead, type GovernanceWork,
} from "@ontomato/contracts/knowledge-governance";
import { useManagerClient, useManagerContext } from "../context";
import { englishGovernance, governanceAgentId, shellLabels } from "./messages";

const props = defineProps<{ sessionId: string | null }>();
const emit = defineEmits<{ session: [id: string | null]; back: [] }>();
const context = useManagerContext(), manager = useManagerClient();
const messages = computed(() => context.messages.governance ?? englishGovernance);
const t = (key: string) => messages.value.text[key] ?? englishGovernance.text[key];
const labels = computed(() => shellLabels(messages.value));
const agentId = ref<string | null>(governanceAgentId);
const sessionId = computed({ get: () => props.sessionId, set: (id) => emit("session", id) });
const featureId = ref<string | null>(null);
const work = ref<GovernanceWork | null>(null), source = ref<GovernanceSourceRead | null>(null);
const error = ref(""), loading = ref(false);
const workbench = computed(() => ({
  id: "knowledge-governance", label: t("title"),
  features: [{ id: "report", label: t("report"), icon: "file-text", availability: "page" as const }],
}));
const base = "/ontology/ai/knowledge-governance";
let workRead = 0, sourceRead = 0;
const fail = (value: unknown) => { error.value = value instanceof Error ? value.message : String(value); };
async function readWork() {
  const id = sessionId.value, version = ++workRead;
  if (!id) { work.value = null; return; }
  loading.value = true;
  try {
    const result = governanceWorkResponseSchema.parse(await (await manager.request(`${base}/${id}/work`)).json());
    if (sessionId.value === id && version === workRead) { work.value = result.work; error.value = ""; }
  } catch (reason) { if (sessionId.value === id && version === workRead) fail(reason); }
  finally { if (version === workRead) loading.value = false; }
}
async function readSource(id: string, offset = 0) {
  const session = sessionId.value, version = ++sourceRead;
  if (!session) return;
  try {
    const result = governanceSourceReadSchema.parse(await (await manager.request(`${base}/${session}/sources/${encodeURIComponent(id)}?offset=${offset}`)).json());
    if (session === sessionId.value && version === sourceRead) source.value = result;
  } catch (reason) { if (session === sessionId.value && version === sourceRead) fail(reason); }
}
const transport = createAgentHostClient({ request: (path, init) => manager.request(`/ontology/ai${path}`, init) });
const client: AgentHostClient = {
  ...transport,
  async listAgents() {
    return (await transport.listAgents()).filter(agent => agent.id === governanceAgentId)
      .map(agent => ({ ...agent, name: t("title"), description: t("subtitle") }));
  },
  subscribe(session, run, cursor, handlers) {
    return transport.subscribe(session, run, cursor, {
      ...handlers,
      frame(frame) {
        handlers.frame(frame);
        if (sessionId.value === session && frame.type === "event" &&
            (frame.envelope.event.type === "agent_end" ||
             (featureId.value === "report" && frame.envelope.event.type === "tool_execution_end"))) void readWork();
      },
    });
  },
};
watch(sessionId, () => { sourceRead++; source.value = null; work.value = null; void readWork(); }, { immediate: true });
watch(featureId, value => { if (value === "report") void readWork(); });
const progress = computed(() => work.value?.knowledgeTotal === null || !work.value ? "" :
  t("progress").replace("{done}", String(work.value.reviewedKnowledgeIds.length)).replace("{total}", String(work.value.knowledgeTotal)));
</script>

<template>
  <section class="governance-page">
    <p v-if="error" class="governance-error" role="alert">{{ error }}</p>
    <AgentShell v-model:session-id="sessionId" v-model:agent-id="agentId" v-model:feature-id="featureId"
      :workbench="workbench" :client="client" :labels="labels" @error="fail">
      <template #brand><button type="button" class="governance-back" @click="emit('back')">← {{ t("back") }}</button></template>
      <template #footer><small>{{ t("saved") }}</small></template>
      <template #feature>
        <section class="governance-report">
          <header><h1>{{ t("report") }}</h1><button type="button" @click="featureId = null">{{ t("discussion") }}</button></header>
          <p>{{ t("reportHint") }}</p>
          <p v-if="loading" role="status">{{ t("loading") }}</p>
          <p v-if="progress">{{ progress }}</p>
          <p v-if="work?.summary">{{ work.summary }}</p>
          <p v-if="!work?.issues.length">{{ t("noIssues") }}</p>
          <article v-for="issue in work?.issues" :key="issue.id">
            <small>{{ t(issue.category) }} · {{ t(issue.status) }}</small>
            <h2>{{ issue.title }}</h2>
            <dl>
              <dt>{{ t("problem") }}</dt><dd>{{ issue.problem }}</dd>
              <template v-if="issue.before"><dt>{{ t("before") }}</dt><dd>{{ issue.before }}</dd></template>
              <dt>{{ t("after") }}</dt><dd>{{ issue.after }}</dd>
              <dt>{{ t("basis") }}</dt><dd>{{ issue.basis }}</dd>
            </dl>
            <button v-for="id in issue.sourceIds" :key="id" type="button" @click="readSource(id)">
              {{ work?.sources.find(item => item.id === id)?.title || t("sources") }}
            </button>
          </article>
          <h2>{{ t("sources") }}</h2>
          <p v-if="!work?.sources.length">{{ t("noSources") }}</p>
          <button v-for="item in work?.sources" :key="item.id" type="button" @click="readSource(item.id)">{{ item.title }}</button>
          <section v-if="source" class="governance-source" aria-live="polite">
            <h3>{{ source.source.title }}</h3>
            <p v-if="!source.page">{{ t("evidenceHint") }}</p>
            <p v-else-if="!source.page.items.length">{{ t("sourceMissing") }}</p>
            <blockquote v-for="item in source.page?.items" :key="item.id">{{ item.text }}</blockquote>
            <button v-if="source.page?.next" type="button" @click="readSource(source.source.id, source.page.next.offset)">{{ t("more") }}</button>
          </section>
        </section>
      </template>
    </AgentShell>
  </section>
</template>

<style scoped>
.governance-page { height: 100%; min-height: 0; flex: 1; display: flex; flex-direction: column; }
.governance-page :deep(.agent-shell) { height: 100%; min-height: 0; flex: 1; padding: 12px; }
.governance-error { color: var(--el-color-danger); margin: 8px 20px; }
.governance-report { max-width: 880px; margin: auto; padding: 24px; overflow-wrap: anywhere; }
.governance-report header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.governance-report article { padding: 20px 0; border-bottom: 1px solid var(--el-border-color); }
.governance-report small, .governance-report dt { color: var(--el-text-color-secondary); }
.governance-report dd { margin: 4px 0 16px; white-space: pre-wrap; }
.governance-report button, .governance-back { color: var(--el-color-primary); background: transparent; border: 0; cursor: pointer; padding: 8px; font: inherit; text-align: start; }
.governance-source blockquote { margin: 12px 0; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: var(--el-fill-color-light); }
</style>
