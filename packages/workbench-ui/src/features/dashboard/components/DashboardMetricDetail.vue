<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { DashboardCardData } from "@ontomato/contracts/dashboard";
import { queryDashboardCard } from "../api";
const props = defineProps<{ dashboardId: string; cardId: string }>();
const { locale } = useI18n();
const data = ref<DashboardCardData | null>(null), error = ref(""), loading = ref(false);
const readAt = ref("");
const parameters = computed(() => Object.entries(data.value?.card.query.parameters ?? {}));
let revision = 0;
onBeforeUnmount(() => { revision++; });
async function load() {
  const current = ++revision; data.value = null; error.value = ""; readAt.value = ""; loading.value = true;
  try { const result = await queryDashboardCard(props.dashboardId, props.cardId); if (current === revision) { data.value = result; readAt.value = new Date().toLocaleString(locale.value); } }
  catch (failure) { if (current === revision) error.value = failure instanceof Error ? failure.message : String(failure); }
  finally { if (current === revision) loading.value = false; }
}
watch(() => [props.dashboardId, props.cardId], load, { immediate: true });
</script>
<template>
  <div :aria-busy="loading">
    <p v-if="loading">{{ locale.startsWith('zh') ? '正在读取当前数据…' : 'Reading current data…' }}</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <template v-if="data">
      <p>{{ data.metric.name }}</p>
      <el-descriptions :column="1" border class="metric-context">
        <el-descriptions-item :label="locale.startsWith('zh') ? '指标状态' : 'Metric status'">{{ data.metric.status === 'PUBLISHED' ? (locale.startsWith('zh') ? '已发布' : 'Published') : data.metric.status === 'PENDING_REVIEW' ? (locale.startsWith('zh') ? '待审核' : 'Pending review') : data.metric.status }}</el-descriptions-item>
        <el-descriptions-item :label="locale.startsWith('zh') ? '查询参数' : 'Query parameters'">
          <dl v-if="parameters.length" class="metric-parameters"><template v-for="[key, value] in parameters" :key="key"><dt>{{ key }}</dt><dd>{{ typeof value === 'object' ? JSON.stringify(value) : String(value) }}</dd></template></dl>
          <span v-else>{{ locale.startsWith('zh') ? '未设置查询参数' : 'No query parameters set' }}</span>
        </el-descriptions-item>
        <el-descriptions-item :label="locale.startsWith('zh') ? '本次读取时间' : 'Read time'">{{ readAt }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="data.rows" empty-text="—"><el-table-column v-for="column in data.columns" :key="column.key" :prop="column.key" :label="column.label ?? column.key" /></el-table>
      <p v-if="data.truncation" role="note">{{ data.truncation.truncationHint }}</p>
      <p class="detail-note">{{ locale.startsWith('zh') ? '按仪表盘保存的指标与参数实时查询。读取时间不代表业务数据更新时间；空值与演示标识沿用来源，不推断数据完整性。' : 'Live results using the saved metric and parameters. Read time is not the source update time. Missing values and demo labels are retained from the source; completeness is not inferred.' }}</p>
    </template>
    <el-button :loading="loading" @click="load">{{ locale.startsWith('zh') ? '刷新数据' : 'Refresh data' }}</el-button>
  </div>
</template>
<style scoped>
.detail-note { color: var(--el-text-color-secondary); font-size: var(--text-sm); line-height: var(--leading-sm); }
.metric-context { margin-bottom: var(--spacing-lg); }
.metric-parameters { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--spacing-xs) var(--spacing-md); margin: 0; }
.metric-parameters dt { color: var(--el-text-color-secondary); }
.metric-parameters dd { margin: 0; overflow-wrap: anywhere; }
</style>
