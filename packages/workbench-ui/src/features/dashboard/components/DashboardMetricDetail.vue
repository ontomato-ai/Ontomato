<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { DashboardCardData } from "@ontomato/contracts/dashboard";
import { queryDashboardCard } from "../api";
const props = defineProps<{ dashboardId: string; cardId: string }>();
const { locale } = useI18n();
const data = ref<DashboardCardData | null>(null), error = ref(""), loading = ref(false);
let revision = 0;
onBeforeUnmount(() => { revision++; });
async function load() {
  const current = ++revision; data.value = null; error.value = ""; loading.value = true;
  try { const result = await queryDashboardCard(props.dashboardId, props.cardId); if (current === revision) data.value = result; }
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
      <el-table :data="data.rows" empty-text="—"><el-table-column v-for="column in data.columns" :key="column.key" :prop="column.key" :label="column.label ?? column.key" /></el-table>
      <p v-if="data.truncation" role="note">{{ data.truncation.truncationHint }}</p>
      <p class="detail-note">{{ locale.startsWith('zh') ? '按仪表盘保存的指标与参数实时查询；本页展示指标结果，完整分析可交给助手。' : 'Live results using the saved metric and parameters. Ask the assistant for further analysis.' }}</p>
    </template>
    <el-button :loading="loading" @click="load">{{ locale.startsWith('zh') ? '刷新数据' : 'Refresh data' }}</el-button>
  </div>
</template>
<style scoped>.detail-note { color: var(--el-text-color-secondary); font-size: var(--text-sm); line-height: var(--leading-sm); }</style>
