<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isMetricReferenceEntry, type MetricReferenceMetricEntry, type MetricReferenceChartEntry } from "@ontomato/contracts/dashboard";
import { EChart, useChartTheme } from "@ontomato/foundation-ui/chart";
import { ElButton } from "element-plus";
import { chartBrandColors } from "@ontomato/contracts/chart-presentation";
import { fetchDashboardLocalDetail, queryDashboardCard } from "../api";
import { metricCardValue, metricChartOption } from "./utils/metricCard";

const props = defineProps<{ dashboardId: string; revision: number }>();
const emit = defineEmits<{ select: [card: { id: string; name: string }] }>();
const { locale } = useI18n();
const theme = useChartTheme();
const charts = ref<{ id: string; name: string; option: Record<string, any> | null; error: string; partial: boolean }[]>([]);
const loading = ref(false);
const error = ref("");
const metrics = ref<{ id: string; name: string; value: string; unit: string; error: string; partial: boolean; readAt: string }[]>([]);
let generation = 0;
onBeforeUnmount(() => { generation++; });
watch(() => [props.dashboardId, props.revision], async () => {
  const current = ++generation;
  loading.value = true; error.value = ""; metrics.value = []; charts.value = [];
  try {
    const board = await fetchDashboardLocalDetail(props.dashboardId);
    if (current !== generation) return;
    if (!board) throw new Error(locale.value.startsWith("zh") ? "仪表盘当前不可访问" : "Dashboard unavailable");
    const cards = board.groups.flatMap(group => group.metrics).filter((card): card is MetricReferenceMetricEntry => isMetricReferenceEntry(card)).slice(0, 3);
    const chartCards = board.groups.flatMap(group => group.charts ?? []).filter((card): card is MetricReferenceChartEntry => isMetricReferenceEntry(card)).slice(0, 2);
    charts.value = chartCards.map(card => ({ id: card.id, name: card.name, option: null, error: "", partial: false }));
    metrics.value = cards.map(card => ({ id: card.id, name: card.name, value: "", unit: card.unit ?? "", error: "", partial: false, readAt: "" }));
    await Promise.all([...cards.map(async (card, index) => {
      try {
        const output = await queryDashboardCard(props.dashboardId, card.id);
        if (current !== generation) return;
        const value = metricCardValue(card, output.rows);
        Object.assign(metrics.value[index]!, { value: value.empty ? (locale.value.startsWith("zh") ? "暂无数据" : "No data") : value.text,
          partial: !!output.truncation, readAt: new Date().toLocaleTimeString(locale.value, { hour: "2-digit", minute: "2-digit" }) });
      } catch (failure) {
        if (current === generation) metrics.value[index]!.error = failure instanceof Error ? failure.message : String(failure);
      }
    }), ...chartCards.map(async (card, index) => {
      try {
        const output = await queryDashboardCard(props.dashboardId, card.id);
        if (current !== generation) return;
        charts.value[index] = { id: card.id, name: output.card.name, option: output.rows.length ? metricChartOption(output.card as MetricReferenceChartEntry, output) : null, error: "", partial: !!output.truncation };
      } catch (failure) { if (current === generation) charts.value[index]!.error = failure instanceof Error ? failure.message : String(failure); }
    })]);
  } catch (failure) { if (current === generation) error.value = failure instanceof Error ? failure.message : String(failure); }
  finally { if (current === generation) loading.value = false; }
}, { immediate: true });
</script>

<template>
  <div class="metric-preview" :aria-busy="loading">
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-else-if="metrics.length" class="preview-values">
      <div v-for="metric in metrics" :key="metric.id" class="preview-value">
        <button class="metric-open" @click="emit('select', { id: metric.id, name: metric.name })">{{ metric.name }}</button>
        <p v-if="metric.error" role="alert" class="preview-error">{{ metric.error }}</p>
        <template v-else>
          <strong>{{ metric.value || (locale.startsWith('zh') ? '读取中…' : 'Loading…') }} <small v-if="metric.value">{{ metric.unit }}</small></strong>
          <small v-if="metric.readAt">{{ locale.startsWith('zh') ? '读取于' : 'Read at' }} {{ metric.readAt }}</small>
          <small v-if="metric.partial">{{ locale.startsWith('zh') ? '结果已截断，请查看仪表盘' : 'Partial result; open dashboard' }}</small>
        </template>
      </div>
    </div>
    <p v-else-if="!charts.length">{{ loading ? (locale.startsWith('zh') ? '读取指标…' : 'Loading metrics…') : (locale.startsWith('zh') ? '打开仪表盘查看图表与明细' : 'Open dashboard for charts and details') }}</p>
    <div v-if="charts.length" class="preview-charts">
    <section v-for="chart in charts" :key="chart.id" class="preview-chart">
      <el-button text class="chart-open" @click="emit('select', { id: chart.id, name: chart.name })">{{ chart.name }}</el-button>
      <p v-if="chart.error" role="alert" class="preview-error">{{ chart.error }}</p>
      <EChart v-else-if="chart.option" :option="chartBrandColors(chart.option, theme)" :theme="theme" height="220px" />
      <p v-else>{{ loading ? (locale.startsWith('zh') ? '读取图表…' : 'Loading chart…') : (locale.startsWith('zh') ? '暂无数据' : 'No data') }}</p>
      <small v-if="chart.partial">{{ locale.startsWith('zh') ? '结果已截断，请查看完整仪表盘' : 'Partial result; open full dashboard' }}</small>
    </section>
    </div>
  </div>
</template>

<style scoped>
.metric-preview { container: metric-preview / inline-size; }
.preview-values { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: var(--spacing-lg); }
.preview-value { display: flex; flex-direction: column; gap: var(--spacing-xs); min-width: 0; padding-block: var(--spacing-xs) var(--spacing-sm); }
.metric-open { border: 0; background: transparent; padding: 0; color: var(--el-text-color-regular); font: inherit; font-size: var(--text-sm); line-height: 20px; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.metric-open:hover { color: var(--el-color-primary); }
.metric-open:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
.preview-value > span, small, p { color: var(--el-text-color-secondary); font-size: var(--text-sm); overflow-wrap: anywhere; }
strong { font-size: var(--text-2xl); line-height: 1.25; font-weight: var(--font-semibold); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
small { font-size: var(--text-xs); line-height: 1.5; font-weight: normal; }
strong small { font-size: var(--text-sm); }
p { margin: var(--spacing-sm) 0 0; }
.preview-error { color: var(--el-color-danger); }
.preview-charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--spacing-lg); margin-top: var(--spacing-md); }
.preview-chart { padding-top: var(--spacing-md); border-top: 1px solid var(--el-border-color-lighter); min-width: 0; }
.chart-open { max-width: 100%; justify-content: flex-start; white-space: normal; height: auto; min-height: var(--control-height); padding: var(--spacing-xs) 0; line-height: 20px; }
@container metric-preview (max-width: 620px) { .preview-charts { grid-template-columns: minmax(0, 1fr); } }
@container metric-preview (max-width: 420px) { .preview-values { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@container metric-preview (max-width: 240px) { .preview-values { grid-template-columns: 1fr; } }
</style>
