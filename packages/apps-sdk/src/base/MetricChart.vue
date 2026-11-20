<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { ChartMetricColumn, ChartRow } from "@ontomato/contracts/chart-data";
import { MetricChart as ChartView } from "@ontomato/foundation-ui/chart";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useProjectionObjectRefresh, useProjectionSlot } from "../panel/context";
import { useMember, useMemberData } from "../panel/member";
import { metricChartClient, type ChartRead, type ChartTemplate } from "../panel/metric-chart";
import { stateObject, type PanelFieldValue } from "../panel/state";

/**
 * One chart, drawn as its source card draws it: the drawing is the card's chart file, and the data is a MetricView's
 * output for the card's saved parameters with the values this panel binds laid over them, read with the reader's own
 * credential. Nothing of it is kept in the projection, so all of it is read again whenever the chart is opened, the
 * reader comes back to it, or a bound value changes. A chart whose source is gone, or a MetricView that refuses, shows
 * its owner's reason in the chart's place — never an older chart or another one.
 *
 * In a directly rendered panel the platform supplies both: the member's `template` (the card's chart file) and its
 * `result` (the output, the card's owner laying the bound values over the card's parameters; no rows is the owner's
 * empty answer), each in the product's one presentation of its state. In a panel's frame a registered chart projection
 * reads them through the frame's chart source client.
 */
defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const slot = useProjectionSlot();
const member = useMember();

/** A MetricView's output as its owner answers it: the columns it returns, its rows and the note when it was cut. */
interface MetricOutput {
  columns: ChartMetricColumn[];
  rows: ChartRow[];
  truncation: { truncationHint: string } | null;
}

const templateData = member ? useMemberData("template") : null;
const resultData = member ? useMemberData("result") : null;

const frameChart = shallowRef<ChartRead | null>(null);
const frameLoading = ref(true);
const frameFailure = shallowRef<Error | null>(null);

/** The chart's state: the card's drawing and the output once both are read, else the first of them that is not. */
const chart = computed<DataStateResult<ChartRead>>(() => {
  if (templateData && resultData) {
    const template = templateData.value;
    if (template.status !== "ready") return template;
    const result = resultData.value;
    if (result.status !== "ready") return result;
    const { columns, rows, truncation } = result.value as unknown as MetricOutput;
    return {
      status: "ready",
      value: {
        template: (template.value as { chartFile: ChartTemplate }).chartFile,
        metric: { columns, rows, ...(truncation ? { truncation: { truncationHint: truncation.truncationHint } } : {}) },
      },
    };
  }
  if (frameFailure.value) return { status: "error", message: frameFailure.value.message };
  if (frameLoading.value) return { status: "loading" };
  return { status: "ready", value: frameChart.value! };
});
const labels = computed(() => ({
  empty: t("ontology.ovNoChartData"),
  forbidden: t("platform.dataForbidden"),
  awaiting: t("platform.dataAwaiting"),
}));

if (!member) {
  const client = metricChartClient();
  /**
   * What this panel binds, by MetricView parameter: each declared input that holds a value, an object by its primary
   * key as a MetricView parameter takes it. An input with no value, or a collection, leaves the card's own parameter.
   */
  const bound = computed<Record<string, RuntimeJsonValue>>(() => Object.fromEntries(
    Object.entries(slot.inputs)
      .filter(([, value]) => value !== null && value !== undefined && !Array.isArray(value))
      .map(([name, value]) => [name, stateObject(value as PanelFieldValue)?.primaryKey ?? value as RuntimeJsonValue]),
  ));
  let reading = 0;
  const load = () => {
    const current = ++reading;
    frameLoading.value = true;
    frameFailure.value = null;
    void client.read(slot.projection.id, slot.projection.binding.id, bound.value).then(
      (read) => {
        if (current !== reading) return;
        frameChart.value = read;
        frameLoading.value = false;
      },
      (reason: unknown) => {
        if (current !== reading) return;
        frameChart.value = null;
        frameFailure.value = reason instanceof Error ? reason : new Error(String(reason));
        frameLoading.value = false;
      },
    );
  };
  onMounted(load);
  watch(() => JSON.stringify(bound.value), load);
  // The reader coming back to the panel reads it all again; an object this chart is bound to that changed does too.
  useProjectionObjectRefresh((id) => Object.values(bound.value).includes(id), load);
}
</script>

<template>
  <div class="sdk-metric-chart">
    <DataState :result="chart" :labels="labels">
      <template #default="{ value }">
        <ChartView
          :file="value.template.content"
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
