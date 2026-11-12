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
    <EChart v-if="mode === 'chart' && option" :option="modalOption" :theme="theme" height="100%" @resize="drawn.track" />
    <TablePreview
      v-if="mode === 'table'"
      :table="table"
      height="100%"
      :empty-text="t('dashboard.noDataToDisplay')"
    />
  </el-dialog>
</template>

<script setup>
import { computed } from "vue";
import { EChart, useChartTheme } from "@ontomato/foundation-ui/chart";
import { TablePreview } from "@ontomato/foundation-ui/preview";
import { chartBrandColors } from "@ontomato/contracts/chart-presentation";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";
import { fitChart, useDrawnSize } from "./utils/chartFit";

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: "chart" },
  title: { type: String, default: "" },
  option: { type: Object, default: null },
  /** The card's data as the table shows it. */
  table: { type: Object, required: true },
});

const emit = defineEmits(["close"]);
const { t } = useI18n();

const { zoomChartTheme } = workbenchContent().dashboard;
const chartTheme = useChartTheme();
const theme = computed(() => (zoomChartTheme === "dashboard" ? chartTheme.value : undefined));
const drawn = useDrawnSize();
/**
 * The card's own option (its formatters included) on the dialog's background, without the title the dialog header
 * shows, laid out for the dialog's size; brand colours come from the platform's chart theme in either zoom theme.
 */
const modalOption = computed(() =>
  fitChart(
    chartBrandColors({ ...props.option, backgroundColor: "transparent", title: undefined }, chartTheme.value),
    drawn.size.value
  )
);
</script>

<style>
/* The dialog is drawn in the page's overlay layer, outside this component: the card's size, its title on one line, and
   the chart or table filling the body (the platform stylesheet makes every dialog a column whose body takes the rest). */
.chart-zoom-dialog {
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
  flex-direction: column;
}

.chart-zoom-dialog .chart-zoom-body .table-preview .el-table__header .cell {
  white-space: normal;
  overflow-wrap: anywhere;
}

.chart-zoom-body > * {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
