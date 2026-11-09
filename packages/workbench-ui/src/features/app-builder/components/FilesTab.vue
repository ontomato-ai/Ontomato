<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { FileCode, FileText } from "lucide-vue-next";
import CodeMirrorEditor from "../../../components/CodeMirrorEditor.vue";
import { builderApi } from "../api";
import { errorText } from "../panel";
import type { WorkspaceView } from "../workspace-view";

/**
 * The workspace's current files, read only: the agent edits them. The code is drawn by the platform's read-only code
 * view; a file that is not text is named, not shown. The open file is read again when it changes or HEAD moves.
 */
const props = defineProps<{ view: WorkspaceView }>();
const file = defineModel<string | null>("file", { required: true });
const { t } = useI18n();

const LANGUAGES: Record<string, "html" | "javascript" | "json" | "markdown" | "text"> = {
  html: "html", htm: "html", svg: "html", xml: "html",
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "javascript",
  json: "json", md: "markdown",
  css: "text", txt: "text", csv: "text", yml: "text", yaml: "text",
};
const extension = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();
const isText = (path: string) => extension(path) in LANGUAGES;

/** The page first, then the rest in path order. */
const files = computed(() =>
  [...props.view.files].sort((a, b) => Number(b.path === "index.html") - Number(a.path === "index.html") || a.path.localeCompare(b.path)),
);
const content = ref<string | null>(null);
const error = ref<string | null>(null);
let reads = 0;

async function read() {
  const workspace = props.view.workspace;
  const path = file.value;
  const attempt = ++reads;
  content.value = null;
  error.value = null;
  if (!workspace || !path || !isText(path)) return;
  try {
    const text = await builderApi.content(workspace.id, path);
    if (attempt === reads) content.value = text;
  } catch (reason) {
    if (attempt === reads) error.value = errorText(reason);
  }
}

watch([() => props.view.workspace?.id, () => props.view.workspace?.headCommit, file], read, { immediate: true });
</script>

<template>
  <div class="files">
    <div v-if="view.filesState === 'error'" class="files-state" role="alert">
      {{ t("assistant.loadFailed") }}
      <el-button size="small" @click="view.loadFiles()">{{ t("common.retry") }}</el-button>
    </div>
    <div v-else-if="view.filesState === 'ready' && files.length === 0" class="files-state">{{ t("appBuilder.previewEmpty") }}</div>
    <template v-else>
      <ul class="tree" :aria-label="t('appBuilder.tabFiles')">
        <li v-for="entry in files" :key="entry.path">
          <button
            type="button"
            class="tree-row"
            :class="{ active: entry.path === file }"
            :aria-current="entry.path === file ? 'true' : undefined"
            @click="file = entry.path"
          >
            <FileCode v-if="isText(entry.path)" :size="14" aria-hidden="true" />
            <FileText v-else :size="14" aria-hidden="true" />
            <span class="tree-name">{{ entry.path }}</span>
          </button>
        </li>
      </ul>
      <div class="viewer">
        <div v-if="file" class="viewer-head">
          <span class="viewer-path">{{ file }}</span>
        </div>
        <div v-if="error" class="files-state" role="alert">
          {{ error }}
          <el-button size="small" @click="read">{{ t("common.retry") }}</el-button>
        </div>
        <div v-else-if="file && !isText(file)" class="files-state">{{ t("appBuilder.notText") }}</div>
        <div v-else-if="content !== null" class="code">
          <CodeMirrorEditor :key="file!" :model-value="content" :language="LANGUAGES[extension(file!)]" readonly :min-height="120" />
        </div>
        <div v-else class="files-state" aria-busy="true">{{ t("assistant.loading") }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* The tree and the open file sit together as one block of the page, with a hairline between them. */
.files {
  display: flex;
  height: 100%;
  min-height: 0;
}
.tree {
  flex: 0 0 200px;
  margin: 0;
  padding: var(--spacing-sm);
  overflow-y: auto;
  list-style: none;
  border-right: 1px solid var(--el-border-color-lighter);
}
.tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--el-text-color-regular);
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
}
.tree-row:hover {
  background: var(--el-fill-color-light);
}
.tree-row.active {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.tree-row svg {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.tree-row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
}
.viewer {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.viewer-head {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 0 var(--spacing-lg);
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.viewer-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--el-text-color-primary);
}
.code {
  flex: 1;
  min-height: 0;
  padding: var(--spacing-md);
}
.code :deep(.codemirror-editor) {
  height: 100%;
}
.code :deep(.cm-editor) {
  height: 100%;
}
.files-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: auto;
  padding: var(--spacing-xl);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  text-align: center;
}
@container page (max-width: 520px) {
  .files {
    flex-direction: column;
  }
  .tree {
    flex: 0 0 auto;
    max-height: 128px;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
}
</style>
