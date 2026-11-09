<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { init, type ECharts, type EChartsCoreOption } from "echarts";

/**
 * Draws one ECharts chart: creates the instance, applies each new option and theme, follows the size of
 * its element and disposes of the instance. What is drawn (option, data, layout, menus) belongs to the caller.
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
let chart: ECharts;
let observer: ResizeObserver;

onMounted(() => {
  chart = init(el.value!, props.theme);
  observer = new ResizeObserver(() => {
    chart.resize();
    emit("resize", { width: chart.getWidth(), height: chart.getHeight() });
  });
  observer.observe(el.value!);
  chart.setOption(props.option, { notMerge: true });
});
watch(() => props.option, (option) => chart.setOption(option, { notMerge: true }));
watch(() => props.theme, (theme) => chart.setTheme(theme ?? "default"));
onBeforeUnmount(() => {
  observer.disconnect();
  chart.dispose();
});
</script>

<template>
  <div ref="el" :style="{ height: typeof height === 'number' ? `${height}px` : height }" />
</template>
