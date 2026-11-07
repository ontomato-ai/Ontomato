<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useLocale } from "../../../../composables/useLocale";
import { relativeTime } from "../../../../utils/relative-time";
import { artifactRetentionRequestKey, diagnosisApi, setArtifactRetention } from "../../api";
import EmptyState from "../agent-chat/EmptyState.vue";
import ListDetail from "../layout/ListDetail.vue";
import SidebarListItem from "../layout/SidebarListItem.vue";
import type { AutotestRunMeta } from "../layout/types";
import CaseArtifactPage from "../results/CaseArtifactPage.vue";
import ResultsPage from "../results/ResultsPage.vue";
import TestcasesPage from "../testcases/TestcasesPage.vue";
import TestPage from "./TestPage.vue";

/**
 * Automatic tests as one page: start a run, read run results (the page's own list of runs beside the selected one), and
 * edit case sets. The tab is the address, so existing links to /observe/test, /results and /cases still land.
 */
const route = useRoute();
const router = useRouter();
const { t } = useLocale();

type Tab = "run" | "results" | "cases";
const tabs = computed<{ id: Tab; path: string; label: string }[]>(() => [
  { id: "run", path: "/ops/test", label: t("program.testExecution") },
  { id: "results", path: "/ops/results", label: t("ops.results") },
  { id: "cases", path: "/ops/cases", label: t("ops.cases") },
]);
const tab = computed<Tab>(() =>
  route.path === "/ops/test" ? "run" : route.path === "/ops/cases" ? "cases" : "results",
);
const caseId = computed(() => (typeof route.params.caseId === "string" ? route.params.caseId : null));
const runId = computed(() =>
  typeof route.params.runId === "string" ? route.params.runId : typeof route.query.runId === "string" ? route.query.runId : null,
);

const runs = ref<AutotestRunMeta[]>([]);
const loading = ref(false);
const deletingId = ref<string | null>(null);
const retentionKey = ref<string | null>(null);
const busy = (run: AutotestRunMeta) => run.status === "running" || run.status === "stopping";
const ordered = computed(() => [...runs.value].sort((a, b) => Number(!!b.kept) - Number(!!a.kept)));
const selectedRun = computed(() => runs.value.find((run) => run.runId === runId.value));
const activeRunId = computed(() => runs.value.find(busy)?.runId ?? null);

function placeholder(id: string): AutotestRunMeta {
  const now = new Date().toISOString();
  return { runId: id, caseSetId: "", caseSetName: "", status: "running", summary: { total: 0, correct: 0, wrong: 0, abnormal: 0 }, createdAt: now, updatedAt: now };
}
async function load(visible: string | null = runId.value) {
  loading.value = true;
  try {
    runs.value = (await diagnosisApi.listRuns()).data || [];
  } catch (error) {
    runs.value = [];
    console.error("Failed to load autotest runs", error);
  } finally {
    if (visible && !runs.value.some((run) => run.runId === visible)) runs.value = [placeholder(visible), ...runs.value];
    loading.value = false;
  }
}

/** Keeps the conversation that is open beside the page. */
function go(path: string, query: Record<string, string> = {}) {
  const session = typeof route.query.sessionId === "string" ? { sessionId: route.query.sessionId } : {};
  void router.push({ path, query: { ...session, ...query } }).catch(() => {});
}
const openRun = (id: string | null) => go("/ops/results", id ? { runId: id } : {});

function subtitle(run: AutotestRunMeta) {
  const parts: string[] = [];
  if (run.summary.total > 0)
    parts.push(
      Number.isFinite(run.summary.correct)
        ? t("admin.correctCount", { correct: run.summary.correct, total: run.summary.total })
        : t("admin.nTestcases", { n: run.summary.total }),
    );
  if (run.createdAt) parts.push(relativeTime(run.createdAt));
  return parts.join(" · ");
}

