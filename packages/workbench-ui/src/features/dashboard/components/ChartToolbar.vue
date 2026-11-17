<template>
  <div class="ai-chart-toolbar" :data-open="toolbarOpen ? '1' : '0'">
    <button
      class="ai-chart-tool-btn"
      type="button"
      :title="t('dashboard.zoomIn')"
      @click.stop.prevent="emit('openZoom')"
    >
      <Expand class="tool-icon" :size="16" />
    </button>

    <button
      class="ai-chart-tool-btn"
      type="button"
      :title="dataOpen ? t('dashboard.showChart') : t('dashboard.showData')"
      @click.stop.prevent="emit('toggleData')"
    >
      <BarChart3 v-if="dataOpen" class="tool-icon" :size="16" />
      <TableProperties v-else class="tool-icon" :size="16" />
    </button>

    <button
      class="ai-chart-tool-btn"
      type="button"
      :title="t('dashboard.editParameters')"
      @click.stop.prevent="emit('edit-parameters')"
    >
      <Filter class="tool-icon" :size="16" />
    </button>

    <DropdownMenu
      as="button"
      :title="t('common.more')"
      scene="chart"
      trigger-class="ai-chart-tool-btn"
      icon-color="currentColor"
      @command="(cmd) => emit('command', cmd)"
      @visible-change="handleVisibleChange"
    />
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { BarChart3, Filter, Expand, TableProperties } from "lucide-vue-next";
import DropdownMenu from "./DropdownMenu.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps({
  dataOpen: { type: Boolean, default: false },
});

const emit = defineEmits(["openZoom", "toggleData", "command", "edit-parameters"]);

const menuOpen = ref(false);
const toolbarOpen = computed(() => menuOpen.value);

function handleVisibleChange(v) {
  menuOpen.value = Boolean(v);
}
</script>
<style scoped>
.ai-chart-tool-btn {
  color: var(--el-text-color-regular);
  transition: color var(--transition-base);
}

.ai-chart-tool-btn:hover {
  color: var(--el-text-color-primary);
}

.tool-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: currentColor;
}
</style>
