<script setup lang="ts">
import { computed, inject, onErrorCaptured, ref, watch } from "vue";
import { EChart, MetricChart, useChartTheme } from "@ontomato/foundation-ui/chart";
import { shellContextKey } from "../context";
import type { ArtifactRendererProps } from "../types";
import { useArtifactText } from "./useArtifactBlob";
import { chartBrandColors, chartReadingLayout } from "@ontomato/contracts/chart-presentation";

/**
 * .chart.json: a chart file, drawn by the platform's chart from its own snapshot rows, or a legacy plain ECharts
 * option, which is read as it was stored and drawn in the platform's theme.
 */
const props = defineProps<ArtifactRendererProps>();
const shell = inject(shellContextKey)!;
const { text, error } = useArtifactText(props);
const theme = useChartTheme();
/** The size the chart is drawn at; the reading layout sizes the legend band and the title from it. */
const drawn = ref<{ width: number; height: number }>();
const drawError = ref(false);

/** The parsed file: a platform chart file, or a legacy option drawn as stored. */
const parsed = computed<{ value: Record<string, unknown> | null; file: boolean; invalid: boolean }>(() => {
  if (text.value === null) return { value: null, file: false, invalid: false };
  try {
    const value: unknown = JSON.parse(text.value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { value: null, file: false, invalid: true };
    return { value: value as Record<string, unknown>, file: "ontomato" in value, invalid: false };
  } catch {
    return { value: null, file: false, invalid: true };
  }
});

const option = computed<Record<string, unknown> | null>(() => {
  const value = parsed.value.value;
  if (!value || parsed.value.file) return null;
  return chartReadingLayout(chartBrandColors(value, theme.value), drawn.value?.height, props.presentation, drawn.value?.width);
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
    <div v-else-if="parsed.invalid" class="state error">{{ shell.labels.value.invalidChart }}</div>
    <MetricChart
      v-else-if="parsed.file && parsed.value"
      :file="parsed.value"
      :presentation="presentation"
      :height="presentation === 'panel' ? 'min(68vh, 560px)' : 320"
      :undated="shell.labels.value.chartUndated"
      :empty="shell.labels.value.noChartRows"
    />
    <div v-else-if="drawError" class="state error">{{ shell.labels.value.invalidChart }}</div>
    <EChart
      v-else-if="option"
      :option="option"
      :theme="theme"
      :height="presentation === 'panel' ? 'min(68vh, 560px)' : 320"
      role="img"
      :aria-label="title"
      @resize="drawn = $event"
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
