<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { PlatformTabs } from "@ontomato/platform-shell";
import { DashboardPanel } from "@ontomato/workbench-ui/features/dashboard";
import type { DashboardListItem } from "@ontomato/contracts/dashboard";

/**
 * The reader's chosen dashboards, one tab each. Only the open tab's dashboard is mounted: switching tabs unmounts it
 * and mounts the next one, which reads its current data afresh, so the home never loads every dashboard at once.
 * The dashboard is the dashboards application's own panel, with everything it can do there.
 */
const props = defineProps<{ dashboards: readonly DashboardListItem[] }>();
const { t } = useI18n();

const activeId = ref<string | null>(null);
// The open tab stays while it is still shown; otherwise the first one opens.
watch(
  () => props.dashboards,
  (dashboards) => {
    if (!dashboards.some((dashboard) => dashboard.id === activeId.value)) activeId.value = dashboards[0]?.id ?? null;
  },
  { immediate: true },
);
const tabs = computed(() => props.dashboards.map((dashboard) => ({ id: dashboard.id, label: dashboard.name })));
</script>

<template>
  <div class="home-dashboards">
    <PlatformTabs :tabs="tabs" :active-id="activeId ?? undefined" :label="t('home.dashboards')" @select="activeId = $event" />
    <div class="home-dashboard-panel">
      <DashboardPanel v-if="activeId" :key="activeId" :dashboard-id="activeId" />
    </div>
  </div>
</template>

<style scoped>
.home-dashboards {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}
/*
 * The panel normally fills the dashboards application and scrolls inside itself. On the home it takes the height of its
 * content, so the page scrolls as one and the square below stays reachable.
 */
.home-dashboard-panel :deep(.dash-root) {
  flex: none;
  height: auto;
  min-height: 240px;
  overflow: visible;
  background: transparent;
}
</style>
