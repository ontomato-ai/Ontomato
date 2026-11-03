<script setup lang="ts">
import { Globe } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

// The result is shown as plain text: the platform area renders no Markdown or HTML from a model reply.
defineProps<{
  title: string;
  result: string;
  running: boolean;
  placeholder: string;
}>();

const visible = defineModel<boolean>("visible", { required: true });
const content = defineModel<string>("content", { required: true });

const emit = defineEmits<{
  submit: [];
}>();
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="min(680px, calc(100vw - 32px))"
    :close-on-click-modal="false"
  >
    <el-form label-width="100px">
      <el-form-item :label="t('common.testContent')">
        <el-input v-model="content" type="textarea" :rows="5" :placeholder="placeholder" />
      </el-form-item>
    </el-form>
    <div v-if="result" class="test-result-box">
      <div class="test-result-title">
        <el-icon :size="16"><Globe /></el-icon>
        <span>{{ t("common.responseResult") }}</span>
      </div>
      <pre class="test-result-text">{{ result }}</pre>
    </div>
    <template #footer>
      <el-button @click="visible = false">{{ t("common.close") }}</el-button>
      <el-button type="primary" :loading="running" @click="emit('submit')">
        {{ t("common.sendTest") }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.test-result-box {
  margin-top: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.test-result-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--el-fill-color-light);
  font-weight: var(--font-medium);
  font-size: var(--text-sm);
  color: var(--el-text-color-regular);
  border-bottom: 1px solid var(--el-border-color-light);
}

.test-result-text {
  padding: var(--spacing-md);
  margin: 0;
  max-height: 300px;
  overflow: auto;
  font-size: var(--text-sm);
  line-height: 1.5;
  word-break: break-all;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
}
</style>
