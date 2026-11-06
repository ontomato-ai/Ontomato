<script setup lang="ts">
import { computed } from "vue";
import { ArrowRight } from "lucide-vue-next";
import type { PlatformScheduleResultLink, PlatformTaskRun } from "@ontomato/contracts/platform-schedules";
import { useScheduleText } from "../text";

/**
 * One run's record: its state, how it was started, when, for how long, why it failed, what it came to and where its
 * result is. Its details are what the task held when it ran, the raw result, and what the application reports of the
 * actual execution — for an action, the parameters it really ran with — shown as the application wrote them.
 */
const props = defineProps<{
  run: PlatformTaskRun;
  /** The task's zone: times read in it, like its schedule. */
  timeZone: string;
  /** The run a link opened, marked among the others. */
  focused: boolean;
  expanded: boolean;
}>();
const emit = defineEmits<{ toggle: []; openResult: [link: PlatformScheduleResultLink] }>();
const text = useScheduleText();
const { t } = text;

const hasDetails = computed(
  () => props.run.result !== null || props.run.executionDetails !== null || props.run.snapshot.summary.length > 0,
);
</script>

<template>
  <li class="run" :class="{ focused }" :data-run="run.id">
    <div class="run-head">
      <span class="dot" :class="run.status" aria-hidden="true" />
      <strong class="status" :class="run.status">{{ text.runStatus(run.status) }}</strong>
      <span>{{ text.trigger(run.trigger) }}</span>
      <span class="sep" aria-hidden="true" />
      <span>{{ text.moment(run.startedAt, timeZone) }}</span>
      <template v-if="run.spendTime !== null">
        <span class="sep" aria-hidden="true" />
        <span>{{ t("duration.took", { time: text.duration(run.spendTime) }) }}</span>
      </template>
      <button v-if="run.resultLink" type="button" class="link result" @click="emit('openResult', run.resultLink)">
        <span>{{ t("runs.viewResult") }}</span>
        <ArrowRight :size="14" aria-hidden="true" />
      </button>
    </div>
    <p v-if="run.scheduledAt && run.trigger === 'schedule'" class="sub">
      {{ t("runs.scheduledFor", { time: text.moment(run.scheduledAt, timeZone) }) }}
    </p>
    <p v-if="run.error" class="error">{{ text.runError(run.error) }}</p>
    <p v-if="run.resultSummary" class="outcome">{{ run.resultSummary }}</p>
    <p v-if="run.status === 'running'" class="sub" aria-live="polite">{{ t("runs.refreshing") }}</p>
    <button v-if="hasDetails" type="button" class="link toggle" :aria-expanded="expanded" @click="emit('toggle')">
      {{ expanded ? t("runs.hide") : t("runs.details") }}
    </button>
    <dl v-if="expanded && hasDetails" class="details">
      <template v-if="run.snapshot.summary.length > 0">
        <dt>{{ t("runs.content") }}</dt>
        <dd>{{ text.summary(run.snapshot.summary) }}</dd>
      </template>
      <template v-if="run.result !== null">
        <dt>{{ t("runs.result") }}</dt>
        <dd><pre>{{ run.result }}</pre></dd>
      </template>
      <template v-if="run.executionDetails !== null">
        <dt>{{ t("runs.executionDetails") }}</dt>
        <dd><pre>{{ JSON.stringify(run.executionDetails, null, 2) }}</pre></dd>
      </template>
    </dl>
  </li>
</template>

<style scoped>
.run {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-md);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-regular);
}
.run + .run {
  border-top: 1px solid var(--el-border-color-lighter);
}
.run.focused {
  background: var(--el-color-primary-light-9);
}
.run-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}
.sep {
  width: 1px;
  height: 10px;
  background: var(--el-border-color);
}
/* A state reads by its word; the dot and the colour only repeat it. */
.dot {
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
.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.result {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-left: auto;
  font-weight: var(--font-semibold);
}
.sub {
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.error {
  margin: 0;
  color: var(--el-color-danger);
}
.outcome {
  margin: 0;
  color: var(--el-text-color-primary);
}
.toggle {
  align-self: flex-start;
  font-size: var(--text-xs);
}
.details {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--spacing-xs);
  margin: var(--spacing-xs) 0 0;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-sm);
  background: var(--el-fill-color);
}
.details dt {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-secondary);
}
.details dd {
  margin: 0 0 var(--spacing-xs);
  overflow-wrap: anywhere;
}
.details pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-mono);
  line-height: var(--leading-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--el-text-color-regular);
}
</style>
