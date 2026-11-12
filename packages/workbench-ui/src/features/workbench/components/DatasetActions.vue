<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LayoutDashboard, SlidersHorizontal } from "lucide-vue-next";
import AnalysisScopeDialog from "./AnalysisScopeDialog.vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { AssistantDatasetSource } from "@ontomato/contracts/assistant-chat";
import { AddDatasetDialog } from "../../dashboard";
import { readDatasetSource } from "../assistant-host";

/** Actions on a dataset file of a conversation: adjusting its scope and adding it to a dashboard. */
/** `title` is the dataset's name as the conversation shows it, which the add-to-dashboard dialog repeats. */
const props = defineProps<{ artifact: RuntimeArtifact; title: string }>();
const emit = defineEmits<{ openDashboard: [id: string] }>();
const { t } = useI18n();
const source = ref<AssistantDatasetSource | null>(null);
const adding = ref(false);
const adjusting = ref(false);

onMounted(async () => {
  if (!/\.(csv|json)$/i.test(props.artifact.path) || props.artifact.path.endsWith(".chart.json")) return;
  source.value = await readDatasetSource(props.artifact.sessionId, props.artifact.id).catch(() => null);
});
</script>

<template>
  <template v-if="source">
    <el-button class="scope-action" text size="small" :icon="SlidersHorizontal" @click="adjusting = true">{{ t('assistant.adjustScope') }}</el-button>
    <AnalysisScopeDialog v-model="adjusting" :artifact="artifact" :title="title" />
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
      :title="title"
      @added="emit('openDashboard', $event)"
    />
  </template>
</template>

<style scoped>
.scope-action { flex-shrink: 0; }
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
</style>
