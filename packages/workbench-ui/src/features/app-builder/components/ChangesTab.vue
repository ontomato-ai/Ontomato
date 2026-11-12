<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { formatRelativeTime } from "../../../utils/relative-time";
import { builderApi } from "../api";
import { patchFiles, type PatchFile } from "../patch";
import { errorText, shortCommit, type ChangeTarget } from "../panel";
import type { WorkspaceView } from "../workspace-view";

/**
 * What one commit changed against its parent, or what the current files change against HEAD: git's patch from the
 * workspace, shown file by file. A commit an older answer names may lie beyond the history read so far; older pages
 * are read until it is found.
 */
const props = defineProps<{ view: WorkspaceView }>();
const target = defineModel<ChangeTarget>("target", { required: true });
const { t } = useI18n();

const commit = computed(() => {
  if (target.value === "working") return null;
  const id = target.value === "latest" ? props.view.commits[0]?.id : target.value;
  return props.view.commits.find((item) => item.id === id) ?? null;
});
const parent = computed(() => commit.value?.parentIds[0] ?? null);
/** What the patch compares; null while the commit is not read yet, and for the workspace's first commit. */
const range = computed(() => {
  const workspace = props.view.workspace;
  if (!workspace) return null;
  if (target.value === "working") return { from: workspace.headCommit, to: "working" };
  return commit.value && parent.value ? { from: parent.value, to: commit.value.id } : null;
});
const selected = computed({
  get: () => (target.value === "latest" ? (props.view.commits[0]?.id ?? "") : target.value),
  set: (value: string) => (target.value = value),
});
const comparison = computed(() => {
  if (target.value === "working") return t("appBuilder.workingComparedWith", { commit: shortCommit(props.view.workspace?.headCommit ?? "") });
  if (!commit.value) return "";
  return parent.value ? t("appBuilder.comparedWith", { commit: shortCommit(parent.value) }) : t("appBuilder.initialCommit");
});

const files = ref<PatchFile[] | null>(null);
const error = ref<string | null>(null);
let reads = 0;
const totals = computed(() => ({
  added: files.value?.reduce((sum, file) => sum + file.added, 0) ?? 0,
  removed: files.value?.reduce((sum, file) => sum + file.removed, 0) ?? 0,
}));
const KINDS = { added: "appBuilder.fileAdded", modified: "appBuilder.fileModified", deleted: "appBuilder.fileDeleted" } as const;

async function read() {
  const workspace = props.view.workspace;
  const current = range.value;
  const attempt = ++reads;
  files.value = null;
  error.value = null;
  if (!workspace || !current) return;
  try {
    const patch = await builderApi.diff(workspace.id, current.from, current.to);
    if (attempt === reads) files.value = patchFiles(patch);
  } catch (reason) {
    if (attempt === reads) error.value = errorText(reason);
  }
}

watch(() => range.value && `${range.value.from}:${range.value.to}`, read, { immediate: true });
watch(
  [target, () => props.view.commitsState],
  ([id, state]) => {
    if (state !== "ready" || id === "latest" || id === "working" || !props.view.moreCommits) return;
    if (!props.view.commits.some((item) => item.id === id)) void props.view.loadCommits(true);
  },
  { immediate: true },
);
</script>

