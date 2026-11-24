<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { chartProjectionTemplateSchema, DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import { MetricChart as ChartView } from "@ontomato/foundation-ui/chart";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useMemberData, useMemberRefresh } from "../panel/member";
import { useDataStateLabels } from "./data-state-labels";

/** The source card's chart file and saved parameters, as its owner hands them over. */
type ChartTemplate = ReturnType<typeof chartProjectionTemplateSchema.parse>;

/**
 * One chart, drawn as its source card draws it: the card's chart file (the member's `template`) filled with a
 * MetricView's output (its `result`) for the card's saved parameters with the values this panel binds laid over them,
 * which the card's owner works out for the reader. The platform supplies both, in a directly rendered panel and in a
 * panel's frame alike; the chart sends no request of its own. It is drawn once both are read; until then, or when
 * either cannot be, the state of the first that is not ready stands in its place, in the product's one presentation —
 * an output with no rows is the owner's empty answer, a refusal its owner's reason — never an older chart or another.
 */
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** Optional chart file override for live unsaved draft preview instead of the saved template's chart file. */
    fileOverride?: ChartTemplate["chartFile"]["content"] | null;
    /** Minimum height of the chart container; defaults to `"320px"` standalone and can be set to `"100%"` or `"220px"` inside fixed-height grid cells. */
    minHeight?: string;
  }>(),
  {
    fileOverride: null,
    minHeight: "320px",
  },
);

const { t } = useI18n();
const template = useMemberData("template");
const result = useMemberData("result");
const refreshMember = useMemberRefresh();

/** What the chart draws: the card's chart file and the output, the owner's note when it was cut. */
interface ChartDrawing {
  file: ChartTemplate["chartFile"]["content"];
  metric: { columns: DashboardMetricOutput["columns"]; rows: DashboardMetricOutput["rows"]; truncation?: { truncationHint: string } };
}

const chart = computed<DataStateResult<ChartDrawing>>(() => {
  if (!props.fileOverride && template.value.status !== "ready") return template.value;
  if (result.value.status !== "ready") return result.value;
  const file = props.fileOverride
    ?? (template.value.status === "ready" ? (template.value.value as unknown as ChartTemplate).chartFile.content : null);
  if (!file) return { status: "empty" };
  const { columns, rows, truncation } = result.value.value as unknown as DashboardMetricOutput;
  return {
    status: "ready",
    value: { file, metric: { columns, rows, ...(truncation ? { truncation: { truncationHint: truncation.truncationHint } } : {}) } },
  };
});
const labels = useDataStateLabels(() => t("ontology.ovNoChartData"));

function refresh() {
  refreshMember();
}

defineExpose({ refresh });
</script>

<template>
  <div class="sdk-metric-chart" :style="{ minHeight: props.minHeight }">
    <DataState :result="chart" :labels="labels">
      <template #default="{ value }">
        <ChartView
          :file="value.file"
          :metric="value.metric"
          height="100%"
          :undated="t('ontology.ovUndated')"
          :empty="t('ontology.ovNoChartData')"
        ></ChartView>
      </template>
    </DataState>
  </div>
</template>

<style scoped>
/* Fills the box its member is placed in; falls back to 320px when that box has no definite height. */
.sdk-metric-chart {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 320px;
}
</style>
