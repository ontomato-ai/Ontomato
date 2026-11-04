<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { usePlatformHost } from "../context";
import { platformPages, systemSettingsTabs } from "../pages";
import PageTabs from "../layout/PageTabs.vue";
import GeneralSettingsTab from "../config/components/GeneralSettingsTab.vue";
import DataAdapterSettingsTab from "../config/components/DataAdapterSettingsTab.vue";

/*
 * The system settings of the ontology service: the general parameters (with the backend language), the data adapter,
 * and — in editions that license it — the licence. Each tab is a screen of its own under the permission code the old
 * page had; the tabs this edition has no screen for (the licence in open source) are not listed.
 */
const { t } = useI18n();
const host = usePlatformHost();
const page = computed(() => host.navigation.value.pages.find((p) => p.path === platformPages.systemSettings.path));
const title = computed(() => page.value?.title ?? t(platformPages.systemSettings.titleKey));
</script>

<template>
  <div class="system-settings platform-page">
    <header v-if="page && !page.ownHeader" class="page-header">
      <h1 class="page-title">{{ title }}</h1>
      <p v-if="page.descriptionKey" class="page-description">{{ t(page.descriptionKey) }}</p>
    </header>

    <PageTabs v-if="page" :page="page">
      <template #default="{ tab }">
        <GeneralSettingsTab v-if="tab?.path === systemSettingsTabs.general.path" />
        <DataAdapterSettingsTab v-else-if="tab?.path === systemSettingsTabs.dataAdapters.path" />
      </template>
    </PageTabs>
  </div>
</template>

<style scoped>
.system-settings {
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

@media (max-width: 768px) {
  .page-description {
    display: none;
  }
}
</style>
