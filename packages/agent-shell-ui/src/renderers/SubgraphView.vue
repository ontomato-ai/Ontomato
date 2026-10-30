<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import * as echarts from "echarts";
import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import { useDarkMode } from "../useDarkMode";
import { subgraphOption, subgraphSize } from "./subgraph-chart";

/** A dataset's source analysis drawn as delivered; filters are listed per query under the graph. */
const props = defineProps<{ graph: QuerySubgraph }>();
const isDark = useDarkMode();
const el = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;
let observer: ResizeObserver | null = null;

const measure = document.createElement("canvas").getContext("2d");
if (measure) measure.font = "12px sans-serif";
const textWidth = (label: string) => measure?.measureText(label).width ?? label.length * 8;
/** Drawn at natural size; the frame scrolls when the graph is larger than the panel. */
const size = computed(() => subgraphSize(props.graph, textWidth));
const filterGroups = computed(() =>
  props.graph.queries
    .map((query) => ({ query, filters: props.graph.filters.filter((filter) => filter.queryId === query.id) }))
    .filter((group) => group.filters.length),
);

function dispose() {
  observer?.disconnect();
  observer = null;
  chart?.dispose();
  chart = null;
}

function draw() {
  dispose();
  if (!el.value) return;
  const css = getComputedStyle(el.value);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  chart = echarts.init(el.value);
  chart.setOption(subgraphOption(
    props.graph,
    {
      text: token("--el-text-color-regular", "#303133"),
      muted: token("--el-text-color-secondary", "#909399"),
      line: token("--el-border-color", "#dcdfe6"),
      surface: token("--el-bg-color", "#ffffff"),
      class: token("--el-color-primary", "#409eff"),
      field: token("--el-color-info", "#909399"),
      operation: token("--el-color-warning", "#e6a23c"),
      output: token("--el-color-success", "#67c23a"),
    },
    textWidth,
    (value) => echarts.format.encodeHTML(value),
  ));
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(el.value);
}

// CSS tokens are read at draw time, so a theme change redraws.
watch([() => props.graph, isDark], () => nextTick(draw), { immediate: true });
onBeforeUnmount(dispose);
</script>

<template>
  <div class="subgraph">
    <div class="frame">
      <div ref="el" class="canvas" :style="{ width: `${size.width}px`, height: `${size.height}px` }" />
    </div>
    <ul v-if="filterGroups.length" class="filters">
      <li v-for="group in filterGroups" :key="group.query.id">
        <span class="query">{{ group.query.label }}</span>
        <span v-for="filter in group.filters" :key="filter.id" class="filter" :title="filter.expression">{{ filter.label }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.subgraph {
  min-width: 0;
}
.frame {
  max-height: 560px;
  overflow: auto;
}
.canvas {
  min-width: 100%;
}
.filters {
  list-style: none;
  margin: 0;
  padding: 8px 14px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--text-xs, 12px);
}
.filters li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.query {
  color: var(--el-text-color-secondary);
}
.filter {
  padding: 1px 8px;
  border: 1px dashed var(--el-border-color);
  border-radius: 999px;
  color: var(--el-text-color-regular);
}
</style>
