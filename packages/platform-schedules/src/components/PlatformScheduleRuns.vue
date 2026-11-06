<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { PlatformTask, PlatformTaskRun } from "@ontomato/contracts/platform-schedules";
import type { SchedulesApi } from "../api";
import type { Translate } from "../i18n";
import { runSeconds } from "../frequency";
import { useSchedulesLabels } from "../labels";

/**
 * One task's runs, newest first, a page at a time. An agent run opens the conversation it started; a function run
 * shows what the function returned, its error and its duration, which is all the service keeps of it.
 */
const props = defineProps<{
  api: SchedulesApi;
  task: PlatformTask;
  t: Translate;
}>();
const emit = defineEmits<{ openSession: [sessionId: string] }>();
const labels = useSchedulesLabels();

const runs = ref<PlatformTaskRun[]>([]);
// Path back through the pages: the last entry is the one shown, so "previous" drops it.
const cursors = ref<(string | null)[]>([null]);
const nextCursor = ref<string | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
/** The run whose own record is expanded; its detail is read again so a function's result stays current. */
const detail = ref<PlatformTaskRun | null>(null);
const page = computed(() => cursors.value.length);

async function load(cursor: string | null) {
  state.value = "loading";
  try {
    const result = await props.api.runs(props.task.id, cursor);
    runs.value = result.runs;
    nextCursor.value = result.nextCursor;
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

function next() {
  if (!nextCursor.value) return;
  cursors.value = [...cursors.value, nextCursor.value];
  void load(nextCursor.value);
}

function previous() {
  if (cursors.value.length <= 1) return;
  const rest = cursors.value.slice(0, -1);
  cursors.value = rest;
  void load(rest[rest.length - 1] ?? null);
}

/** Reads one run's own record: the function's result and duration arrive with it. */
async function showDetail(run: PlatformTaskRun) {
  if (detail.value?.id === run.id) {
    detail.value = null;
    return;
  }
  try {
    detail.value = await props.api.run(props.task.id, run.id);
  } catch {
    detail.value = run;
  }
}

defineExpose({ reload: () => load(cursors.value[cursors.value.length - 1] ?? null) });
onMounted(() => void load(null));
</script>

<template>
  <div class="runs">
    <div v-if="state === 'loading' && runs.length === 0" class="note" aria-busy="true">{{ t("runs.title") }}…</div>
    <div v-else-if="state === 'error'" class="note">
      {{ t("runs.loadFailed") }}
      <button type="button" class="link" @click="load(cursors[cursors.length - 1] ?? null)">
        {{ t("retry") }}
      </button>
    </div>
    <div v-else-if="runs.length === 0" class="note">{{ t("runs.empty") }}</div>
    <template v-else>
      <table class="run-table">
        <thead>
          <tr>
            <th scope="col">{{ t("runs.columns.started") }}</th>
            <th scope="col">{{ t("runs.columns.trigger") }}</th>
            <th scope="col">{{ t("runs.columns.status") }}</th>
            <th scope="col">{{ t("runs.columns.detail") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="run in runs" :key="run.id">
            <td class="when">{{ labels.time(run.startedAt) }}</td>
            <td>{{ labels.trigger(run.trigger) }}</td>
            <td>
              <el-tag size="small" effect="plain" :type="labels.statusType(run.status)">
                {{ labels.status(run.status) }}
              </el-tag>
            </td>
            <td class="detail">
              <button type="button" class="link" @click="showDetail(run)">
                {{ detail?.id === run.id ? t("runs.hide") : t("runs.view") }}
              </button>
              <span v-if="run.error" class="error">{{ labels.error(run.error) }}</span>
              <span v-if="run.spendTime !== null" class="spend">
                {{ t("runs.duration", { seconds: runSeconds(run) }) }}
              </span>
              <button
                v-if="run.sessionId && task.target.kind === 'agent'"
                type="button"
                class="link"
                @click="emit('openSession', run.sessionId)"
              >
                {{ t("runs.openSession") }}
              </button>
              <span v-else-if="run.sessionId" class="session">{{ t("runs.session", { id: run.sessionId }) }}</span>
              <p v-if="detail?.id === run.id && detail.result" class="result">{{ detail.result }}</p>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="pager">
        <el-button size="small" :disabled="page <= 1 || state === 'loading'" @click="previous">
          {{ t("runs.previous") }}
        </el-button>
        <span class="page">{{ t("runs.page", { page }) }}</span>
        <el-button size="small" :disabled="!nextCursor || state === 'loading'" @click="next">
          {{ t("runs.next") }}
        </el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.runs {
  padding: var(--spacing-xs) 0 0;
  overflow-x: auto;
}
.run-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.run-table th {
  height: var(--table-head-height);
  padding: 0 var(--spacing-sm);
  text-align: left;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: var(--tracking-label);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border-bottom: 1px solid var(--el-border-color);
}
.run-table td {
  padding: var(--spacing-sm);
  border-bottom: 1px solid var(--el-border-color-lighter);
  vertical-align: top;
}
.when {
  color: var(--el-text-color-regular);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.detail {
  display: table-cell;
}
.detail > * + * {
  margin-left: var(--spacing-sm);
}
.error {
  color: var(--el-color-danger);
}
.spend,
.session {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.session {
  font-family: var(--font-mono);
}
.result {
  margin: var(--spacing-xs) 0 0;
  font-family: var(--font-mono);
  font-size: var(--text-mono);
  line-height: var(--leading-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--el-text-color-regular);
}
.pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-sm);
}
.page {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
.note {
  padding: var(--spacing-sm) 0;
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-link, var(--el-color-primary));
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
