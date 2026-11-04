<script setup lang="ts">
import { computed } from "vue";
import { usePlatformHost } from "../context";
import { platformPages, systemSettingsTabs } from "../pages";
import PageTabs from "../layout/PageTabs.vue";
import GeneralSettingsTab from "../config/components/GeneralSettingsTab.vue";
import DataAdapterSettingsTab from "../config/components/DataAdapterSettingsTab.vue";

/*
 * The system settings of the ontology service: the general parameters (with the backend language), the data adapter,
 * and — in editions that license it — the licence. Each tab is a screen of its own under the permission code the old
 * page had; the tabs this edition has no screen for (the licence in open source) are not listed.
 * The 48px page header is the layout's (the page has no header of its own), so the tabs follow it directly.
 */
const host = usePlatformHost();
const page = computed(() => host.navigation.value.pages.find((p) => p.path === platformPages.systemSettings.path));
</script>

<template>
  <div class="system-settings platform-page">
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
</style>
