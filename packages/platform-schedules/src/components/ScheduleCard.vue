<script setup lang="ts">
import { computed, type Component } from "vue";
import { ChevronDown, ChevronRight, CirclePause, Clock, Ellipsis } from "lucide-vue-next";
import type { PlatformTask } from "@ontomato/contracts/platform-schedules";
import { useScheduleText } from "../text";
import { dropdownBoundaryOptions } from "@ontomato/foundation-ui/overlay";
import ScheduleRunStatus from "./ScheduleRunStatus.vue";

/**
 * One task as a card: its application, its title, what it was given, why it is paused, when it runs, how its last run
 * went, and the way to its result.
 *
 * Everything shown is the service's: the summary is the application's own "name: value" of the saved content, the
 * pause carries the application's reason, and the result link is where the application keeps the latest result. The
 * card reads them as they are and never works out a state of its own.
 */
const props = defineProps<{
  task: PlatformTask;
  /** The task's application as the rail names and draws it. */
  app: { label: string; icon: Component };
  /** A request about this task is on its way: its switch and actions wait. */
  busy: boolean;
}>();
const emit = defineEmits<{
  toggle: [enabled: boolean];
  openResult: [];
  runNow: [];
  edit: [];
  records: [];
  remove: [];
}>();
const text = useScheduleText();
const { t } = text;

const titleId = computed(() => `schedule-${props.task.id}`);
/** The switch says whether the task runs on its schedule: a task the system paused does not, though its owner left it on. */
const scheduled = computed(() => props.task.enabled && props.task.pause === null);
const summary = computed(() => text.summary(props.task.summary));
const hasEarlierResult = computed(() => !!props.task.latestResult && props.task.latestResult.runId !== props.task.lastRun?.id);

