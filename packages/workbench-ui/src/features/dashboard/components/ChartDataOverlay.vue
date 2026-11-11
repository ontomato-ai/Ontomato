<template>
  <div class="ai-chart-data-overlay" :data-open="open ? '1' : '0'" @click.stop>
    <div class="ai-chart-data-inner">
      <TablePreview :table="table" height="100%" :empty-text="t('dashboard.noDataToDisplay')" />
      <div class="ai-chart-dsl-row">
        <el-button size="small" @click.stop="emit('view-dsl')">{{ sourceLabel }}</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { TablePreview } from "@ontomato/foundation-ui/preview";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const emit = defineEmits(["view-dsl"]);

defineProps({
  open: { type: Boolean, default: false },
  /** The card's data as the table shows it. */
  table: { type: Object, required: true },
  /** The label of the button that shows where the card's data comes from. */
  sourceLabel: { type: String, required: true },
});
</script>

<style scoped>
.ai-chart-data-overlay {
  position: absolute;
  inset: 0;
  z-index: 9;
  display: none;
  background: var(--el-bg-color);
  overflow: auto;
  padding: 0;
  box-sizing: border-box;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  contain: paint;
}

.ai-chart-data-overlay[data-open="1"] {
  display: block;
}

.ai-chart-data-inner {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  padding: 0 10px 10px;
  box-sizing: border-box;
}

.ai-chart-dsl-row {
  height: 25px;
}
</style>
