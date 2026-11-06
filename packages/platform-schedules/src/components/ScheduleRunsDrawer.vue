<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { PlatformScheduleResultLink, PlatformTask, PlatformTaskRun } from "@ontomato/contracts/platform-schedules";
import type { SchedulesApi } from "../api";
import { useScheduleText } from "../text";
import ScheduleRunItem from "./ScheduleRunItem.vue";

/**
 * One task's run records, newest first, a page at a time. A record keeps what the task held when it ran, so editing a
 * task never rewrites its history.
 *
 * A run still going is read again every five seconds, that run alone, until it stops; closing the drawer stops the
 * reading, never the run.
 */
const props = defineProps<{
  api: SchedulesApi;
  task: PlatformTask;
  /** The run a link pointed at, read before the drawer opened; it opens expanded. */
  focusRun?: PlatformTaskRun | null;
}>();
const emit = defineEmits<{
  close: [];
  openResult: [link: PlatformScheduleResultLink];
  /** A run that was going has stopped: the task's card has a new last run. */
  settled: [];
}>();
const { t } = useScheduleText();

const POLL_MS = 5000;

const visible = ref(true);
const runs = ref<PlatformTaskRun[]>([]);
const nextCursor = ref<string | null>(null);
const state = ref<"loading" | "ready" | "error">("loading");
const loadingMore = ref(false);
const linked = ref<PlatformTaskRun | null>(props.focusRun ?? null);
const expanded = ref(new Set<string>(props.focusRun ? [props.focusRun.id] : []));
const list = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let closed = false;

/** The linked run while it is not among the pages read so far: it stays on top, under its own heading. */
const pinned = computed(() =>
  linked.value && !runs.value.some((run) => run.id === linked.value!.id) ? linked.value : null,
);

async function load() {
  state.value = "loading";
  try {
    const page = await props.api.runs(props.task.id);
    runs.value = page.runs;
    nextCursor.value = page.nextCursor;
    state.value = "ready";
    reveal();
  } catch {
    state.value = "error";
  }
  schedule();
}

async function more() {
  if (!nextCursor.value || loadingMore.value) return;
  loadingMore.value = true;
  try {
    const page = await props.api.runs(props.task.id, nextCursor.value);
    const known = new Set(runs.value.map((run) => run.id));
    runs.value = [...runs.value, ...page.runs.filter((run) => !known.has(run.id))];
    nextCursor.value = page.nextCursor;
  } catch {
    state.value = "error";
  } finally {
    loadingMore.value = false;
  }
  schedule();
}

/** The linked run is the one the reader came for: it is brought into view once the records are on screen. */
function reveal() {
  const id = props.focusRun?.id;
  if (id) void nextTick(() => list.value?.querySelector(`[data-run="${id}"]`)?.scrollIntoView?.({ block: "nearest" }));
}

function going(): PlatformTaskRun[] {
  return [...(pinned.value ? [pinned.value] : []), ...runs.value].filter((run) => run.status === "running");
}

function schedule() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (!closed && going().length > 0) timer = setTimeout(() => void poll(), POLL_MS);
}

async function poll() {
  timer = null;
  let stopped = false;
  for (const run of going()) {
    try {
      const fresh = await props.api.run(props.task.id, run.id);
      if (closed) return;
      runs.value = runs.value.map((known) => (known.id === fresh.id ? fresh : known));
      if (linked.value?.id === fresh.id) linked.value = fresh;
      if (fresh.status !== "running") stopped = true;
    } catch {
      // A failed read leaves the run as it was; the next round reads it again.
    }
  }
  if (stopped) emit("settled");
  schedule();
}

function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

function stop() {
  closed = true;
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

onMounted(() => void load());
onBeforeUnmount(stop);
defineExpose({ reload: load });
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="t('runs.title', { title: task.title })"
    size="min(560px, 100vw)"
    append-to-body
    class="schedule-runs"
    @close="stop"
    @closed="emit('close')"
  >
    <div ref="list" class="records">
      <section v-if="pinned" :aria-label="t('runs.linked')">
        <h3 class="group-title">{{ t("runs.linked") }}</h3>
        <ul class="runs">
          <ScheduleRunItem
            :run="pinned"
            :time-zone="task.timeZone"
            focused
            :expanded="expanded.has(pinned.id)"
            @toggle="toggle(pinned.id)"
            @open-result="emit('openResult', $event)"
          />
        </ul>
      </section>

      <p v-if="state === 'loading' && runs.length === 0" class="note" aria-busy="true">…</p>
      <p v-else-if="state === 'error' && runs.length === 0" class="note" role="alert">
        <span>{{ t("runs.loadFailed") }}</span>
        <button type="button" class="link" @click="load">{{ t("retry") }}</button>
      </p>
      <p v-else-if="runs.length === 0" class="note">{{ t("runs.empty") }}</p>
      <ul v-else class="runs">
        <ScheduleRunItem
          v-for="run in runs"
          :key="run.id"
          :run="run"
          :time-zone="task.timeZone"
          :focused="run.id === focusRun?.id"
          :expanded="expanded.has(run.id)"
          @toggle="toggle(run.id)"
          @open-result="emit('openResult', $event)"
        />
      </ul>

      <div v-if="nextCursor" class="more">
        <el-button size="small" :loading="loadingMore" @click="more">{{ t("runs.loadMore") }}</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.records {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}
.group-title {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-secondary);
}
/* The records are one bordered list, a hairline between runs: the page's content, not cards. */
.runs {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.note {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  margin: 0;
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.more {
  display: flex;
  justify-content: center;
}
</style>
