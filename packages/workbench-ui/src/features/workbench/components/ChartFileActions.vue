<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { LayoutDashboard } from "lucide-vue-next";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { AddChartFileDialog } from "../../dashboard";

/** The conversation's chart file: it can be put on a dashboard as it is, and the dashboard opens on it. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const props = defineProps<{ artifact: RuntimeArtifact; title: string }>();
const emit = defineEmits<{ openDashboard: [id: string] }>();
const { t } = useI18n();
const adding = ref(false);
</script>

<template>
  <template v-if="artifact.path.endsWith('.chart.json')">
    <button
      type="button"
      class="chart-action"
      :title="t('assistant.addToDashboard')"
      :aria-label="t('assistant.addToDashboard')"
      @click="adding = true"
    >
      <LayoutDashboard :size="15" />
    </button>
    <AddChartFileDialog
      v-model="adding"
      :session-id="artifact.sessionId"
      :run-id="artifact.runId"
      :artifact-id="artifact.id"
      :title="title"
      @added="emit('openDashboard', $event)"
    />
  </template>
</template>

<style scoped>
.chart-action {
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
.chart-action:hover {
  background: var(--el-fill-color);
  color: var(--el-color-primary);
}
.chart-action:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
</style>
