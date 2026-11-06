<script setup lang="ts">
import { computed, onMounted } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { usePageActions, usePlatformHost } from "../context";
import { platformPages, systemSettingsTabs } from "../pages";
import PageTabs from "../layout/PageTabs.vue";
import GeneralSettingsTab from "../config/components/GeneralSettingsTab.vue";
import DataAdapterSettingsTab from "../config/components/DataAdapterSettingsTab.vue";
import { useGeneralSettings } from "../config/general-settings";

/*
 * The system settings of the ontology service: the general parameters (with the backend language), the data adapter,
 * and — in editions that license it — the licence. Each tab is a screen of its own under the permission code the old
 * page had; the tabs this edition has no screen for (the licence in open source) are not listed.
 *
 * The general screen keeps one draft with one Save in the layout's page header; the data adapter and the licence save
 * themselves as they always did (one request per action, their own buttons).
 */
const { t } = useI18n();
const host = usePlatformHost();
const route = useRoute();
const page = computed(() => host.navigation.value.pages.find((p) => p.path === platformPages.systemSettings.path));
const general = useGeneralSettings({ api: host.api, businessConfig: host.systemConfig, detail: host.separators.detail });
const onGeneralTab = computed(() => route.path === systemSettingsTabs.general.path);

usePageActions(() =>
  onGeneralTab.value
    ? { get dirty() { return general.dirty.value; }, get saving() { return general.saving.value; }, save: () => void general.save(), discard }
    : null
);

async function discard() {
  const confirmed = await ElMessageBox.confirm(t("admin.discardChangesConfirm"), t("admin.discardChanges"), {
    type: "warning",
    confirmButtonText: t("admin.discardChanges"),
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false
  );
  if (confirmed) await general.load();
}

// Changes made on the general screen are unsaved when the page is left, whichever tab the account leaves from.
onBeforeRouteLeave(async () => {
  if (!general.dirty.value) return true;
  return ElMessageBox.confirm(t("admin.leaveUnsavedConfirm"), t("admin.unsavedChanges"), {
    type: "warning",
    confirmButtonText: t("admin.leaveWithoutSaving"),
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false
  );
});

onMounted(general.load);
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
/*
 * The page paints no background of its own: it sits on the application's area, the darkest band in dark mode
 * (DESIGN.md "Colour roles"), so it never floats as a card inside the page gutter; its tables, inputs and cards keep
 * their own surfaces.
 */
.system-settings {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}
</style>
