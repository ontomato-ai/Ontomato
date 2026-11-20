<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { chartProjectionTemplateSchema, DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import { MetricChart as ChartView } from "@ontomato/foundation-ui/chart";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useMemberData } from "../panel/member";

/**
 * One chart, drawn as its source card draws it: the card's chart file (the member's `template`) filled with a
 * MetricView's output (its `result`) for the card's saved parameters with the values this panel binds laid over them,
 * which the card's owner works out for the reader. The platform supplies both, in a directly rendered panel and in a
 * panel's frame alike; the chart sends no request of its own. It is drawn once both are read; until then, or when
 * either cannot be, the state of the first that is not ready stands in its place, in the product's one presentation —
 * an output with no rows is the owner's empty answer, a refusal its owner's reason — never an older chart or another.
 */
defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const template = useMemberData("template");
const result = useMemberData("result");

/** The source card's chart file and saved parameters, as its owner hands them over. */
type ChartTemplate = ReturnType<typeof chartProjectionTemplateSchema.parse>;

/** What the chart draws: the card's chart file and the output, the owner's note when it was cut. */
interface ChartDrawing {
  file: ChartTemplate["chartFile"]["content"];
  metric: { columns: DashboardMetricOutput["columns"]; rows: DashboardMetricOutput["rows"]; truncation?: { truncationHint: string } };
}

const chart = computed<DataStateResult<ChartDrawing>>(() => {
  if (template.value.status !== "ready") return template.value;
  if (result.value.status !== "ready") return result.value;
  const { chartFile } = template.value.value as unknown as ChartTemplate;
  const { columns, rows, truncation } = result.value.value as unknown as DashboardMetricOutput;
  return {
    status: "ready",
    value: { file: chartFile.content, metric: { columns, rows, ...(truncation ? { truncation: { truncationHint: truncation.truncationHint } } : {}) } },
  };
});
const labels = computed(() => ({
  empty: t("ontology.ovNoChartData"),
  forbidden: t("platform.dataForbidden"),
  awaiting: t("platform.dataAwaiting"),
}));
</script>

<template>
  <div class="sdk-metric-chart">
    <DataState :result="chart" :labels="labels">
      <template #default="{ value }">
        <ChartView
          :file="value.file"
          :metric="value.metric"
          :undated="t('ontology.ovUndated')"
          :empty="t('ontology.ovNoChartData')"
        ></ChartView>
      </template>
    </DataState>
  </div>
</template>

<style scoped>
.sdk-metric-chart {
  min-width: 0;
}
</style>
