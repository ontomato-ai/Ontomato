<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { CodeEditor } from "@ontomato/foundation-ui/code";

defineProps<{
  collapsed: boolean;
  width: number;
  casesCount: number;
  jsonText: string;
  jsonError: string;
}>();

const emit = defineEmits<{
  "update:collapsed": [value: boolean];
  "json-focus": [];
  "json-blur": [];
  "json-input": [value: string];
}>();

const { t } = useI18n();
</script>

<template>
  <aside v-if="!collapsed" class="panel-right" :style="{ width: width + 'px' }">
    <div class="panel-header json-header">
      <div class="panel-header-title">
        <span class="panel-title">{{ t("hotData.jsonEdit") }}</span>
        <span class="panel-count">{{ casesCount }}{{ t("hotData.entries") }}</span>
      </div>
      <el-button
        class="json-toggle-button"
        text
        size="small"
        @click="emit('update:collapsed', true)"
      >
        {{ t("common.collapse") }}
      </el-button>
    </div>
    <div class="json-editor-body">
      <!-- While the JSON has focus the page leaves its text alone; on leaving, it writes the cases back in order. -->
      <div class="json-editor" @focusin="emit('json-focus')" @focusout="emit('json-blur')">
        <CodeEditor
          :model-value="jsonText"
          language="json"
          :min-height="120"
          placeholder='[{"caseId":"1","question":"..."}]'
          @update:model-value="emit('json-input', $event)"
        />
      </div>
      <div v-if="jsonError" class="json-error">{{ jsonError }}</div>
    </div>
  </aside>

  <button v-else class="json-expand-button" type="button" @click="emit('update:collapsed', false)">
    <span class="json-expand-icon">{ }</span>
    <span>JSON</span>
  </button>
</template>

<style scoped>
/* The page's areas paint no background of their own: in dark mode the application's area is the darkest band. */
.panel-right {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-width: 220px;
  max-width: 760px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 0.5px solid var(--observe-border, var(--el-border-color));
  flex-shrink: 0;
}

.panel-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--el-text-color-secondary);
  letter-spacing: 0;
}

.panel-count {
  font-size: var(--text-xs);
  color: var(--el-text-color-tertiary);
}

.panel-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.json-header {
  gap: 8px;
}

.json-toggle-button {
  flex-shrink: 0;
}

.json-editor-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  background: var(--el-bg-color);
}

.json-editor {
  flex: 1;
  min-height: 0;
}

.json-editor :deep(.code-editor) {
  height: 100%;
  border: none;
  border-radius: 0;
}

.json-error {
  flex-shrink: 0;
  padding: 0 12px 10px;
  font-size: var(--text-sm);
  color: var(--el-color-danger);
}

.json-expand-button {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  color: var(--el-text-color-regular);
  background: var(--observe-bg-card, var(--el-bg-color));
  border: 0.5px solid var(--observe-border, var(--el-border-color));
  border-radius: 8px;
  box-shadow: var(--elevation-overlay);
  cursor: pointer;
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
  font-family: inherit;
  font-size: 12px;
}

.json-expand-button:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-5);
  box-shadow: var(--elevation-overlay);
}

.json-expand-icon {
  font-family: var(--font-mono);
  color: var(--el-color-primary);
}
</style>
