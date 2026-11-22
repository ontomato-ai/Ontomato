<script setup lang="ts" generic="T">
import { ElButton } from "element-plus/es/components/button/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import type { DataStateLabels, DataStateResult } from "./types";

/**
 * The one presentation of a datum's state, inside a panel's frame and on the platform's own pages alike: the value
 * through the default slot once it is ready, and otherwise loading, the owner's empty answer, the reason it could not be
 * read, no permission, or that a selection is needed first. An empty answer is never shown for a read not made. It is a
 * small quiet icon and one line, never a large illustration; a read the reader narrowed that found nothing says that
 * nothing matches (a magnifier), apart from one with nothing in it at all (an empty tray).
 */
defineProps<{
  result: DataStateResult<T>;
  labels: DataStateLabels;
}>();
defineSlots<{
  /** The datum's value, once the owner answered with one. */
  default(props: { value: T }): unknown;
}>();
</script>

<template>
  <slot v-if="result.status === 'ready'" :value="result.value"></slot>
  <div v-else-if="result.status === 'loading'" class="fui-data-state" aria-busy="true">
    <el-skeleton :rows="3" animated></el-skeleton>
  </div>
  <div v-else-if="result.status === 'error'" class="fui-data-state fui-data-state-error">
    <p role="alert">{{ result.message }}</p>
    <el-button v-if="result.retry" text type="primary" size="small" @click="result.retry()">{{ labels.retry }}</el-button>
  </div>
  <div
    v-else-if="result.status === 'empty'"
    class="fui-data-state fui-data-state-empty"
    data-state="empty"
    :data-empty="result.narrowed ? 'no-match' : 'none'"
    role="status"
  >
    <svg
      class="fui-data-state-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    >
      <template v-if="result.narrowed"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4M8.5 8.5l5 5M13.5 8.5l-5 5"></path></template>
      <template v-else><path d="M3 13h5l1.5 3h5L16 13h5"></path><path d="M5.5 5.5 3 13v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5l-2.5-7.5a1 1 0 0 0-.95-.7H6.45a1 1 0 0 0-.95.7Z"></path></template>
    </svg>
    <p>{{ result.narrowed ? labels.noMatch : labels.empty }}</p>
  </div>
  <p v-else class="fui-data-state" :data-state="result.status" role="status">{{ labels[result.status] }}</p>
</template>

<style scoped>
.fui-data-state {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
  margin: 0;
  padding: 12px 0;
}
.fui-data-state-error {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  color: var(--el-color-danger);
}
.fui-data-state-error p {
  margin: 0;
}
.fui-data-state-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  padding: var(--spacing-xl, 24px) var(--spacing-md, 12px);
  text-align: center;
}
.fui-data-state-empty p {
  margin: 0;
}
/* Low weight: the icon says "nothing here" without drawing the eye. */
.fui-data-state-icon {
  flex: none;
  color: var(--el-text-color-placeholder);
}
</style>
