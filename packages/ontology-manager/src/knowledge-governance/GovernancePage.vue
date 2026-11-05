<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import { AgentShell, ShellNavBody, createAgentHostClient, useAgentNav, useAppColumn } from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import {
  governanceSourceReadSchema, governanceWorkResponseSchema,
  type GovernanceSourceRead, type GovernanceWork,
} from "@ontomato/contracts/knowledge-governance";
import { useGovernanceText, useManagerClient } from "../context";
import { governanceAgentId } from "./messages";

/**
 * Knowledge governance as an agent app (DESIGN.md "Agent apps"): the governance agent plus one page, the
 * report of findings. The report sits full or beside the conversation; the finding the reader selects is what "this"
 * means in the next message. Sources open inside the finding that cites them.
 */
const props = defineProps<{ sessionId: string | null }>();
const emit = defineEmits<{ session: [id: string | null] }>();
const manager = useManagerClient();
const { t, labels } = useGovernanceText();
const agentId = ref<string | null>(governanceAgentId);
const sessionId = computed({ get: () => props.sessionId, set: (id) => emit("session", id) });
const featureId = ref<string | null>(null);
const work = ref<GovernanceWork | null>(null);
const error = ref(""), loading = ref(false);
const selectedIssue = ref<string | null>(null);
/** The source being read and where it shows: under a finding, or under the source list ("all"). */
const source = ref<{ read: GovernanceSourceRead; anchor: string } | null>(null);
const workbench = computed(() => ({
  id: "knowledge-governance", label: t("title"),
  features: [{ id: "report", label: t("report"), icon: "review", availability: "page" as const, withConversation: true }],
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
async function readSource(id: string, anchor: string, offset = 0) {
  const session = sessionId.value, version = ++sourceRead;
  if (!session) return;
  try {
    const result = governanceSourceReadSchema.parse(await (await manager.request(`${base}/${session}/sources/${encodeURIComponent(id)}?offset=${offset}`)).json());
    if (session === sessionId.value && version === sourceRead) source.value = { read: result, anchor };
  } catch (reason) { if (session === sessionId.value && version === sourceRead) fail(reason); }
}
const sourceTitle = (id: string) => work.value?.sources.find((item) => item.id === id)?.title || t("sources");

const client = createAgentHostClient({
  request: (path, init) => manager.request(`/ontology/ai${path}`, init),
  // The governance agent is the only one this page discusses; its work is read again once a run ends.
  agents: (agents) =>
    agents.filter((agent) => agent.id === governanceAgentId)
      .map((agent) => ({ ...agent, name: t("title"), description: t("subtitle") })),
  onEvent: (session, envelope) => {
    if (session === sessionId.value && envelope.event.type === "agent_end") void readWork();
  },
});
/**
 * The one navigation state of this application: the platform column lists its conversations and the report entry, and
 * the conversation promotes into it while sending.
 */
const nav = useAgentNav({
  client: () => client,
  agentId: () => agentId.value,
  setAgentId: (id) => (agentId.value = id),
  sessionId: () => sessionId.value,
  setSessionId: (id) => (sessionId.value = id),
  onLeaveConversation: () => (featureId.value = null),
});
const { agents, sessions, sessionsState, nextCursor } = nav;

useAppColumn(() => ({
  appId: "governance",
  content: () =>
    h(ShellNavBody, {
      workbench: workbench.value,
      agents: agents.value,
      agentId: agentId.value,
      sessions: sessions.value,
      sessionsState: sessionsState.value,
      hasMore: nextCursor.value !== null,
      sessionId: sessionId.value,
      featureId: featureId.value,
      // The column is drawn outside the conversation's provider, so the shell's words are passed in.
      labels: labels.value,
      onNewConversation: () => nav.startNew(),
      onSelectFeature: (id: string) => (featureId.value = id),
      onFeatureAction: () => {},
      onSelectAgent: (id: string) => (agentId.value = id),
      onSelectSession: (id: string) => (sessionId.value = id),
      onDeleteSession: (id: string) => void nav.removeSession(id),
      onLoadMore: () => void nav.loadSessions(true),
      onRetry: () => void nav.loadSessions(),
    }),
}));

onMounted(async () => {
  await nav.loadAgents().catch(() => {});
  await nav.loadSessions();
});

watch(sessionId, () => {
  sourceRead++; source.value = null; work.value = null; selectedIssue.value = null; void readWork();
}, { immediate: true });
watch(featureId, (value) => { if (value === "report") void readWork(); });

const progress = computed(() => work.value?.knowledgeTotal === null || !work.value ? "" :
  t("progress", { done: work.value.reviewedKnowledgeIds.length, total: work.value.knowledgeTotal }));
const pageContext = computed(() => {
  const issue = work.value?.issues.find((item) => item.id === selectedIssue.value);
  return t("context", { page: issue ? t("contextIssue", { report: t("report"), title: issue.title }) : t("report") });
});
function toggleIssue(id: string) {
  selectedIssue.value = selectedIssue.value === id ? null : id;
}
</script>

<template>
  <div class="governance-page">
    <p v-if="error" class="governance-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" :aria-label="labels.close" @click="error = ''"><X :size="14" /></button>
    </p>
    <AgentShell v-model:session-id="sessionId" v-model:agent-id="agentId" v-model:feature-id="featureId"
      :workbench="workbench" :client="client" :labels="labels" :nav="nav" :page-context="pageContext" @error="fail">
      <template #feature>
        <div class="report" :aria-busy="loading">
          <section class="report-summary">
            <p class="report-hint">{{ t("reportHint") }}</p>
            <p v-if="loading && !work" role="status">{{ t("loading") }}</p>
            <p v-if="progress" class="report-progress">{{ progress }}</p>
            <p v-if="work?.summary" class="report-text">{{ work.summary }}</p>
          </section>

          <p v-if="!work?.issues.length" class="report-empty">{{ t("noIssues") }}</p>
          <article
            v-for="issue in work?.issues"
            :key="issue.id"
            class="issue"
            :class="{ selected: selectedIssue === issue.id }"
          >
            <button type="button" class="issue-head" :aria-pressed="selectedIssue === issue.id" @click="toggleIssue(issue.id)">
              <span class="issue-tags">
                <span class="tag">{{ t(issue.category) }}</span>
                <span class="tag" :class="issue.status">{{ t(issue.status) }}</span>
              </span>
              <span class="issue-title">{{ issue.title }}</span>
            </button>
            <dl class="issue-fields">
              <dt>{{ t("problem") }}</dt><dd>{{ issue.problem }}</dd>
              <template v-if="issue.before"><dt>{{ t("before") }}</dt><dd>{{ issue.before }}</dd></template>
              <dt>{{ t("after") }}</dt><dd>{{ issue.after }}</dd>
              <dt>{{ t("basis") }}</dt><dd>{{ issue.basis }}</dd>
            </dl>
            <div v-if="issue.sourceIds.length" class="source-chips">
              <button
                v-for="id in issue.sourceIds"
                :key="id"
                type="button"
                class="chip"
                :class="{ active: source?.anchor === issue.id && source.read.source.id === id }"
                @click="readSource(id, issue.id)"
              >
                {{ sourceTitle(id) }}
              </button>
            </div>
            <section v-if="source?.anchor === issue.id" class="source" aria-live="polite">
              <header>
                <strong>{{ source.read.source.title }}</strong>
                <button type="button" class="source-close" :aria-label="labels.close" @click="source = null"><X :size="14" /></button>
              </header>
              <p v-if="!source.read.page" class="muted">{{ t("evidenceHint") }}</p>
              <p v-else-if="!source.read.page.items.length" class="muted">{{ t("sourceMissing") }}</p>
              <blockquote v-for="item in source.read.page?.items" :key="item.id">{{ item.text }}</blockquote>
              <button v-if="source.read.page?.next" type="button" class="chip"
                @click="readSource(source.read.source.id, issue.id, source.read.page.next.offset)">{{ t("more") }}</button>
            </section>
          </article>

          <section class="report-sources">
            <h2>{{ t("sources") }}</h2>
            <p v-if="!work?.sources.length" class="muted">{{ t("noSources") }}</p>
            <div class="source-chips">
              <button v-for="item in work?.sources" :key="item.id" type="button" class="chip"
                :class="{ active: source?.anchor === 'all' && source.read.source.id === item.id }"
                @click="readSource(item.id, 'all')">{{ item.title }}</button>
            </div>
            <section v-if="source?.anchor === 'all'" class="source" aria-live="polite">
              <header>
                <strong>{{ source.read.source.title }}</strong>
                <button type="button" class="source-close" :aria-label="labels.close" @click="source = null"><X :size="14" /></button>
              </header>
              <p v-if="!source.read.page" class="muted">{{ t("evidenceHint") }}</p>
              <p v-else-if="!source.read.page.items.length" class="muted">{{ t("sourceMissing") }}</p>
              <blockquote v-for="item in source.read.page?.items" :key="item.id">{{ item.text }}</blockquote>
              <button v-if="source.read.page?.next" type="button" class="chip"
                @click="readSource(source.read.source.id, 'all', source.read.page.next.offset)">{{ t("more") }}</button>
            </section>
          </section>
        </div>
      </template>
    </AgentShell>
  </div>
</template>

<style scoped>
/* The page fills the Manager frame (a size container), not the viewport. */
.governance-page {
  position: relative;
  flex: 1;
  min-height: 0;
  height: 100%;
}
.governance-page :deep(.agent-shell) {
  height: 100%;
}
.governance-error {
  position: absolute;
  z-index: 60;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(640px, calc(100% - 32px));
  margin: 0;
  padding: 8px 8px 8px 14px;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--radius-md, 8px);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
  box-shadow: var(--elevation-modal);
}
.governance-error button,
.source-close {
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.governance-brand {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.governance-back {
  display: grid;
  place-items: center;
  width: var(--control-height);
  height: var(--control-height);
  flex-shrink: 0;
  margin-left: -6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-regular);
  cursor: pointer;
}
.governance-back:hover {
  background: var(--el-fill-color);
}
.governance-back:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
.governance-title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.governance-saved {
  margin: 0;
  padding: 0 8px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.report {
  max-width: 880px;
  margin: 0 auto;
  padding: 16px 20px 32px;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  overflow-wrap: anywhere;
}
.report p {
  margin: 0 0 8px;
}
.report-hint,
.muted,
.report-empty {
  color: var(--el-text-color-secondary);
}
.report-progress {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.report-summary {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color);
}
.report-empty {
  padding: 24px 0;
  text-align: center;
}
.issue {
  padding: 12px 0;
  border-bottom: 1px solid var(--el-border-color);
}
.issue-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  margin: 0 0 8px;
  padding: 8px;
  margin-left: -8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.issue-head:hover {
  background: var(--el-fill-color-light);
}
.issue.selected .issue-head {
  background: var(--el-color-primary-light-9);
}
.issue-head:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
.issue-tags {
  display: flex;
  gap: 6px;
}
.tag {
  padding: 0 8px;
  border-radius: 999px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: 20px;
}
.tag.pending {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.tag.confirmed {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.issue-title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.issue-fields {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  margin: 0;
}
.issue-fields dt {
  color: var(--el-text-color-secondary);
}
.issue-fields dd {
  margin: 0;
  white-space: pre-wrap;
}
.source-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.chip {
  max-width: 100%;
  padding: 2px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 999px;
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-xs);
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.chip:hover,
.chip.active {
  border-color: var(--el-color-primary-light-5);
  color: var(--el-color-primary);
}
.source {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--el-fill-color-light);
}
.source header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.source blockquote {
  margin: 8px 0;
  padding-left: 10px;
  border-left: 2px solid var(--el-border-color);
  white-space: pre-wrap;
}
.report-sources {
  padding-top: 16px;
}
.report-sources h2 {
  margin: 0 0 6px;
  font-size: var(--text-base);
  font-weight: 600;
}
@container page (max-width: 560px) {
  .issue-fields {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .issue-fields dd {
    margin-bottom: 8px;
  }
}
</style>
