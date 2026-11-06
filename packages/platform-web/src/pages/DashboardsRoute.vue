<script setup lang="ts">
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { DashboardHome, useDashboardStore } from "@ontomato/workbench-ui/features/dashboard";

/**
 * The dashboards application: the boards conversations add their charts and datasets to.
 *
 * It is one page, the whole of the application's area, with its own header and tabs (DESIGN.md "Applications and
 * shells"); the address carries the open board as `?dashboardId=`, so a board can be linked and reloaded.
 */
const { t } = useI18n();
const store = useDashboardStore();

onMounted(async () => {
  await store.loadDashboards({ notifyError: true });
  // The address names the board; without one the first board opens, as the page always did.
  if (!store.currentDashboardId && store.dashboardItems[0]) void store.selectDashboard(store.dashboardItems[0].id);
});
</script>

<template>
  <div class="dashboards-application">
    <header class="application-head">
      <div class="head-text">
        <h1 class="head-title">{{ t("assistant.featureDashboards") }}</h1>
        <p class="head-description">{{ t("analysis.dashboardsIntro") }}</p>
      </div>
    </header>
    <DashboardHome />
  </div>
</template>

<style scoped>
/*
 * A page application: its title and one line of description at the top, then the page, with no gutter of its own — the
 * application fills the surface the platform gives it (DESIGN.md "Applications and shells").
 */
.dashboards-application {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}
.application-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding: 24px 28px 14px;
  flex-shrink: 0;
}
.head-title {
  margin: 0 0 2px;
  font-size: var(--text-xl);
  line-height: var(--leading-xl);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}
.head-description {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
}
</style>
