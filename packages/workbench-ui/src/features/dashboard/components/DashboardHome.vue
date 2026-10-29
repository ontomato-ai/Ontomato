<script setup lang="ts">
import { onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { MoreHorizontal, Plus } from "lucide-vue-next";
import { useDashboardStore } from "../stores/dashboard";
import DashboardPanel from "./DashboardPanel.vue";

/** The dashboard feature page of the workbench shell: dashboard tabs above the selected board. */
const { t } = useI18n();
const store = useDashboardStore();
const { dashboardItems, loadingDashboards, currentDashboardId, editingDashboardId, editingDashboardName } =
  storeToRefs(store);

onMounted(async () => {
  await store.loadDashboards({ notifyError: true });
  if (!currentDashboardId.value && dashboardItems.value[0])
    void store.selectDashboard(dashboardItems.value[0].id);
});
</script>

<template>
  <div class="dashboard-home">
    <header class="home-bar">
      <h2 class="home-title">{{ t("analysis.myDashboards") }}</h2>
      <div v-loading="loadingDashboards" class="tabs" role="tablist">
        <div
          v-for="item in dashboardItems"
          :key="item.id"
          class="tab"
          :class="{ active: item.id === currentDashboardId }"
        >
          <el-input
            v-if="editingDashboardId === item.id"
            v-model="editingDashboardName"
            size="small"
            class="rename"
            @keydown.enter.stop.prevent="store.saveDashboardRename(item)"
            @keydown.esc.stop.prevent="store.cancelDashboardRename()"
            @blur="store.saveDashboardRename(item)"
          />
          <template v-else>
            <button
              type="button"
              role="tab"
              class="tab-open"
              :aria-selected="item.id === currentDashboardId"
              @click="store.openDashboard(item.id)"
            >
              {{ item.name }}
            </button>
            <el-dropdown trigger="click" @command="(command: string) => store.handleDashboardCommand(command, item)">
              <button type="button" class="tab-more" :aria-label="t('common.more')">
                <MoreHorizontal :size="14" />
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">{{ t("common.rename") }}</el-dropdown-item>
                  <el-dropdown-item command="delete">{{ t("common.delete") }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </div>
      </div>
      <el-button class="create" @click="store.promptCreateDashboard()">
        <Plus :size="15" />
        <span>{{ t("analysis.createDashboard") }}</span>
      </el-button>
    </header>
    <div class="home-body">
      <DashboardPanel v-if="currentDashboardId" :key="currentDashboardId" :dashboard-id="currentDashboardId" />
      <el-empty v-else-if="!loadingDashboards" :description="t('analysis.noDashboards')" />
    </div>
  </div>
</template>

<style scoped>
.dashboard-home {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.home-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.home-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  white-space: nowrap;
  color: var(--el-text-color-primary);
}
.tabs {
  display: flex;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.tab {
  display: flex;
  align-items: center;
  border-radius: 10px;
  flex-shrink: 0;
}
.tab:hover {
  background: var(--el-fill-color);
}
.tab.active {
  background: var(--el-fill-color-dark);
}
.tab-open {
  height: 32px;
  padding: 0 4px 0 12px;
  border: 0;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.tab.active .tab-open {
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.tab-more {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-right: 3px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--el-text-color-tertiary);
  cursor: pointer;
}
.tab-more:hover {
  color: var(--el-text-color-primary);
}
.rename {
  width: 160px;
}
.create :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.home-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
