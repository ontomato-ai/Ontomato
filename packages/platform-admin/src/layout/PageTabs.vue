<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { availableTabs, type PlatformPage, type PlatformPageTab } from "../navigation";
import { usePlatformHost } from "../context";
import { PlatformTabs } from "@ontomato/platform-shell";

/*
 * The tabs of a page that holds several screens: text tabs with the primary underline (DESIGN.md admin page anatomy),
 * one per screen the account may open. The address names the tab (`/admin/system-config/general`), so a tab can be
 * linked, bookmarked and reloaded; the page's own address lands on the first tab the account may see.
 */
const props = defineProps<{ page: PlatformPage }>();
const host = usePlatformHost();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const tabs = computed(() => availableTabs(props.page, host.access));
const active = computed(
  () => tabs.value.find((tab) => tab.path === route.path) ?? tabs.value[0] ?? null
);
// A screen an edition supplies (the licence page) replaces the tab's own content.
const supplied = computed(() => (active.value ? host.tabPanels?.[active.value.path] ?? null : null));

function select(tab: PlatformPageTab) {
  if (tab.path !== route.path) void router.push(tab.path);
}
</script>

<template>
  <div class="page-tabs">
    <PlatformTabs
      :tabs="tabs.map(tab => ({ id: tab.path, label: t(tab.titleKey) }))"
      :active-id="active?.path"
      :label="t(props.page.titleKey)"
      @select="id => { const tab = tabs.find(tab => tab.path === id); if (tab) select(tab); }"
    />
    <div class="page-tabs-body">
      <component :is="supplied" v-if="supplied" />
      <slot v-else :tab="active" />
    </div>
  </div>
</template>

<style scoped>
.page-tabs {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.page-tabs-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: auto;
  min-width: 0;
}
</style>
