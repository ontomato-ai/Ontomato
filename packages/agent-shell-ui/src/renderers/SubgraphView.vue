<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { format } from "echarts";
import { EChart } from "@ontomato/foundation-ui/chart";
import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import { useDarkMode } from "../useDarkMode";
import { subgraphOption, subgraphSize } from "./subgraph-chart";

/** A dataset's source analysis drawn as delivered; filters are listed per query under the graph. */
const props = defineProps<{ graph: QuerySubgraph }>();
const isDark = useDarkMode();
const frame = ref<HTMLElement>();
const option = shallowRef<ReturnType<typeof subgraphOption>>();

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

function paint() {
  const css = getComputedStyle(frame.value!);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  option.value = subgraphOption(
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
    format.encodeHTML,
  );
}

// CSS tokens are read where the graph is shown, so a theme change repaints.
onMounted(paint);
watch([() => props.graph, isDark], paint);
</script>

<template>
  <div class="subgraph">
    <div ref="frame" class="frame">
      <EChart v-if="option" class="canvas" :option="option" :height="size.height" :style="{ width: `${size.width}px` }" />
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