async function remove(run: AutotestRunMeta) {
  if (deletingId.value) return;
  if (busy(run)) {
    ElMessage.warning(t("diagnosis.testBatchRunningPleaseStop"));
    return;
  }
  try {
    await ElMessageBox.confirm(t("diagnosis.deleteTestBatchConfirm", { title: run.caseSetName || run.runId }), t("common.deleteConfirm"), {
      type: "warning",
      confirmButtonText: t("common.delete"),
      cancelButtonText: t("common.cancel"),
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  deletingId.value = run.runId;
  try {
    await diagnosisApi.deleteRun(run.runId);
    removed(run.runId);
    ElMessage.success(t("diagnosis.testBatchDeleted"));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t("diagnosis.testBatchDeleteFailed"));
  } finally {
    deletingId.value = null;
  }
}
function removed(id: string) {
  runs.value = runs.value.filter((run) => run.runId !== id);
  if (runId.value === id) openRun(null);
}

async function toggleRetention(run: AutotestRunMeta) {
  if (retentionKey.value) return;
  retentionKey.value = artifactRetentionRequestKey("autotest-run", run.runId);
  try {
    const kept = await setArtifactRetention("autotest-run", run.runId, !run.kept);
    runs.value = runs.value.map((item) => (item.runId === run.runId ? { ...item, kept } : item));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t("diagnosis.retentionUpdateFailed"));
  } finally {
    retentionKey.value = null;
  }
}
const updating = (run: AutotestRunMeta) => retentionKey.value === artifactRetentionRequestKey("autotest-run", run.runId);

watch(runId, (id) => {
  if (id && !runs.value.some((run) => run.runId === id)) void load(id);
});
onMounted(() => load());
</script>

<template>
  <div class="autotest-page">
    <nav class="autotest-tabs" role="tablist">
      <button
        v-for="item in tabs"
        :key="item.id"
        type="button"
        role="tab"
        class="autotest-tab"
        :class="{ active: tab === item.id }"
        :aria-selected="tab === item.id"
        @click="go(item.path)"
      >
        {{ item.label }}
      </button>
    </nav>
    <div class="autotest-body">
      <TestPage v-if="tab === 'run'" :initial-run-id="activeRunId" @run-created="load($event)" @run-settled="load($event)" />
      <TestcasesPage v-else-if="tab === 'cases'" />
      <ListDetail v-else :selected="!!runId" @back="openRun(null)">
        <template #list>
          <div v-loading="loading" class="run-list">
            <SidebarListItem
              v-for="run in ordered"
              :key="run.runId"
              :title="run.caseSetName || run.runId.substring(0, 8)"
              :subtitle="subtitle(run)"
              :status="busy(run) ? 'running' : undefined"
              :active="runId === run.runId"
              keepable
              :kept="run.kept"
              :keep-loading="updating(run)"
              deletable
              :delete-disabled="busy(run)"
              :delete-loading="deletingId === run.runId"
              :delete-tooltip="busy(run) ? t('observe.cannotDeleteRunning') : t('observe.deleteBatch')"
              @click="openRun(run.runId)"
              @toggle-keep="toggleRetention(run)"
              @delete-item="remove(run)"
            />
            <p v-if="!loading && runs.length === 0" class="list-empty">{{ t("observe.noTestBatches") }}</p>
          </div>
        </template>
        <template #detail>
          <CaseArtifactPage v-if="caseId" />
          <ResultsPage
            v-else-if="runId"
            :key="runId"
            :run-id="runId"
            :kept="selectedRun?.kept"
            :retention-loading="selectedRun ? updating(selectedRun) : false"
            @deleted="removed"
            @settled="load($event)"
            @toggle-retention="selectedRun && toggleRetention(selectedRun)"
          />
          <EmptyState v-else icon="file-text" :title="t('observe.selectOrStartTest')" :subtitle="t('observe.selectOrStartTestHint')" />
        </template>
      </ListDetail>
    </div>
  </div>
</template>

<style scoped>
.autotest-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.autotest-tabs {
  display: flex;
  gap: var(--spacing-lg);
  padding: 0 var(--page-section-padding);
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color);
}
.autotest-tab {
  height: 40px;
  padding: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  cursor: pointer;
}
.autotest-tab:hover {
  color: var(--el-text-color-primary);
}
.autotest-tab.active {
  border-bottom-color: var(--el-color-primary);
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.autotest-tab:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.autotest-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.run-list {
  min-height: 120px;
}
.list-empty {
  margin: 24px 12px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
