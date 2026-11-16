<script setup lang="ts">
import { computed, type Component } from "vue";
import { ArrowRight, Clock, Ellipsis } from "lucide-vue-next";
import type { PlatformTask } from "@ontomato/contracts/platform-schedules";
import { useScheduleText } from "../text";
import {dropdownBoundaryOptions} from '@ontomato/foundation-ui/overlay';

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

const next = computed(() => {
  const task = props.task;
  if (task.pause) return t("card.pausedNext");
  if (!task.enabled) return t("card.off");
  return task.nextRunAt ? t("card.next", { time: text.moment(task.nextRunAt, task.timeZone) }) : t("card.noNext");
});

/** The last run: its state, when it started, and what it came to (the application's summary, or why it failed). */
const last = computed(() => {
  const run = props.task.lastRun;
  if (!run) return null;
  const point =
    run.status === "failed" || run.status === "skipped"
      ? run.error && text.runReason(run.error)
      : run.status === "completed"
        ? (run.resultSummary ?? (run.spendTime === null ? null : t("duration.took", { time: text.duration(run.spendTime) })))
        : null;
  return { status: run.status, label: text.runStatus(run.status), when: text.moment(run.startedAt, props.task.timeZone), point };
});

function command(name: string | number | object) {
  if (name === "runNow") emit("runNow");
  else if (name === "edit") emit("edit");
  else if (name === "records") emit("records");
  else if (name === "remove") emit("remove");
}
</script>

<template>
  <article class="card" :aria-labelledby="titleId" :data-task="task.id">
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
    <p v-if="task.pause" class="pause">
      <span>{{ t("card.paused", { reason: task.pause.message }) }}</span>
      <button v-if="task.pause.code === 'definition_changed'" type="button" class="pause-action" @click="emit('edit')">
        {{ t("card.review") }}
      </button>
    </p>
    <div class="meta">
      <p class="line">
        <Clock :size="14" class="line-icon" aria-hidden="true" />
        <span>{{ text.frequency(task.frequency) }}</span>
        <span class="sep" aria-hidden="true" />
        <span>{{ next }}</span>
      </p>
      <p v-if="last" class="line">
        <span class="dot" :class="last.status" aria-hidden="true" />
        <strong class="status" :class="last.status">{{ last.label }}</strong>
        <span>{{ last.when }}</span>
        <template v-if="last.point">
          <span class="sep" aria-hidden="true" />
          <span class="point" :title="last.point">{{ last.point }}</span>
        </template>
      </p>
      <p v-else class="line muted">
        <span class="dot" aria-hidden="true" />
        <span>{{ t("card.neverRun") }}</span>
      </p>
    </div>
    <footer class="foot">
      <button
        type="button"
        class="result"
        :disabled="!task.latestResult"
        :title="task.latestResult ? undefined : t('card.noResult')"
        @click="emit('openResult')"
      >
        <span>{{ t("card.viewResult") }}</span>
        <ArrowRight :size="14" aria-hidden="true" />
      </button>
      <el-dropdown trigger="click" placement="bottom-end" :popper-options="dropdownBoundaryOptions" :disabled="busy" @command="command">
        <button type="button" class="more" :aria-label="t('card.more', { title: task.title })" :disabled="busy">
          <Ellipsis :size="16" aria-hidden="true" />
        </button>
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
 * A card is the page's content, flat on its own surface with the table's 1px border and 8px radius: no shadow and no
 * hover movement. Cards of one row share a height, and the schedule, the last run and the actions sit at the foot of
 * each, so those lines align across the row whatever the summary's length.
 */
.card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  height: 100%;
  box-sizing: border-box;
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
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
  padding: 6px var(--spacing-sm);
  border-radius: var(--radius-sm);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-weight: var(--font-medium);
}
.pause-action {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
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
  white-space: nowrap;
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
  overflow: hidden;
  text-overflow: ellipsis;
}
/* A state reads by its word; the dot and the colour only repeat it. */
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--el-border-color-dark);
}
.dot.completed {
  background: var(--el-color-success);
}
.dot.failed {
  background: var(--el-color-danger);
}
.dot.running {
  background: var(--el-color-primary);
}
.status {
  font-weight: var(--font-semibold);
}
.status.completed {
  color: var(--el-color-success);
}
.status.failed {
  color: var(--el-color-danger);
}
.status.running {
  color: var(--brand-link);
}
.status.skipped {
  color: var(--el-text-color-secondary);
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding-top: var(--spacing-xs);
}
.result {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  cursor: pointer;
}
.result:disabled {
  color: var(--el-text-color-disabled);
  cursor: not-allowed;
}
.more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-height-inline);
  height: var(--control-height-inline);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.more:hover:not(:disabled) {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.more:disabled {
  cursor: not-allowed;
}
:global(.el-dropdown-menu__item.schedule-danger-item:not(.is-disabled)) {
  color: var(--el-color-danger);
}
</style>
