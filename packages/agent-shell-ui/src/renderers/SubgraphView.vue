<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Maximize, Minus, Plus } from "lucide-vue-next";
import { format } from "echarts";
import { EChart } from "@ontomato/foundation-ui/chart";
import { useDarkMode } from "@ontomato/foundation-ui/theme";
import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import { subgraphOption, subgraphSize } from "./subgraph-chart";
import { shellContextKey } from "../context";

/** A dataset's source analysis drawn as delivered, its column groups titled by `columns`. */
const props = defineProps<{ graph: QuerySubgraph; columns: Record<"class" | "field" | "operation" | "output", string> }>();
const isDark = useDarkMode();
const frame = ref<HTMLElement>();
const option = shallowRef<ReturnType<typeof subgraphOption>>();
const shell = inject(shellContextKey, null);
const controls = computed(() => shell?.labels.value.graphZoom ?? { in: "Zoom in", out: "Zoom out", fit: "Fit to view" });
const scale = ref(1);
const fitting = ref(true);
let observer: ResizeObserver | undefined;
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

const measure = document.createElement("canvas").getContext("2d");
if (measure) measure.font = "12px sans-serif";
const textWidth = (label: string) => measure?.measureText(label).width ?? label.length * 8;
/** Drawn at natural size; the frame scrolls when the graph is larger than the panel. */
const size = computed(() => subgraphSize(props.graph, textWidth));
const scaled = computed(() => ({ width: size.value.width * scale.value, height: size.value.height * scale.value }));
function fit() {
  fitting.value = true;
  const width = frame.value?.clientWidth;
  if (!width) return;
  scale.value = Math.min(1, (width - 24) / Math.max(1, size.value.width), 536 / Math.max(1, size.value.height));
  frame.value!.scrollTo?.({ left: 0, top: 0 });
}
function zoom(factor: number) {
  fitting.value = false;
  scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale.value * factor));
}

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
onMounted(() => {
  paint();
  fit();
  observer = new ResizeObserver(() => { if (fitting.value) fit(); });
  observer.observe(frame.value!);
});
onBeforeUnmount(() => observer?.disconnect());
watch(size, () => { if (fitting.value) fit(); });
watch([() => props.graph, () => props.columns, isDark], paint);
</script>

<template>
  <div class="subgraph">
    <div class="graph-controls">
      <button type="button" :title="controls.out" :aria-label="controls.out" :disabled="scale <= MIN_SCALE" @click="zoom(1 / 1.2)"><Minus :size="15" /></button>
      <button type="button" :title="controls.in" :aria-label="controls.in" :disabled="scale >= MAX_SCALE" @click="zoom(1.2)"><Plus :size="15" /></button>
      <button type="button" :title="controls.fit" :aria-label="controls.fit" @click="fit"><Maximize :size="15" /></button>
    </div>
    <div ref="frame" class="frame">
      <div class="graph-stage" :style="{ minWidth: `${scaled.width + 24}px` }">
        <div class="graph-size" :style="{ width: `${scaled.width}px`, height: `${scaled.height}px` }">
          <EChart v-if="option" class="canvas" :option="option" :height="size.height" :style="{ width: `${size.width}px`, transform: `scale(${scale})` }" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subgraph {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}
.frame {
  width: 100%;
  min-width: 0;
  max-height: 560px;
  overflow: auto;
}
.graph-stage {
  display: grid;
  place-items: center;
  width: 100%;
  min-height: 240px;
  padding: 12px;
  box-sizing: border-box;
}
.graph-size { position: relative; flex: none; }
.canvas {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: top left;
}
.graph-controls { display: flex; justify-content: flex-end; gap: 4px; padding: 4px 12px; }
.graph-controls button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--radius-sm, 4px); background: transparent; color: var(--el-text-color-secondary); cursor: pointer; }
.graph-controls button:hover:not(:disabled) { background: var(--el-fill-color-light); color: var(--el-text-color-primary); }
.graph-controls button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 1px; }
.graph-controls button:disabled { opacity: .35; cursor: default; }
</style>
