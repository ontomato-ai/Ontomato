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
    <MetricChart v-if="mode === 'chart'" :file="file" :metric="metric" height="100%" :empty="t('common.noData')" />
    <TablePreview
      v-if="mode === 'table'"
      :table="table"
      height="100%"
      :empty-text="t('dashboard.noDataToDisplay')"
    />
  </el-dialog>
</template>

<script setup>
import { MetricChart } from "@ontomato/foundation-ui/chart";
import { TablePreview } from "@ontomato/foundation-ui/preview";
import { useI18n } from "vue-i18n";

defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: "chart" },
  title: { type: String, default: "" },
  /** The card's chart document, drawn at the dialog's size exactly as the card draws it. */
  file: { type: Object, default: null },
  /** The card's output for that document: its columns, rows and truncation. */
  metric: { type: Object, default: null },
  /** The card's data as the table shows it. */
  table: { type: Object, required: true },
});

const emit = defineEmits(["close"]);
const { t } = useI18n();
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
