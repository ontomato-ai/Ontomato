<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="min(1100px, 92vw)"
    align-center
    append-to-body
    destroy-on-close
    class="chart-zoom-dialog"
    body-class="chart-zoom-body"
    @close="emit('close')"
  >
    <EChart v-if="mode === 'chart' && option" :option="modalOption" :theme="theme" height="100%" />
    <ChartDataTable v-show="mode === 'table'" :tabular="tabular" :max-rows="maxRows" />
  </el-dialog>
</template>

<script setup>
import { computed } from "vue";
import { EChart, useChartTheme } from "@ontomato/foundation-ui/chart";
import ChartDataTable from "./ChartDataTable.vue";
import { chartBrandColors } from "@ontomato/contracts/chart-presentation";
import { workbenchContent } from "../../../content";

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: "chart" },
  title: { type: String, default: "" },
  option: { type: Object, default: null },
  tabular: { type: Object, default: null },
  maxRows: { type: Number, default: 500 },
});

const emit = defineEmits(["close"]);

const { zoomChartTheme } = workbenchContent().dashboard;
const chartTheme = useChartTheme();
const theme = computed(() => (zoomChartTheme === "dashboard" ? chartTheme.value : undefined));
/**
 * The card's chart on the dialog's background, without the title the dialog header shows; brand colours come from
 * the platform's chart theme in either zoom theme.
 */
const modalOption = computed(() =>
  chartBrandColors({ ...props.option, backgroundColor: "transparent", title: undefined }, chartTheme.value)
);
</script>

<style>
/* The dialog is drawn in the page's overlay layer, outside this component: the card's size, its title on one line, and
   the chart or table filling the rest. */
.chart-zoom-dialog {
  display: flex;
  flex-direction: column;
  height: min(720px, 92vh);
}

.chart-zoom-dialog .el-dialog__title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chart-zoom-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.chart-zoom-body > * {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
