<script setup lang="ts" generic="T">
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import type { DataStateLabels, DataStateResult } from "./types";

/**
 * The one presentation of a datum's state, inside a panel's frame and on the platform's own pages alike: the value
 * through the default slot once it is ready, and otherwise loading, the owner's empty answer, the reason it could not be
 * read, no permission, or that a selection is needed first. An empty answer is never shown for a read not made.
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
  <p v-else-if="result.status === 'error'" class="fui-data-state fui-data-state-error" role="alert">{{ result.message }}</p>
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
  color: var(--el-color-danger);
}
</style>
