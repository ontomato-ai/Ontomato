<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import type { MetricCardView } from "./utils/metricCard";
import { formatValue } from "./utils/metricCard";

/**
 * What a metric-reference card shows: the metric's name and review status as this refresh read them, the card's
 * parameter values, and the way to the metric in metric management. Internal values (revision) stay out.
 */
const props = defineProps<{ card: MetricCardView | null }>();
const visible = defineModel<boolean>({ required: true });
const { t } = useI18n();
const router = useRouter();

const STATUS: Record<string, string> = {
  PENDING_REVIEW: "dashboard.metricStatus.PENDING_REVIEW",
  PUBLISHED: "dashboard.metricStatus.PUBLISHED",
};
const status = computed(() => {
  const value = props.card?.metric?.status;
  return value === undefined ? "—" : STATUS[value] ? t(STATUS[value]) : value;
});
const parameters = computed(() => Object.entries(props.card?.query.parameters ?? {}));

function openMetric() {
  visible.value = false;
  void router.push({ name: platformRoutes.metric.name, params: { id: props.card!.query.metricId } });
}
</script>

<template>
  <el-dialog v-model="visible" :title="card?.title ?? card?.name ?? ''" width="min(560px, calc(100vw - 24px))" append-to-body>
    <el-descriptions v-if="card" :column="1" border class="metric-source">
      <el-descriptions-item :label="t('dashboard.metricName')">{{ card.metric?.name ?? "—" }}</el-descriptions-item>
      <el-descriptions-item :label="t('dashboard.metricStatusLabel')">{{ status }}</el-descriptions-item>
      <el-descriptions-item :label="t('dashboard.editParameters')">
        <dl v-if="parameters.length" class="parameters">
          <template v-for="[key, value] in parameters" :key="key">
            <dt>{{ key }}</dt>
            <dd>{{ formatValue(value) }}</dd>
          </template>
        </dl>
        <span v-else>{{ t("dashboard.noParameters") }}</span>
      </el-descriptions-item>
    </el-descriptions>
    <template #footer>
      <el-button @click="visible = false">{{ t("common.close") }}</el-button>
      <el-button type="primary" @click="openMetric">{{ t("dashboard.openMetric") }}</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.parameters {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 12px;
  margin: 0;
}
.parameters dt {
  color: var(--el-text-color-secondary);
}
.parameters dd {
  margin: 0;
  word-break: break-word;
}
</style>
