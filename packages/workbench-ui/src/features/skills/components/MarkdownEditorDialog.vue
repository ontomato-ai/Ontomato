<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { CodeEditor } from "@ontomato/foundation-ui/code";

const { t } = useI18n();

const visible = defineModel<boolean>("visible");
const content = defineModel<string>("content");

const props = defineProps<{
  title?: string;
  readonly?: boolean;
}>();

const localContent = ref("");
const showPreview = ref(false);

const dialogTitle = computed(() => props.title || t("common.editMarkdown"));

const markdownPlaceholder = computed(() => t("common.markdownEditorPlaceholder"));

watch(visible, (val) => {
  if (val) {
    localContent.value = content.value || "";
    showPreview.value = false;
  }
});

watch(localContent, (val) => {
  if (visible.value) {
    content.value = val;
  }
});

function handleSave() {
  content.value = localContent.value;
  visible.value = false;
}

function handleCancel() {
  visible.value = false;
}

function togglePreview() {
  showPreview.value = !showPreview.value;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="900px"
    :close-on-click-modal="false"
    class="markdown-editor-dialog"
  >
    <div class="editor-container">
      <div class="editor-header">
        <el-button size="small" @click="togglePreview">
          {{ showPreview ? t("common.hidePreview") : t("common.showPreview") }}
        </el-button>
        <span class="char-count">{{ localContent.length }} {{ t("common.characters") }}</span>
      </div>

      <div class="editor-main" :class="{ 'with-preview': showPreview }">
        <div class="editor-panel">
          <CodeEditor
            v-model="localContent"
            :readonly="readonly"
            language="markdown"
            :min-height="showPreview ? 350 : 400"
            :placeholder="markdownPlaceholder"
          />
        </div>

        <div v-if="showPreview" class="preview-panel">
          <div class="panel-label">{{ t("common.preview") }}</div>
          <div class="markdown-preview"><MarkdownView :content="localContent" /></div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="handleCancel">{{ readonly ? t("common.close") : t("common.cancel") }}</el-button>
      <el-button v-if="!readonly" type="primary" @click="handleSave">{{ t("common.save") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.editor-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.char-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.editor-main {
  display: flex;
  gap: 12px;
}

.editor-main.with-preview {
  height: 400px;
}

.editor-panel,
.preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-label {
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color);
}

.preview-panel {
  background: var(--el-bg-color-page);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}

.markdown-preview {
  flex: 1;
  padding: 12px;
  overflow-y: auto;
}
</style>
