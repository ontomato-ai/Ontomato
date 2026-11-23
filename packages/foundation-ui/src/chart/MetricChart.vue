<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ChartFailure, ChartMetricColumn, ChartRow } from "@ontomato/contracts/chart-data";
import { fillChartPresentation } from "@ontomato/contracts/chart-presentation";
import EChart from "./EChart.vue";
import { registerChartMaps } from "./maps";
import { useChartTheme } from "./theme";

/**
 * The platform's chart: one `.chart.json` file filled from one MetricView's output and drawn in the platform's theme.
 * Filling, brand colours, the reading layout and the fixed formats are the shared rules; this component only supplies
 * the theme, the size and the state a reader sees. A file or an output the boundary rejects shows the reason it
 * gives, and no chart is drawn in its place.
 */
const props = withDefaults(defineProps<{
  /** The chart document: an ECharts option with `dataset[id=metric]` and the reserved `ontomato` metadata. */
  file: unknown;
  /** The metric output to draw: the columns it returns, its rows and its truncation. */
  metric: { columns: readonly ChartMetricColumn[]; rows: ChartRow[]; truncation?: { truncationHint: string } };
  /** Where the chart stands: a conversation's inline reply or a panel of its own. */
  presentation?: "inline" | "panel";
  /** Height of the chart, in pixels or as a CSS length. */
  height?: number | string;
  /** A timeline event's date the metric does not give, in the reader's language. */
  undated?: string;
  /** What a result with no rows says, in the reader's language. */
  empty?: string;
}>(), { presentation: "panel", undated: "Undated", empty: "No data" });

const theme = useChartTheme();
const drawn = ref<{ width: number; height: number }>({ width: 0, height: 0 });
const chartHeight = computed(() => props.height ?? (props.presentation === "panel" ? "min(68vh, 560px)" : 320));

const filled = computed(() => {
  const height = typeof chartHeight.value === "number" ? chartHeight.value : 320;
  return fillChartPresentation<{ truncationHint: string }>(props.file, props.metric, theme.value, {
    height: drawn.value.height || height,
    presentation: props.presentation,
    width: drawn.value.width,
    undated: props.undated,
  });
});

const option = computed(() => filled.value.ok ? filled.value.option : null);

/** The platform's bundled boundaries, once the maps this chart draws have them; a resource it lacks says so. */
const mapsReady = ref(true);
const mapFailure = ref<string | null>(null);
watch(option, (drawn) => {
  const pending = drawn && registerChartMaps(drawn);
  if (!pending) return;
  mapsReady.value = false;
  pending.then(() => { mapsReady.value = true; }, (cause: Error) => { mapFailure.value = cause.message; });
}, { immediate: true });

/** The reason a file or output cannot be drawn, as the boundary stated it. */
const failure = computed(() => filled.value.ok ? null : filled.value as ChartFailure);
</script>

<template>
  <div class="metric-chart" :class="presentation">
    <div v-if="mapFailure" class="state error" role="alert">{{ mapFailure }}</div>
    <div v-else-if="failure" class="state error" role="alert">
      <p class="code">{{ failure.code }}</p>
      <p v-if="failure.missingColumns.length" class="reason">{{ failure.missingColumns.join(", ") }}</p>
      <ul class="issues">
        <li v-for="issue in failure.issues" :key="issue.path.join('.') + issue.message">{{ issue.path.join(".") }}: {{ issue.message }}</li>
      </ul>
    </div>
    <template v-else-if="filled.ok">
      <p v-if="filled.truncation" class="state truncation" role="note">{{ filled.truncation.truncationHint }}</p>
      <p v-if="!filled.rowCount" class="state">{{ empty }}</p>
      <EChart v-else-if="mapsReady" class="metric-chart-canvas" :option="option!" :theme="theme" :height="chartHeight" role="img" @resize="drawn = $event" />
    </template>
  </div>
</template>

<style scoped>
.metric-chart {
  box-sizing: border-box;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 12px 8px 6px;
}
.metric-chart-canvas {
  flex: 1 1 auto;
  min-height: 0;
}
.state {
  flex: 0 0 auto;
  padding: 18px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}
.state.error {
  color: var(--el-color-danger);
}
.state.error .code {
  font-weight: 600;
  margin: 0 0 4px;
}
.state.error .reason {
  margin: 0 0 6px;
}
.issues {
  margin: 0;
  padding-left: 18px;
  font-size: var(--text-xs, 12px);
}
</style>
