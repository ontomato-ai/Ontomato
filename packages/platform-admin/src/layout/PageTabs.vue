<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { availableTabs, type PlatformPage, type PlatformPageTab } from "../navigation";
import { usePlatformHost } from "../context";

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
    <div class="page-tabs-bar" role="tablist" :aria-label="t(props.page.titleKey)">
      <button
        v-for="tab in tabs"
        :key="tab.path"
        type="button"
        role="tab"
        :class="['page-tab', { active: tab.path === active?.path }]"
        :aria-selected="tab.path === active?.path"
        @click="select(tab)"
      >
        {{ t(tab.titleKey) }}
      </button>
    </div>
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

.page-tabs-bar {
  display: flex;
  flex: 0 0 auto;
  gap: var(--spacing-lg);
  padding: 0 var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color);
}

.page-tab {
  height: 40px;
  padding: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.page-tab:hover {
  color: var(--el-text-color-primary);
}

.page-tab:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}

.page-tab.active {
  border-bottom-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-weight: var(--font-medium);
}

.page-tabs-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: auto;
}
</style>
