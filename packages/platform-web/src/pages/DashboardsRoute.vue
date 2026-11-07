<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { DashboardHome, useDashboardStore } from "@ontomato/workbench-ui/features/dashboard";
import AppPage from "./AppPage.vue";

/**
 * The dashboards application: the boards conversations add their charts and datasets to.
 *
 * One page, the whole of the application's area, under the platform's one page header (DESIGN.md "Admin page anatomy");
 * the boards are tabs of the page itself, and the address carries the open board as `?dashboardId=`, so a board can be
 * linked and reloaded.
 */
const { t } = useI18n();
const store = useDashboardStore();

// The address names the board; without one the first board opens, as the page always did.
const opened = store
  .loadDashboards({ notifyError: true })
  .then(() => {
    if (!store.currentDashboardId && store.dashboardItems[0]) void store.selectDashboard(store.dashboardItems[0].id);
  })
  .catch(() => {});
void opened;
</script>

<template>
  <AppPage
    :title="t('assistant.featureDashboards')"
    :labels="{ save: t('common.save'), discard: t('common.cancel'), unsavedChanges: t('admin.unsavedChanges') }"
  >
    <DashboardHome />
  </AppPage>
</template>
