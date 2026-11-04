<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { usePlatformHost } from "../context";
import { platformPages, runRecordsTabs } from "../pages";
import PageTabs from "../layout/PageTabs.vue";
import AuditLogPage from "./AuditLogPage.vue";
import SystemMonitorPage from "./SystemMonitorPage.vue";

/*
 * Run records of the domain: what changed (the audit log) and how the data engine is doing (system monitoring). The two
 * screens used to be pages of their own; each keeps the permission code its page had.
 */
const { t } = useI18n();
const host = usePlatformHost();
const page = computed(() => host.navigation.value.pages.find((p) => p.path === platformPages.runRecords.path));
const title = computed(() => page.value?.title ?? t(platformPages.runRecords.titleKey));
</script>

<template>
  <div class="run-records platform-page">
    <header v-if="page && !page.ownHeader" class="page-header">
      <h1 class="page-title">{{ title }}</h1>
      <p v-if="page.descriptionKey" class="page-description">{{ t(page.descriptionKey) }}</p>
    </header>

    <PageTabs v-if="page" :page="page">
      <template #default="{ tab }">
        <div class="records-tab">
          <AuditLogPage v-if="tab?.path === runRecordsTabs.auditLog.path" />
          <SystemMonitorPage v-else-if="tab?.path === runRecordsTabs.systemMonitor.path" />
        </div>
      </template>
    </PageTabs>
  </div>
</template>

<style scoped>
.run-records {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  background: var(--el-bg-color);
}

.page-header {
  display: flex;
  height: var(--page-header-height);
  flex: 0 0 var(--page-header-height);
  align-items: center;
  gap: var(--spacing-md);
  padding: 0 var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color);
}

.page-title {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  line-height: var(--leading-lg);
  white-space: nowrap;
}

.page-description {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.records-tab {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg);
}

@media (max-width: 768px) {
  .page-description {
    display: none;
  }
}
</style>
