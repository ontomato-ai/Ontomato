<template>
  <div class="ai-chart-data-overlay" :data-open="open ? '1' : '0'" @click.stop>
    <div class="ai-chart-data-inner">
      <TablePreview :table="table" height="100%" :empty-text="t('dashboard.noDataToDisplay')" />
      <div class="ai-chart-dsl-row">
        <el-button size="small" @click.stop="emit('view-dsl')">{{ sourceLabel }}</el-button>
        <span class="ai-chart-row-count">{{ rowCount }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { TablePreview } from "@ontomato/foundation-ui/preview";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const emit = defineEmits(["view-dsl"]);

const props = defineProps({
  open: { type: Boolean, default: false },
  /** The card's data as the table shows it. */
  table: { type: Object, required: true },
  /** How many rows this refresh returned; the table may show only the first of them. */
  total: { type: Number, required: true },
  /** The label of the button that shows where the card's data comes from. */
  sourceLabel: { type: String, required: true },
});

/**
 * The table scrolls inside the card, so its first rows alone can look like the whole result: the count says how many
 * there are, and how many the table shows when it shows only the first.
 */
const rowCount = computed(() =>
  props.table.rows.length < props.total
    ? t("dashboard.rowsShown", { n: props.total, shown: props.table.rows.length })
    : t("dashboard.rows", { n: props.total }, props.total)
);
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  height: 25px;
}

.ai-chart-row-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
</style>
