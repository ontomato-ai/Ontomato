<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import * as echarts from "echarts";
import { useI18n } from "vue-i18n";
import type { ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { useTheme } from "../../../composables/useTheme";
import { nativeEchartsTheme } from "../../dashboard/components/utils/echartsTheme";
import { useArtifactText } from "./useArtifactBlob";

/** .chart.json: an ECharts option written by the agent, drawn with the workbench chart theme. */
const props = defineProps<ArtifactRendererProps>();
const { t } = useI18n();
const { isDark } = useTheme();
const { text, error } = useArtifactText(props);
const el = ref<HTMLElement | null>(null);
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
const drawError = ref(false);

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
  const themeName = isDark.value ? "agent-artifact-dark" : "agent-artifact-light";
  echarts.registerTheme(themeName, nativeEchartsTheme(isDark.value));
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

// Theme changes rebuild the instance; the registered theme is read at init time.
watch([option, isDark], draw, { immediate: true });
onBeforeUnmount(dispose);
</script>

<template>
  <div class="chart-artifact" :class="presentation">
    <div v-if="error" class="state error">{{ error }}</div>
    <div v-else-if="text === null" class="state">{{ t("assistant.loading") }}</div>
    <div v-else-if="option.invalid || drawError" class="state error">{{ t("assistant.invalidChart") }}</div>
    <div v-else ref="el" class="chart" role="img" :aria-label="title" />
  </div>
</template>

<style scoped>
.chart-artifact {
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
  font-size: var(--text-sm);
}
.state.error {
  color: var(--el-color-danger);
}
</style>
