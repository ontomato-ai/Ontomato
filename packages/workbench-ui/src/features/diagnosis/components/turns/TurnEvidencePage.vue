<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Search } from "lucide-vue-next";
import { useLocale } from "../../../../composables/useLocale";
import { relativeTime } from "../../../../utils/relative-time";
import { artifactRetentionRequestKey, diagnosisApi, setArtifactRetention } from "../../api";
import EmptyState from "../agent-chat/EmptyState.vue";
import ArtifactDetail from "../ArtifactDetail.vue";
import ListDetail from "../layout/ListDetail.vue";
import SidebarListItem from "../layout/SidebarListItem.vue";
import type { WorkspaceManifest } from "../layout/types";

/** Turn evidence: the page's own list of evidence packages, a search that builds one on demand, and the selected one. */
const route = useRoute();
const router = useRouter();
const { t } = useLocale();

const turns = ref<WorkspaceManifest[]>([]);
const loading = ref(false);
const searchInput = ref("");
const searching = ref(false);
const deletingKey = ref<string | null>(null);
const retentionKey = ref<string | null>(null);

/** The address is the only record of the selection. */
const selectedKey = computed(() => (typeof route.params.turnKey === "string" ? route.params.turnKey : null));
const identity = (turn: WorkspaceManifest) => turn.turnKey || turn.workspaceId;
const selected = computed(() => turns.value.find((turn) => identity(turn) === selectedKey.value));
const ordered = computed(() => [...turns.value].sort((a, b) => Number(!!b.kept) - Number(!!a.kept)));

function placeholder(turnKey: string): WorkspaceManifest {
  return { workspaceId: turnKey, turnKey, status: "collecting", createdAt: new Date().toISOString(), appLogCount: 0, llmCallCount: 0, backendLogCount: 0, errorCount: 0 };
}
function ensureListed(turnKey = selectedKey.value) {
  if (turnKey && !turns.value.some((turn) => identity(turn) === turnKey)) turns.value = [placeholder(turnKey), ...turns.value];
}

async function load() {
  loading.value = true;
  try {
    turns.value = (await diagnosisApi.listTurns()).data || [];
  } catch (error) {
    turns.value = [];
    console.error("Failed to load turns", error);
  } finally {
    ensureListed();
    loading.value = false;
  }
}

/** Keeps the conversation that is open beside the page. */
function go(turnKey: string | null) {
  const query = typeof route.query.sessionId === "string" ? { sessionId: route.query.sessionId } : {};
  void router.push({ path: turnKey ? `/observe/turn/${encodeURIComponent(turnKey)}` : "/observe/turn", query }).catch(() => {});
}

async function search() {
  const key = searchInput.value.trim();
  if (!key) return;
  if (!turns.value.some((turn) => identity(turn) === key)) {
    searching.value = true;
    try {
      await diagnosisApi.buildTurn(key);
      await load();
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : t("diagnosis.workspaceBuildFailed"));
      return;
    } finally {
      searching.value = false;
    }
  }
  searchInput.value = "";
  go(key);
}

async function remove(turn: WorkspaceManifest) {
  if (deletingKey.value) return;
  const key = identity(turn);
  try {
    await ElMessageBox.confirm(t("diagnosis.deleteWorkspaceConfirm", { id: key }), t("common.deleteConfirm"), {
      type: "warning",
      confirmButtonText: t("common.delete"),
      cancelButtonText: t("common.cancel"),
      confirmButtonClass: "el-button--danger",
    });
  } catch {
    return;
  }
  deletingKey.value = key;
  try {
    await diagnosisApi.deleteTurn(key);
    turns.value = turns.value.filter((item) => identity(item) !== key);
    if (selectedKey.value === key) go(null);
    ElMessage.success(t("diagnosis.workspaceDeleted"));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t("diagnosis.workspaceDeleteFailed"));
  } finally {
    deletingKey.value = null;
  }
}

async function toggleRetention(turn: WorkspaceManifest) {
  if (retentionKey.value) return;
  const key = identity(turn);
  retentionKey.value = artifactRetentionRequestKey("turn-workspace", key);
  try {
    const kept = await setArtifactRetention("turn-workspace", key, !turn.kept);
    turns.value = turns.value.map((item) => (identity(item) === key ? { ...item, kept } : item));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t("diagnosis.retentionUpdateFailed"));
  } finally {
    retentionKey.value = null;
  }
}
const updating = (turn: WorkspaceManifest) =>
  retentionKey.value === artifactRetentionRequestKey("turn-workspace", identity(turn));

watch(selectedKey, (key) => ensureListed(key));
onMounted(load);
</script>

<template>
  <ListDetail :selected="!!selectedKey" @back="go(null)">
    <template #toolbar>
      <el-input
        v-model="searchInput"
        v-loading="searching"
        :placeholder="t('observe.inputTurnKey')"
        clearable
        @keyup.enter="search"
      >
        <template #prefix><Search :size="14" /></template>
      </el-input>
    </template>
    <template #list>
      <div v-loading="loading" class="turn-list">
        <SidebarListItem
          v-for="turn in ordered"
          :key="identity(turn)"
          :title="turn.question?.replace(/\s+/g, ' ').trim() || identity(turn)"
          :subtitle="turn.createdAt ? relativeTime(turn.createdAt) : ''"
          :status="turn.status === 'collecting' ? 'running' : turn.status === 'failed' ? 'failed' : undefined"
          :active="selectedKey === identity(turn)"
          keepable
          :kept="turn.kept"
          :keep-loading="updating(turn)"
          deletable
          :delete-loading="deletingKey === identity(turn)"
          :delete-tooltip="t('observe.deleteWorkspace')"
          @click="go(identity(turn))"
          @toggle-keep="toggleRetention(turn)"
          @delete-item="remove(turn)"
        />
        <p v-if="!loading && turns.length === 0" class="list-empty">{{ t("observe.noTurns") }}</p>
      </div>
    </template>
    <template #detail>
      <div v-if="selected?.status === 'collecting'" v-loading="true" class="turn-loading" />
      <ArtifactDetail
        v-else-if="selectedKey"
        :key="selectedKey"
        :api-prefix="diagnosisApi.turnArtifactUrl(selectedKey)"
        :title="selectedKey"
        :trigger-build-url="diagnosisApi.turnBuildUrl()"
        :trigger-build-body="{ turnKey: selectedKey }"
        :kept="selected?.kept"
        :retention-loading="selected ? updating(selected) : false"
        @loaded="load"
        @toggle-retention="selected && toggleRetention(selected)"
      />
      <EmptyState v-else icon="search" :title="t('observe.selectOrSearchTurn')" :subtitle="t('observe.selectOrSearchTurnHint')" />
    </template>
  </ListDetail>
</template>

<style scoped>
.turn-list {
  min-height: 120px;
}
.list-empty {
  margin: 24px 12px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  text-align: center;
}
.turn-loading {
  height: 100%;
  min-height: 240px;
}
</style>
