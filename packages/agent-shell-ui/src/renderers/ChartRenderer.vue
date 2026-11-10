<script setup lang="ts">
import { computed, inject, onErrorCaptured, ref, watch } from "vue";
import { EChart, useChartTheme } from "@ontomato/foundation-ui/chart";
import { shellContextKey } from "../context";
import type { ArtifactRendererProps } from "../types";
import { useArtifactText } from "./useArtifactBlob";
import { chartReadingLayout } from "./chart-layout";
import { chartBrandColors } from "./chart-colors";

/** .chart.json: an ECharts option object as plain JSON, drawn in the platform's chart theme. */
const props = defineProps<ArtifactRendererProps>();
const shell = inject(shellContextKey)!;
const { text, error } = useArtifactText(props);
const theme = useChartTheme();
/** The height the chart is drawn at; the reading layout sizes the legend band from it. */
const drawnHeight = ref<number>();
const drawError = ref(false);

/**
 * The file's option in the brand colours of the theme and the reading layout; a file that is not an option object,
 * or cannot be recoloured or laid out, is invalid.
 */
const option = computed<{ value: Record<string, unknown> | null; invalid: boolean }>(() => {
  if (text.value === null) return { value: null, invalid: false };
  try {
    const value: unknown = JSON.parse(text.value);
    return value && typeof value === "object" && !Array.isArray(value)
      ? {
          value: chartReadingLayout(chartBrandColors(value as Record<string, unknown>, theme.value), drawnHeight.value, props.presentation),
          invalid: false,
        }
      : { value: null, invalid: true };
  } catch {
    return { value: null, invalid: true };
  }
});

// An option ECharts cannot draw also shows as invalid; the next file is drawn afresh.
onErrorCaptured(() => {
  drawError.value = true;
  return false;
});
watch(text, () => {
  drawError.value = false;
});
</script>

<template>
  <div class="chart-renderer" :class="presentation">
    <div v-if="error" class="state error">{{ error }}</div>
    <div v-else-if="text === null" class="state">{{ shell.labels.value.loading }}</div>
    <div v-else-if="option.invalid || drawError" class="state error">{{ shell.labels.value.invalidChart }}</div>
    <EChart
      v-else-if="option.value"
      :option="option.value"
      :theme="theme"
      :height="presentation === 'panel' ? 'min(68vh, 560px)' : 320"
      role="img"
      :aria-label="title"
      @resize="drawnHeight = $event.height"
    />
  </div>
</template>

<style scoped>
.chart-renderer {
  padding: 12px 8px 6px;
}
.state {
  padding: 18px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}
.state.error {
  color: var(--el-color-danger);
}
</style>
