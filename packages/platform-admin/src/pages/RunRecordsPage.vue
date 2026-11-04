<script setup lang="ts">
import { computed } from "vue";
import { usePlatformHost } from "../context";
import { platformPages, runRecordsTabs } from "../pages";
import PageTabs from "../layout/PageTabs.vue";
import AuditLogPage from "./AuditLogPage.vue";
import SystemMonitorPage from "./SystemMonitorPage.vue";

/*
 * Run records of the domain: what changed (the audit log) and how the data engine is doing (system monitoring). The two
 * screens used to be pages of their own; each keeps the permission code its page had. The 48px page header is the
 * layout's, so the tabs follow it directly.
 */
const host = usePlatformHost();
const page = computed(() => host.navigation.value.pages.find((p) => p.path === platformPages.runRecords.path));
</script>

<template>
  <div class="run-records platform-page">
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

.records-tab {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg);
}
</style>
