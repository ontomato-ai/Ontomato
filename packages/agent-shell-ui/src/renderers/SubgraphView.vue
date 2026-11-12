<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { format } from "echarts";
import { EChart } from "@ontomato/foundation-ui/chart";
import { useDarkMode } from "@ontomato/foundation-ui/theme";
import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import { subgraphOption, subgraphSize } from "./subgraph-chart";

/** A dataset's source analysis drawn as delivered, its column groups titled by `columns`. */
const props = defineProps<{ graph: QuerySubgraph; columns: Record<"class" | "field" | "operation" | "output", string> }>();
const isDark = useDarkMode();
const frame = ref<HTMLElement>();
const option = shallowRef<ReturnType<typeof subgraphOption>>();

const measure = document.createElement("canvas").getContext("2d");
if (measure) measure.font = "12px sans-serif";
const textWidth = (label: string) => measure?.measureText(label).width ?? label.length * 8;
/** Drawn at natural size; the frame scrolls when the graph is larger than the panel. */
const size = computed(() => subgraphSize(props.graph, textWidth));

function paint() {
  const css = getComputedStyle(frame.value!);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  option.value = subgraphOption(
    props.graph,
    // Kinds take the brand's categorical chart colours in their fixed order; status colours stay for states.
    {
      text: token("--el-text-color-regular", "#303133"),
      muted: token("--el-text-color-secondary", "#909399"),
      line: token("--el-border-color", "#dcdfe6"),
      surface: token("--el-bg-color", "#ffffff"),
      onClass: token("--el-color-white", "#ffffff"),
      class: token("--chart-1", "#409eff"),
      field: token("--el-border-color-darker", "#cdd0d6"),
      operation: token("--chart-2", "#909399"),
      output: token("--chart-3", "#67c23a"),
    },
    props.columns,
    textWidth,
    format.encodeHTML,
  );
}

// CSS tokens are read where the graph is shown, so a theme change repaints.
onMounted(paint);
watch([() => props.graph, () => props.columns, isDark], paint);
</script>

<template>
  <div class="subgraph">
    <div ref="frame" class="frame">
      <EChart v-if="option" class="canvas" :option="option" :height="size.height" :style="{ width: `${size.width}px` }" />
    </div>
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
</style>
