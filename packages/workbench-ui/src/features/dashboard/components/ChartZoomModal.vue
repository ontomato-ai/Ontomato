<template>
  <teleport to="body">
    <div v-if="open" class="ai-dashboard-chart-zoom-modal" data-open="1" @click="handleMaskClick">
      <div class="ai-zoom-card" role="dialog" aria-modal="true">
        <div class="ai-zoom-header">
          <div class="ai-zoom-title">{{ title }}</div>
          <button
            class="ai-zoom-close"
            type="button"
            aria-:label="t('common.close')"
            @click="emit('close')"
          >
            ×
          </button>
        </div>
        <div class="ai-zoom-body">
          <EChart
            v-if="mode === 'chart' && option"
            class="ai-zoom-chart"
            :option="modalOption"
            :theme="theme"
            height="100%"
          />
          <div v-show="mode === 'table'" class="ai-zoom-table" @click.stop>
            <ChartDataTable :tabular="tabular" :max-rows="maxRows" />
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import { EChart } from "@ontomato/foundation-ui/chart";
import ChartDataTable from "./ChartDataTable.vue";
import { nativeEchartsTheme } from "./utils/echartsTheme";
import { chartBrandColors } from "@ontomato/contracts/chart-presentation";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";
import { useTheme } from "../../../composables/useTheme";

useI18n();

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: "chart" },
  title: { type: String, default: "" },
  option: { type: Object, default: null },
  tabular: { type: Object, default: null },
  maxRows: { type: Number, default: 500 },
});

const emit = defineEmits(["close"]);

const { isDark } = useTheme();
const { zoomChartTheme } = workbenchContent().dashboard;
const dashboardTheme = computed(() => nativeEchartsTheme(isDark.value));
const theme = computed(() => (zoomChartTheme === "dashboard" ? dashboardTheme.value : undefined));
/**
 * The card's chart on the dialog's background, without the title the dialog header shows; brand colours come from
 * the dashboard theme in either zoom theme.
 */
const modalOption = computed(() =>
  chartBrandColors({ ...props.option, backgroundColor: "transparent", title: undefined }, dashboardTheme.value)
);

function handleMaskClick(e) {
  if (e.target?.classList?.contains("ai-dashboard-chart-zoom-modal")) emit("close");
}

let keydownHandler = null;
watch(
  () => props.open,
  (open) => {
    if (open) {
      keydownHandler = (e) => {
        if (e.key === "Escape") emit("close");
      };
      window.addEventListener("keydown", keydownHandler);
      return;
    }
    if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  }
);

onBeforeUnmount(() => {
  if (keydownHandler) window.removeEventListener("keydown", keydownHandler);
  keydownHandler = null;
});
</script>

<style scoped>
.ai-dashboard-chart-zoom-modal {
  position: fixed;
  inset: 0;
  z-index: 999999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.ai-zoom-card {
  width: min(1100px, 92vw);
  height: min(720px, 92vh);
  background: var(--el-bg-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--elevation-modal);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-zoom-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
}

.ai-zoom-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-zoom-close {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: var(--el-fill-color);
  cursor: pointer;
  color: var(--el-text-color-secondary);
  font-size: 16px;
  line-height: 28px;
}

.ai-zoom-close:hover {
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-primary);
}

.ai-zoom-body {
  position: relative;
  flex: 1 1 auto;
}

.ai-zoom-chart {
  position: absolute;
  inset: 0;
}

.ai-zoom-table {
  position: absolute;
  inset: 0;
  overflow: auto;
  padding: 0 10px 10px;
  box-sizing: border-box;
  background: var(--el-bg-color);
}
</style>
