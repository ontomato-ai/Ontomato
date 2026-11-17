<script setup lang="ts">
import type { ChartMetricColumn, ChartRow } from "@ontomato/contracts/chart-data";
import type { ChartViewWidget } from "@ontomato/contracts/object-views";
import { MetricChart } from "@ontomato/foundation-ui/chart";
import { useOntologyText } from "../context";

/**
 * A view's chart: the file saved in this version, filled from the MetricView output the runtime read for the current
 * object and parameters. The columns are what that MetricView declares, so a file that draws fewer of them still fills;
 * the rows are the read's current result. No skill runs here, and the component keeps no copy of the data.
 */
defineProps<{ widget: ChartViewWidget; columns: ChartMetricColumn[]; rows: Record<string, unknown>[] }>();
const { ot } = useOntologyText();
</script>
<template>
  <div class="view-chart" :style="{ height: widget.height + 'px' }">
    <MetricChart :file="widget.chartFile" :metric="{ columns, rows: rows as ChartRow[] }" :height="widget.height" :undated="ot('ovUndated')" :empty="ot('ovNoChartData')" />
  </div>
</template>
<style scoped>
.view-chart { box-sizing: border-box; min-width: 0; max-width: 100%; overflow: hidden; }
</style>
