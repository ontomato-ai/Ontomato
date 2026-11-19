<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { MetricChart as ChartView } from "@ontomato/foundation-ui/chart";
import { useProjectionObjectRefresh, useProjectionSlot } from "../panel/context";
import { metricChartClient, type ChartRead } from "../panel/metric-chart";
import { stateObject, type PanelFieldValue } from "../panel/state";

/**
 * One registered chart, drawn as its source card draws it: the drawing is the card's chart file and the parameters are
 * the card's saved ones, both handed over by the dashboard owner for this projection; the data is the bound
 * MetricView's, read with the reader's own credential, with the values this panel binds laid over the card's
 * parameters here alone. The projection holds neither a drawing nor a query nor data, so all of it is read again
 * whenever the chart is opened, the reader comes back to it, or a bound value changes. A chart whose source is gone,
 * or a MetricView that refuses, shows its owner's reason in the chart's place — never an older chart or another one.
 */
defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const slot = useProjectionSlot();
const client = metricChartClient();

/**
 * What this panel binds, by MetricView parameter: each declared input that holds a value, an object by its primary key
 * as a MetricView parameter takes it. An input with no value leaves the card's own parameter.
 */
const bound = computed<Record<string, RuntimeJsonValue>>(() => Object.fromEntries(
  Object.entries(slot.inputs)
    // A collection binds no MetricView parameter.
    .filter(([, value]) => value !== null && value !== undefined && !Array.isArray(value))
    .map(([name, value]) => [name, stateObject(value as PanelFieldValue)?.primaryKey ?? value as RuntimeJsonValue]),
));

const chart = shallowRef<ChartRead | null>(null);
const loading = ref(true);
const failure = shallowRef<Error | null>(null);
let reading = 0;

function load() {
  const current = ++reading;
  loading.value = true;
  failure.value = null;
  void client.read(slot.projection.id, slot.projection.binding.id, bound.value).then(
    (read) => {
      if (current !== reading) return;
      chart.value = read;
      loading.value = false;
    },
    (reason: unknown) => {
      if (current !== reading) return;
      chart.value = null;
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
    },
  );
}

onMounted(load);
watch(() => JSON.stringify(bound.value), load);
// The reader coming back to the panel reads it all again; an object this chart is bound to that changed does too.
useProjectionObjectRefresh((id) => Object.values(bound.value).includes(id), load);
</script>

<template>
  <div class="sdk-metric-chart">
    <p v-if="failure" role="alert">{{ failure.message }}</p>
    <el-skeleton v-else-if="loading" :rows="4" animated></el-skeleton>
    <ChartView
      v-else-if="chart"
      :file="chart.template.content"
      :metric="chart.metric"
      :undated="t('ontology.ovUndated')"
      :empty="t('ontology.ovNoChartData')"
    ></ChartView>
  </div>
</template>

<style scoped>
.sdk-metric-chart {
  min-width: 0;
}
</style>
