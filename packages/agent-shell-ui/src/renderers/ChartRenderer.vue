<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";
import * as echarts from "echarts";
import { shellContextKey } from "../context";
import type { ArtifactRendererProps } from "../types";
import { useDarkMode } from "../useDarkMode";
import { useArtifactText } from "./useArtifactBlob";

/** .chart.json: an ECharts option object as plain JSON, drawn with the host's chart theme. */
const props = defineProps<ArtifactRendererProps>();
const shell = inject(shellContextKey)!;
const isDark = useDarkMode();
const { text, error } = useArtifactText(props);
const el = ref<HTMLElement | null>(null);
const drawError = ref(false);
let chart: echarts.ECharts | null = null;
let observer: ResizeObserver | null = null;

const option = computed<{ value: Record<string, unknown> | null; invalid: boolean }>(() => {
  if (text.value === null) return { value: null, invalid: false };
  try {
    const value: unknown = JSON.parse(text.value);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { value: value as Record<string, unknown>, invalid: false }
      : { value: null, invalid: true };
  } catch {
    return { value: null, invalid: true };
  }
});

function dispose() {
  observer?.disconnect();
  observer = null;
  chart?.dispose();
  chart = null;
}

async function draw() {
  dispose();
  await nextTick();
  if (!el.value || !option.value.value) return;
  const themeName = isDark.value ? "agent-shell-dark" : "agent-shell-light";
  echarts.registerTheme(themeName, shell.chartTheme.value(isDark.value));
  chart = echarts.init(el.value, themeName);
  try {
    chart.setOption(option.value.value, { notMerge: true });
    drawError.value = false;
  } catch {
    drawError.value = true;
    dispose();
    return;
  }
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(el.value);
}

// Theme changes rebuild the instance; a registered theme is read at init time.
watch([option, isDark], draw, { immediate: true });
onBeforeUnmount(dispose);
</script>

<template>
  <div class="chart-renderer" :class="presentation">
    <div v-if="error" class="state error">{{ error }}</div>
    <div v-else-if="text === null" class="state">{{ shell.labels.value.loading }}</div>
    <div v-else-if="option.invalid || drawError" class="state error">{{ shell.labels.value.invalidChart }}</div>
    <div v-else ref="el" class="chart" role="img" :aria-label="title" />
  </div>
</template>

<style scoped>
.chart-renderer {
  padding: 12px 8px 6px;
}
.chart {
  width: 100%;
  height: 320px;
}
.panel .chart {
  height: min(68vh, 560px);
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
