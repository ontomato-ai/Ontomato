<script setup lang="ts">
import { computed } from "vue";
import { ArrowRight } from "lucide-vue-next";
import type { PlatformScheduleResultLink, PlatformTaskRun } from "@ontomato/contracts/platform-schedules";
import { useScheduleText } from "../text";
import ScheduleRunStatus from "./ScheduleRunStatus.vue";

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
      <ScheduleRunStatus :status="run.status" />
      <span>{{ text.trigger(run.trigger) }}</span>
      <span class="sep" aria-hidden="true" />
      <span>{{ text.moment(run.startedAt, timeZone) }}</span>
      <template v-if="run.spendTime !== null">
        <span class="sep" aria-hidden="true" />
        <span>{{ t("duration.took", { time: text.duration(run.spendTime) }) }}</span>
      </template>
      <el-button v-if="run.resultLink" link type="primary" size="small" class="result" @click="emit('openResult', run.resultLink)">
        <span>{{ t("runs.viewResult") }}</span>
        <ArrowRight :size="14" aria-hidden="true" />
      </el-button>
    </div>
    <p v-if="run.scheduledAt && run.trigger === 'schedule'" class="sub">
      {{ t("runs.scheduledFor", { time: text.moment(run.scheduledAt, timeZone) }) }}
    </p>
    <p v-if="run.error" class="error">{{ text.runError(run.error) }}</p>
    <p v-if="run.resultSummary" class="outcome">{{ run.resultSummary }}</p>
    <p v-if="run.status === 'running'" class="sub" aria-live="polite">{{ t("runs.refreshing") }}</p>
    <el-button v-if="hasDetails" link type="primary" size="small" class="toggle" :aria-expanded="expanded" @click="emit('toggle')">
      {{ expanded ? t("runs.hide") : t("runs.details") }}
    </el-button>
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
  background: var(--el-fill-color-light);
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
.result {
  margin-inline-start: auto;
}
.result :deep(> span) { gap: var(--spacing-xs); }
.sub {
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.error {
  margin: 0;
  color: var(--el-color-danger-text);
  overflow-wrap: anywhere;
}
.outcome {
  margin: 0;
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.toggle {
  align-self: flex-start;
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
