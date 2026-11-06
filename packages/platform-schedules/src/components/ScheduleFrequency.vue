<script setup lang="ts">
import { computed } from "vue";
import { weekdayName, type FrequencyDraft } from "../frequency";
import { useScheduleText } from "../text";

/**
 * When a task runs: at an interval, every day, every week, every month, or by a Cron expression. Times of day are read
 * in the task's zone, which the form names under these controls.
 */
const draft = defineModel<FrequencyDraft>({ required: true });
const { t, locale } = useScheduleText();

const weekdays = computed(() =>
  [1, 2, 3, 4, 5, 6, 7].map((value) => ({ value, label: weekdayName(value, locale.value) })),
);

function set<K extends keyof FrequencyDraft>(key: K, value: FrequencyDraft[K]) {
  draft.value = { ...draft.value, [key]: value };
}
</script>

<template>
  <div class="frequency">
    <el-select
      :model-value="draft.kind"
      class="kind"
      :aria-label="t('form.time')"
      @update:model-value="set('kind', $event)"
    >
      <el-option value="interval" :label="t('form.kind.interval')" />
      <el-option value="daily" :label="t('form.kind.daily')" />
      <el-option value="weekly" :label="t('form.kind.weekly')" />
      <el-option value="monthly" :label="t('form.kind.monthly')" />
      <el-option value="cron" :label="t('form.kind.cron')" />
    </el-select>
    <template v-if="draft.kind === 'interval'">
      <el-input-number
        :model-value="draft.every"
        class="number"
        :min="1"
        :max="1000"
        :step="1"
        step-strictly
        controls-position="right"
        :aria-label="t('form.every')"
        @update:model-value="set('every', Number($event ?? 1))"
      />
      <el-select :model-value="draft.unit" class="unit" :aria-label="t('form.every')" @update:model-value="set('unit', $event)">
        <el-option value="minute" :label="t('form.unit.minute')" />
        <el-option value="hour" :label="t('form.unit.hour')" />
        <el-option value="day" :label="t('form.unit.day')" />
      </el-select>
    </template>
    <el-select
      v-if="draft.kind === 'weekly'"
      :model-value="draft.weekday"
      class="unit"
      :aria-label="t('form.weekday')"
      @update:model-value="set('weekday', Number($event))"
    >
      <el-option v-for="weekday in weekdays" :key="weekday.value" :value="weekday.value" :label="weekday.label" />
    </el-select>
    <el-input-number
      v-if="draft.kind === 'monthly'"
      :model-value="draft.day"
      class="number"
      :min="1"
      :max="31"
      :step="1"
      step-strictly
      controls-position="right"
      :aria-label="t('form.day')"
      @update:model-value="set('day', Number($event ?? 1))"
    />
    <el-time-select
      v-if="draft.kind === 'daily' || draft.kind === 'weekly' || draft.kind === 'monthly'"
      :model-value="draft.time"
      class="clock"
      start="00:00"
      end="23:55"
      step="00:05"
      :clearable="false"
      :aria-label="t('form.clock')"
      @update:model-value="set('time', String($event ?? ''))"
    />
    <el-input
      v-if="draft.kind === 'cron'"
      :model-value="draft.expression"
      class="cron"
      :placeholder="t('form.cronPlaceholder')"
      :aria-label="t('form.kind.cron')"
      @update:model-value="set('expression', String($event))"
    />
  </div>
</template>

<style scoped>
.frequency {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  width: 100%;
}
.kind {
  width: 150px;
}
.unit {
  width: 130px;
}
.number {
  width: 110px;
}
.clock {
  width: 120px;
}
.cron {
  width: 220px;
}
</style>
