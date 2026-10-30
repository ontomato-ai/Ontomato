<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ScheduledTaskRun } from "@ontomato/contracts/scheduled-tasks";
import { scheduledTasksApi } from "../api";
import { useRunLabels } from "../labels";

/** One task's runs, newest first; each opens its conversation. */
const props = defineProps<{ taskId: string }>();
const emit = defineEmits<{ openSession: [sessionId: string] }>();
const { t } = useI18n();
const labels = useRunLabels();

const runs = ref<ScheduledTaskRun[]>([]);
const cursor = ref<string | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");

async function load(more = false) {
  state.value = "loading";
  try {
    const page = await scheduledTasksApi.runs(props.taskId, more ? cursor.value : null);
    runs.value = more ? [...runs.value, ...page.runs] : page.runs;
    cursor.value = page.nextCursor;
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

defineExpose({ reload: () => load() });
onMounted(() => void load());
</script>

<template>
  <div class="runs">
    <div v-if="state === 'loading' && runs.length === 0" class="note" aria-busy="true">{{ t("common.loading") }}</div>
    <div v-else-if="state === 'error'" class="note">
      {{ t("scheduledTasks.runsLoadFailed") }}
      <button type="button" class="link" @click="load()">{{ t("common.retry") }}</button>
    </div>
    <div v-else-if="runs.length === 0" class="note">{{ t("scheduledTasks.noRuns") }}</div>
    <ul v-else>
      <li v-for="run in runs" :key="run.id" class="run">
        <span class="when">{{ labels.time(run.startedAt) }}</span>
        <el-tag size="small" effect="plain" :type="labels.statusType(run.status)">{{ labels.status(run.status) }}</el-tag>
        <span class="trigger">{{ labels.trigger(run.trigger) }}</span>
        <span v-if="run.error" class="error">{{ labels.error(run.error) }}</span>
        <button v-if="run.sessionId" type="button" class="link open" @click="emit('openSession', run.sessionId)">
          {{ t("scheduledTasks.openConversation") }}
        </button>
      </li>
      <li v-if="cursor">
        <button type="button" class="link" :disabled="state === 'loading'" @click="load(true)">{{ t("common.loadMore") }}</button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.runs {
  padding: 4px 0 0;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.run {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
}
.when {
  color: var(--el-text-color-regular);
  font-variant-numeric: tabular-nums;
}
.trigger {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.error {
  flex-basis: 100%;
  color: var(--el-color-danger);
  font-size: var(--text-xs);
  line-height: 1.5;
  word-break: break-word;
}
.open {
  margin-left: auto;
}
.note {
  font-size: var(--text-sm);
  color: var(--el-text-color-tertiary);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--el-color-primary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.link:disabled {
  cursor: default;
  opacity: 0.6;
}
.link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
