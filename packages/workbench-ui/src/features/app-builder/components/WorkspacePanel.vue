<script setup lang="ts">
import { reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ChangeTarget, PanelTab } from "../panel";
import type { WorkspaceView } from "../workspace-view";
import ChangesTab from "./ChangesTab.vue";
import FilesTab from "./FilesTab.vue";
import HistoryTab from "./HistoryTab.vue";
import PreviewTab from "./PreviewTab.vue";

/**
 * The open workspace beside the conversation, or full in its place: the shell keeps this component mounted while it
 * moves between the two, so the preview frame is the same frame. A view is mounted the first time it is shown and then
 * kept, so the running app, the open file and each scroll position survive switching views.
 */
const props = defineProps<{ view: WorkspaceView; tab: PanelTab; reload: number; flash: string | null }>();
const file = defineModel<string | null>("file", { required: true });
const target = defineModel<ChangeTarget>("target", { required: true });
const emit = defineEmits<{ showChanges: [commit: string] }>();
const { t } = useI18n();

const shown = reactive<Record<PanelTab, boolean>>({ preview: false, files: false, changes: false, history: false });
watch(() => props.tab, (tab) => (shown[tab] = true), { immediate: true });
</script>

<template>
  <div class="workspace-panel">
    <div v-if="view.error" class="panel-alert" role="alert">
      <span>{{ view.error }}</span>
      <el-button text size="small" @click="view.refresh()">{{ t("common.retry") }}</el-button>
    </div>
    <div v-if="view.workspace" class="panel-views">
      <PreviewTab v-if="shown.preview" v-show="tab === 'preview'" :view="view" :reload="reload" :flash="flash" />
      <FilesTab v-if="shown.files" v-show="tab === 'files'" v-model:file="file" :view="view" />
      <ChangesTab v-if="shown.changes" v-show="tab === 'changes'" v-model:target="target" :view="view" />
      <HistoryTab v-if="shown.history" v-show="tab === 'history'" :view="view" @show-changes="emit('showChanges', $event)" />
    </div>
    <div v-else-if="!view.error" class="panel-state" aria-busy="true">{{ t("assistant.loading") }}</div>
  </div>
</template>

<style scoped>
.workspace-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.panel-views {
  flex: 1;
  min-height: 0;
}
.panel-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--spacing-sm) var(--spacing-lg);
  flex-shrink: 0;
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
.panel-alert span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.panel-state {
  padding: var(--spacing-2xl) var(--spacing-lg);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  text-align: center;
}
</style>
