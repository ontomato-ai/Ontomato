<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { LoaderCircle, Presentation } from "lucide-vue-next";
import { exportConversationPpt } from "../assistant-host";

/** Actions under an answer that apply to the whole conversation. */
const props = defineProps<{ sessionId: string }>();
const { t } = useI18n();
const exporting = ref(false);

async function exportPpt() {
  exporting.value = true;
  try {
    const { blob, fileName } = await exportConversationPpt(props.sessionId);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t("assistant.exportFailed"));
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    class="conversation-action"
    :disabled="exporting"
    :title="t('assistant.exportPpt')"
    :aria-label="t('assistant.exportPpt')"
    @click="exportPpt"
  >
    <LoaderCircle v-if="exporting" :size="15" class="spin" />
    <Presentation v-else :size="15" />
  </button>
</template>

<style scoped>
.conversation-action {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-tertiary);
  cursor: pointer;
}
.conversation-action:hover:not(:disabled) {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
.conversation-action:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
