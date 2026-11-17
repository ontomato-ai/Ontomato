<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElAlert, ElButton, ElEmpty, ElOption, ElSelect } from "element-plus";
import type { DashboardDetail, DashboardListItem, MetricReferenceChartEntry } from "@ontomato/contracts/dashboard";
import { useManagerClient, useOntologyText } from "../context";
import ElDialog from "../ManagerDialog.vue";

/**
 * Bring one of the author's own dashboard charts into the form that is being edited: the chart file and the MetricView
 * it was drawn from, as the dashboard currently holds them. The source card is only read; saving belongs to the target.
 */
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  pick: [chart: MetricReferenceChartEntry];
}>();
const client = useManagerClient();
const { ot } = useOntologyText();

const dashboards = ref<DashboardListItem[]>([]);
const dashboardId = ref("");
const detail = ref<DashboardDetail | null>(null);
const chartId = ref("");
const error = ref("");
let generation = 0;

const charts = computed(() => detail.value?.groups.flatMap(group => group.charts) ?? []);
const chart = computed(() => charts.value.find(entry => entry.id === chartId.value));

async function readDashboard(id: string) {
  const current = ++generation;
  detail.value = null; chartId.value = ""; error.value = "";
  try {
    const result = await client.loadDashboard(id);
    if (current !== generation) return;
    detail.value = result;
    chartId.value = result.groups.flatMap(group => group.charts)[0]?.id ?? "";
  } catch (reason) {
    if (current === generation) error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

watch(() => props.modelValue, async open => {
  if (!open) return;
  const current = ++generation;
  error.value = ""; detail.value = null; chartId.value = "";
  try {
    dashboards.value = await client.loadDashboards();
    if (current !== generation) return;
    const first = dashboards.value[0]?.id ?? "";
    dashboardId.value = first;
    if (first) await readDashboard(first);
  } catch (reason) {
    if (current === generation) error.value = reason instanceof Error ? reason.message : String(reason);
  }
}, { immediate: true });

watch(dashboardId, id => { if (props.modelValue && id) void readDashboard(id); });

/** The card as the dashboard holds it: its file, its MetricView and its parameters. Saving belongs to the target. */
function choose() {
  if (!chart.value) return;
  emit("pick", chart.value);
  emit("update:modelValue", false);
}
</script>
<template>
  <el-dialog :model-value="modelValue" class="dashboard-chart-picker" :title="ot('ovBringChart')" width="min(560px, calc(100% - 32px))" @update:model-value="emit('update:modelValue', $event)">
    <p class="picker-hint">{{ ot('ovBringChartHint') }}</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="!dashboards.length">
      <el-empty :description="ot('ovNoDashboardCharts')" />
    </template>
    <template v-else>
      <label class="picker-field">{{ ot('ovBringChartDashboard') }}<el-select v-model="dashboardId" filterable :aria-label="ot('ovBringChartDashboard')"><el-option v-for="item in dashboards" :key="item.id" :value="item.id" :label="item.name" /></el-select></label>
      <template v-if="charts.length">
        <label class="picker-field">{{ ot('ovBringChartCard') }}<el-select v-model="chartId" filterable :aria-label="ot('ovBringChartCard')"><el-option v-for="entry in charts" :key="entry.id" :value="entry.id" :label="entry.name" /></el-select></label>
      </template>
      <el-empty v-else-if="detail" :description="ot('ovNoDashboardCharts')" />
      <p v-if="chart" class="picker-metric">{{ ot('ovBringChartMetric') }} · <code>{{ chart.query.metricId }}</code></p>
    </template>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ ot('ovCancel') }}</el-button>
      <el-button type="primary" :disabled="!chart" @click="choose">{{ ot('ovBringChartConfirm') }}</el-button>
    </template>
  </el-dialog>
</template>
<style scoped>
.picker-hint { margin: 0 0 var(--manager-content-gap); color: var(--el-text-color-secondary); font-size: var(--text-sm); }
.picker-field { display: grid; gap: var(--manager-label-gap); margin-bottom: var(--manager-content-gap); font-size: var(--text-sm); }
.picker-metric { margin: 0; font-size: var(--text-xs); color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
</style>