function resultPreview(value: string | null) {
  return value?.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, "")
    .replace(/(\*\*|__|`+)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ").trim();
}

const next = computed(() => {
  const task = props.task;
  if (!task.enabled) return t("card.off");
  return task.nextRunAt ? t("card.next", { time: text.moment(task.nextRunAt, task.timeZone) }) : t("card.noNext");
});

/** The last run: its state, when it started, and what it came to (the application's summary, or why it failed). */
const last = computed(() => {
  const run = props.task.lastRun;
  if (!run) return null;
  const point =
    run.status === "failed" || run.status === "skipped"
      ? run.error && t(`runError.${run.error.code}`)
      : run.status === "completed"
        ? (resultPreview(run.resultSummary) || (run.spendTime === null ? null : t("duration.took", { time: text.duration(run.spendTime) })))
        : null;
  return { status: run.status, when: text.moment(run.startedAt, props.task.timeZone), point };
});

function command(name: string | number | object) {
  if (name === "runNow") emit("runNow");
  else if (name === "edit") emit("edit");
  else if (name === "records") emit("records");
  else if (name === "remove") emit("remove");
}
</script>

<template>
  <article class="card schedule-card" :aria-labelledby="titleId" :data-task="task.id">
    <header class="head">
      <span class="app">
        <component :is="app.icon" :size="14" aria-hidden="true" />
        <span>{{ app.label }}</span>
      </span>
      <el-switch
        :model-value="scheduled"
        :loading="busy"
        :disabled="busy"
        :aria-label="t('card.switch', { title: task.title })"
        @update:model-value="emit('toggle', Boolean($event))"
      />
    </header>
    <h3 :id="titleId" class="title">{{ task.title }}</h3>
    <p v-if="summary" class="summary" :title="summary">{{ summary }}</p>
    <div v-if="task.pause" class="pause">
      <details>
        <summary>
          <CirclePause :size="14" aria-hidden="true" />
          <span>{{ t("card.pausedNext") }}</span>
          <ChevronDown class="pause-chevron" :size="14" aria-hidden="true" />
        </summary>
        <p>{{ task.pause.message }}</p>
      </details>
      <el-button v-if="task.pause.code === 'definition_changed'" link type="primary" size="small" @click="emit('edit')">
        {{ t("card.review") }}
      </el-button>
    </div>
    <div class="meta">
      <p class="line">
        <Clock :size="14" class="line-icon" aria-hidden="true" />
        <span>{{ text.frequency(task.frequency) }}</span>
        <template v-if="!task.pause">
          <span class="sep" aria-hidden="true" />
          <span>{{ next }}</span>
        </template>
      </p>
      <p v-if="last" class="line">
        <ScheduleRunStatus :status="last.status" />
        <span>{{ last.when }}</span>
        <template v-if="last.point">
          <span class="sep" aria-hidden="true" />
          <span class="point" :title="last.point">{{ last.point }}</span>
        </template>
      </p>
      <p v-else class="line muted">
        <span>{{ t("card.neverRun") }}</span>
      </p>
    </div>
    <footer class="foot">
      <div class="result-actions">
        <el-button
          v-if="task.latestResult"
          link type="primary" size="small"
          class="result"
          @click="emit('openResult')"
        >
          <span>{{ t(hasEarlierResult ? "card.viewEarlierResult" : "card.viewResult") }}</span>
          <ChevronRight :size="14" aria-hidden="true" />
        </el-button>
        <span v-else class="no-result">{{ t('card.noResult') }}</span>
        <el-button v-if="last?.status === 'failed' || last?.status === 'skipped'" link type="primary" size="small" class="result" @click="emit('records')">
          {{ t("action.records") }}
        </el-button>
      </div>
      <el-dropdown trigger="click" placement="bottom-end" :popper-options="dropdownBoundaryOptions" :disabled="busy" @command="command">
        <el-button text size="small" class="more" :icon="Ellipsis" :aria-label="t('card.more', { title: task.title })" :disabled="busy" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="runNow">{{ t("action.runNow") }}</el-dropdown-item>
            <el-dropdown-item command="edit">{{ t("action.edit") }}</el-dropdown-item>
            <el-dropdown-item command="records">{{ t("action.records") }}</el-dropdown-item>
            <el-dropdown-item command="remove" divided class="schedule-danger-item">{{ t("action.delete") }}</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </footer>
  </article>
</template>

<style scoped>
/*
 * Keep the schedule, last run and actions aligned at the foot of each card in the row.
 */
.card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  height: 100%;
  box-sizing: border-box;
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-lg);
  background: var(--el-bg-color);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
}
.app {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.app svg { flex: none; }
.app span { overflow-wrap: anywhere; }
.title {
  margin: 0;
  font-size: var(--text-base);
  line-height: var(--leading-base);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
/* The filled-in content: every "name: value" in a row, at most two lines; the whole of it is on the title. */
.summary {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.pause {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--spacing-xs) var(--spacing-sm);
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-weight: var(--font-medium);
}
.pause details { flex: 1; min-width: 0; }
.pause summary {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-sm);
  list-style: none;
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-text);
  cursor: pointer;
}
.pause summary::-webkit-details-marker { display: none; }
.pause summary:hover { background: var(--el-color-warning-light-8); }
.pause details[open] .pause-chevron { rotate: 180deg; }
.pause p { margin: var(--spacing-xs) 0 0; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
  padding-top: var(--spacing-md);
  border-top: 1px solid var(--el-border-color-lighter);
}
.line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-regular);
  font-variant-numeric: tabular-nums;
  flex-wrap: wrap;
}
.line.muted {
  color: var(--el-text-color-secondary);
}
.line-icon {
  flex: none;
  color: var(--el-text-color-secondary);
}
.sep {
  flex: none;
  width: 1px;
  height: 10px;
  background: var(--el-border-color);
}
.point {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-xs);
}
.result-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-sm); }
.no-result { color: var(--el-text-color-secondary); font-size: var(--text-xs); }
.result.el-button { margin: 0; padding-inline: 0; }
.result :deep(> span) { gap: var(--spacing-xs); }
.more {
  width: var(--control-height-sm);
  padding: 0;
}
:global(.el-dropdown-menu__item.schedule-danger-item:not(.is-disabled)) {
  color: var(--el-color-danger);
}
</style>