<template>
  <div class="changes">
    <div class="changes-bar">
      <el-select v-model="selected" class="commit-select" :aria-label="t('appBuilder.tabChanges')">
        <el-option value="working" :label="t('appBuilder.uncommitted')" />
        <el-option v-for="item in view.commits" :key="item.id" :value="item.id" :label="`${shortCommit(item.id)} · ${item.message}`">
          <span class="option">
            <span class="option-hash">{{ shortCommit(item.id) }}</span>
            <span class="option-message">{{ item.message }}</span>
            <span class="option-time">{{ formatRelativeTime(item.createdAt) }}</span>
          </span>
        </el-option>
      </el-select>
      <span class="comparison">{{ comparison }}</span>
    </div>

    <div v-if="view.commitsState === 'error'" class="changes-state" role="alert">
      {{ t("assistant.loadFailed") }}
      <el-button size="small" @click="view.loadCommits()">{{ t("common.retry") }}</el-button>
    </div>
    <div v-else-if="error" class="changes-state" role="alert">
      {{ error }}
      <el-button size="small" @click="read">{{ t("common.retry") }}</el-button>
    </div>
    <template v-else-if="range">
      <div v-if="files === null" class="changes-state" aria-busy="true">{{ t("assistant.loading") }}</div>
      <div v-else-if="files.length === 0" class="changes-state">{{ t("appBuilder.noChanges") }}</div>
      <template v-else>
        <p class="summary">
          {{ t("appBuilder.filesChanged", { n: files.length }, files.length) }} ·
          <span class="add">+{{ totals.added }}</span> <span class="remove">−{{ totals.removed }}</span>
        </p>
        <section v-for="file in files" :key="file.path" class="diff-file">
          <header class="diff-head">
            <span class="diff-path">{{ file.path }}</span>
            <span class="diff-kind">{{ t(KINDS[file.change]) }}</span>
            <span class="diff-stat"><span class="add">+{{ file.added }}</span> <span class="remove">−{{ file.removed }}</span></span>
          </header>
          <p v-if="file.binary" class="binary">{{ t("appBuilder.binaryChanged") }}</p>
          <!-- Long lines wrap inside the panel; a wrapped line keeps its old and new numbers on its first row. -->
          <table v-else class="diff-table">
            <colgroup>
              <col class="col-number" />
              <col class="col-number" />
              <col class="col-sign" />
              <col />
            </colgroup>
            <tbody>
              <tr v-for="(line, index) in file.lines" :key="index" :class="`line-${line.kind}`">
                <template v-if="line.kind === 'hunk' || line.kind === 'note'">
                  <td class="number" colspan="3" />
                  <td class="text">{{ line.text }}</td>
                </template>
                <template v-else>
                  <td class="number">{{ line.before }}</td>
                  <td class="number">{{ line.after }}</td>
                  <td class="sign">{{ line.kind === "add" ? "+" : line.kind === "remove" ? "−" : "" }}</td>
                  <td class="text">{{ line.text }}</td>
                </template>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.changes {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  height: 100%;
  box-sizing: border-box;
  /* Full, the shell's composer floats over the foot; the list keeps that room after its content. */
  padding: var(--spacing-md) var(--spacing-lg) calc(var(--spacing-xl) + var(--pane-dock-space, 0px));
  overflow-y: auto;
}
.changes-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-md);
}
.commit-select {
  width: 340px;
  max-width: 100%;
}
.comparison,
.summary {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.option-hash {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
.option-message {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.option-time {
  font-size: var(--text-xs);
  color: var(--el-text-color-placeholder);
  white-space: nowrap;
}
.changes-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: var(--spacing-2xl) var(--spacing-lg);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  text-align: center;
}
.diff-file {
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
}
.diff-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-light);
  background: var(--el-fill-color-lighter);
  font-size: var(--text-xs);
}
.diff-path {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--el-text-color-primary);
}
.diff-kind {
  padding: 0 6px;
  border-radius: var(--radius-xs);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  line-height: 18px;
}
.diff-stat {
  margin-left: auto;
  font-family: var(--font-mono);
}
.add {
  color: var(--el-color-success);
}
.remove {
  color: var(--el-color-danger);
}
.binary {
  margin: 0;
  padding: var(--spacing-md);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.diff-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 20px;
}
.col-number {
  width: 48px;
}
.col-sign {
  width: 18px;
}
.diff-table td {
  padding: 0;
  vertical-align: top;
}
.number {
  padding: 0 8px !important;
  overflow: hidden;
  text-align: right;
  white-space: nowrap;
  color: var(--el-text-color-placeholder);
  user-select: none;
}
.sign {
  text-align: center;
  color: var(--el-text-color-secondary);
  user-select: none;
}
.text {
  padding-right: var(--spacing-md) !important;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--el-text-color-primary);
}
tr.line-add {
  background: color-mix(in srgb, var(--el-color-success) 12%, var(--el-bg-color));
}
tr.line-add .sign {
  color: var(--el-color-success);
}
tr.line-remove {
  background: color-mix(in srgb, var(--el-color-danger) 10%, var(--el-bg-color));
}
tr.line-remove .sign {
  color: var(--el-color-danger);
}
tr.line-hunk td,
tr.line-note td {
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-secondary);
}
</style>
