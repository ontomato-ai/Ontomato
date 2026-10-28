<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LayoutDashboard, ShieldCheck } from "lucide-vue-next";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { AssistantDatasetSource } from "@ontomato/contracts/assistant-chat";
import { AddDatasetDialog } from "../../dashboard";
import { readDatasetSource } from "../assistant-host";

/** Actions on a dataset file of a conversation: its quality check and adding it to a dashboard. */
const props = defineProps<{ artifact: RuntimeArtifact; title?: string }>();
const emit = defineEmits<{ openDashboard: [id: string] }>();
const { t } = useI18n();
const source = ref<AssistantDatasetSource | null>(null);
const adding = ref(false);

onMounted(async () => {
  if (!/\.(csv|json)$/i.test(props.artifact.path) || props.artifact.path.endsWith(".chart.json")) return;
  source.value = await readDatasetSource(props.artifact.sessionId, props.artifact.id).catch(() => null);
});
</script>

<template>
  <template v-if="source">
    <el-popover v-if="source.qualityCheck" trigger="click" width="360" placement="bottom-end">
      <template #reference>
        <button type="button" class="dataset-action" :title="t('assistant.qualityCheck')" :aria-label="t('assistant.qualityCheck')">
          <ShieldCheck :size="15" />
        </button>
      </template>
      <pre class="qc">{{ JSON.stringify(source.qualityCheck, null, 2) }}</pre>
    </el-popover>
    <button
      type="button"
      class="dataset-action"
      :title="t('assistant.addToDashboard')"
      :aria-label="t('assistant.addToDashboard')"
      @click="adding = true"
    >
      <LayoutDashboard :size="15" />
    </button>
    <AddDatasetDialog
      v-model="adding"
      :session-id="artifact.sessionId"
      :artifact-id="artifact.id"
      :title="title || artifact.path"
      @added="emit('openDashboard', $event)"
    />
  </template>
</template>

<style scoped>
.dataset-action {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.dataset-action:hover {
  background: var(--el-fill-color);
  color: var(--el-color-primary);
}
.dataset-action:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
.qc {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: pre-wrap;
}
</style>
