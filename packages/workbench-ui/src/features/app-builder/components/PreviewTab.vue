<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Check, CircleAlert, Files, LoaderCircle } from "lucide-vue-next";
import type { WorkspacePreviewToken } from "@ontomato/contracts/workspaces";
import { apiUrl } from "../../../utils/api-base";
import { getSynchronizedNow } from "../../../utils/server-time";
import { builderApi } from "../api";
import { errorText } from "../panel";
import type { WorkspaceView } from "../workspace-view";

/**
 * The workspace's current files running as the app, in a frame of the platform's own origin: like a published app it
 * reads the platform's host port for the reader, the theme and the language. The frame is loaded again when the
 * workspace's HEAD moves (a run's commit, a restore) or the reader asks; never while a run is still writing. Its token
 * is read again only when the next load finds it expired.
 */
const props = defineProps<{ view: WorkspaceView; reload: number; flash: string | null }>();
const { t } = useI18n();

let token: (WorkspacePreviewToken & { workspaceId: string }) | null = null;
let loads = 0;
const src = ref<string | null>(null);
const frame = ref(0);
const error = ref<string | null>(null);
const hasPage = computed(() => props.view.files.some((file) => file.path === "index.html"));
const workspace = computed(() => props.view.workspace);

async function load() {
  const current = workspace.value;
  const attempt = ++loads;
  error.value = null;
  if (!current || !hasPage.value) {
    src.value = null;
    return;
  }
  try {
    if (!token || token.workspaceId !== current.id || Date.parse(token.expiresAt) <= getSynchronizedNow())
      token = { ...(await builderApi.previewToken(current.id)), workspaceId: current.id };
    if (attempt !== loads) return;
    src.value = apiUrl(`/workspaces/${encodeURIComponent(current.id)}/preview/${encodeURIComponent(token.token)}/index.html`);
    frame.value++;
  } catch (reason) {
    if (attempt === loads) error.value = errorText(reason);
  }
}

watch([() => workspace.value?.id, () => workspace.value?.headCommit, hasPage, () => props.reload], load, { immediate: true });
</script>

<template>
  <div class="preview">
    <div class="preview-frame">
      <div v-if="workspace?.activeRunId" class="frame-banner" role="status">
        <LoaderCircle :size="13" class="spin" aria-hidden="true" />
        <span>{{ t("appBuilder.previewRunning") }}</span>
      </div>
      <div v-else-if="flash" class="frame-banner" role="status">
        <Check :size="13" class="ok" aria-hidden="true" />
        <span>{{ flash }}</span>
      </div>
      <iframe v-if="src" :key="frame" :src="src" :title="t('appBuilder.tabPreview')" class="app-frame" />
      <div v-else-if="error" class="frame-state" role="alert">
        <CircleAlert :size="20" aria-hidden="true" />
        <p>{{ error }}</p>
        <el-button size="small" @click="load">{{ t("common.retry") }}</el-button>
      </div>
      <div v-else-if="view.filesState === 'error'" class="frame-state" role="alert">
        <CircleAlert :size="20" aria-hidden="true" />
        <p>{{ t("assistant.loadFailed") }}</p>
        <el-button size="small" @click="view.loadFiles()">{{ t("common.retry") }}</el-button>
      </div>
      <div v-else-if="view.filesState === 'ready' && !hasPage" class="frame-state">
        <Files :size="28" aria-hidden="true" />
        <p class="state-title">{{ t("appBuilder.previewEmpty") }}</p>
        <span>{{ t("appBuilder.previewEmptyHint") }}</span>
      </div>
      <div v-else class="frame-state" aria-busy="true">
        <LoaderCircle :size="18" class="spin" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The app sits in its own frame on the panel, so the page it draws never runs into the panel's edges. */
.preview {
  display: flex;
  height: 100%;
  box-sizing: border-box;
  padding: var(--spacing-md);
  background: var(--el-fill-color-lighter);
}
.preview-frame {
  position: relative;
  display: flex;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
}
.app-frame {
  flex: 1;
  width: 100%;
  height: 100%;
  border: 0;
}
.frame-banner {
  position: absolute;
  z-index: 1;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 24px);
  padding: 4px 12px;
  box-sizing: border-box;
  border-radius: var(--radius-full);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
  color: var(--el-text-color-regular);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  white-space: nowrap;
}
.frame-banner span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.frame-banner svg {
  flex-shrink: 0;
}
.ok {
  color: var(--el-color-success);
}
.frame-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: auto;
  padding: var(--spacing-xl);
  max-width: 320px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.frame-state p {
  margin: 4px 0 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.frame-state .state-title {
  color: var(--el-text-color-primary);
  font-weight: var(--font-medium);
}
.frame-state svg {
  color: var(--el-text-color-placeholder);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
