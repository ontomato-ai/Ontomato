<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isMetricReferenceEntry } from "@ontomato/contracts/dashboard";
import { fetchDashboardLocalDetail } from "../api";

const props = defineProps<{ dashboardId: string }>();
const selection = defineModel<string[] | undefined>();
const { locale } = useI18n();
const cards = ref<{ id: string; name: string }[]>([]);
const loading = ref(false);
const error = ref("");
let generation = 0;
onBeforeUnmount(() => { generation++; });
watch(() => props.dashboardId, async id => {
  const current = ++generation;
  loading.value = true; error.value = ""; cards.value = [];
  try {
    const board = await fetchDashboardLocalDetail(id);
    if (current !== generation) return;
    if (!board) throw new Error(locale.value.startsWith("zh") ? "仪表盘当前不可访问" : "Dashboard unavailable");
    cards.value = board.groups.flatMap(group => [...group.metrics, ...(group.charts ?? [])]).filter(isMetricReferenceEntry);
  } catch (failure) { if (current === generation) error.value = failure instanceof Error ? failure.message : String(failure); }
  finally { if (current === generation) loading.value = false; }
}, { immediate: true });
</script>

<template>
  <p v-if="error" role="alert">{{ error }}</p>
  <el-select v-else :model-value="selection" multiple filterable :loading="loading" :disabled="loading" :placeholder="locale.startsWith('zh') ? '默认展示前 3 个指标和前 2 个图表' : 'Default: first 3 metrics and 2 charts'" @update:model-value="selection = $event">
    <el-option v-for="card in cards" :key="card.id" :value="card.id" :label="card.name" />
    <el-option v-for="id in (selection ?? []).filter(id => !cards.some(card => card.id === id))" :key="id" :value="id" :label="locale.startsWith('zh') ? '内容已删除或不可访问' : 'Removed or unavailable card'" />
  </el-select>
</template>
