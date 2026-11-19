<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { init, type ECharts, type EChartsCoreOption } from "echarts/core";
import { prepareChart } from "./modules";

/**
 * Draws one ECharts chart: creates the instance, applies each new option and theme, follows the size of
 * its element and disposes of the instance. What is drawn (option, data, layout, menus) belongs to the caller. The parts
 * of ECharts an option needs are made available before it is drawn (`prepareChart`), so a chart of any kind draws.
 */
const props = defineProps<{
  /** The complete option; each new value replaces the drawn chart. */
  option: EChartsCoreOption;
  /** A native ECharts theme object; ECharts' default theme without one. */
  theme?: Record<string, unknown>;
  /** Height of the chart, in pixels or as a CSS length; the width follows the container. */
  height: number | string;
}>();
const emit = defineEmits<{
  /** The chart's size in pixels whenever its element is laid out at a new size, starting with the first. */
  resize: [size: { width: number; height: number }];
}>();

const el = ref<HTMLElement>();
let chart: ECharts | undefined;
let observer: ResizeObserver | undefined;
let unmounted = false;
/** The latest option, drawn once the parts it needs are there; an older one still loading is not drawn over it. */
let latest = 0;

function draw(option: EChartsCoreOption) {
  const current = ++latest;
  const apply = () => {
    if (unmounted || current !== latest) return;
    if (!chart) start();
    chart!.setOption(option, { notMerge: true });
  };
  const pending = prepareChart(option as Record<string, unknown>);
  if (pending) void pending.then(apply);
  else apply();
}

function start() {
  chart = init(el.value!, props.theme);
  observer = new ResizeObserver(() => {
    chart!.resize();
    emit("resize", { width: chart!.getWidth(), height: chart!.getHeight() });
  });
  observer.observe(el.value!);
}

onMounted(() => draw(props.option));
watch(() => props.option, draw);
watch(() => props.theme, (theme) => chart?.setTheme(theme ?? "default"));
onBeforeUnmount(() => {
  unmounted = true;
  observer?.disconnect();
  chart?.dispose();
});
</script>

<template>
  <div ref="el" :style="{ height: typeof height === 'number' ? `${height}px` : height }" />
</template>
