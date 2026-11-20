<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useMemberData } from "../panel/member";
import { APPLICATION_PANEL_USE, applicationMenuSections, type ApplicationMenu } from "./app-menu";

/**
 * The menu of an application whose pages are its entries, drawn in the application's frame (design §3).
 *
 * It draws the one menu the platform has — the entry Java resolved, with the groups the application declares — from its
 * `menu` datum. Clicking an entry says only which entry the reader picked, as a reference to it; the panel's own
 * `open` event turns that into opening it, so the panel's declaration says where its menu leads and where a jump is
 * admitted. The component itself navigates nothing.
 */
defineProps<{
  /** The entry shown now, by the identity the menu carries; absent marks none. */
  active?: string | null;
}>();

const emit = defineEmits<{
  /** The entry the reader picked: what the panel's `open` event names an entry by. */
  activated: [{ className: string; primaryKey: string }];
}>();

const { t, locale } = useI18n();
const menu = useMemberData("menu");

const result = computed<DataStateResult<ApplicationMenu>>(() => menu.value as DataStateResult<ApplicationMenu>);
const sections = computed(() =>
  result.value.status === "ready" ? applicationMenuSections(result.value.value as unknown as ApplicationMenu, locale.value) : [],
);
const labels = computed(() => ({
  empty: t("platform.dataEmpty"),
  forbidden: t("platform.dataForbidden"),
  awaiting: t("platform.dataAwaiting"),
}));

function activate(id: string) {
  emit("activated", { className: APPLICATION_PANEL_USE, primaryKey: id });
}
</script>

<template>
  <nav class="sdk-app-menu" :aria-label="t('platform.pages')">
    <data-state :result="result" :labels="labels">
      <template #default>
        <section v-for="section in sections" :key="section.key ?? ''" class="app-menu-group">
          <p v-if="section.label" class="app-menu-heading">{{ section.label }}</p>
          <button
            v-for="entry in section.entries"
            :key="entry.id"
            type="button"
            class="app-menu-entry"
            :class="{ active: entry.id === active }"
            :aria-current="entry.id === active ? 'page' : undefined"
            @click="activate(entry.id)"
          >
            {{ entry.label }}
          </button>
        </section>
      </template>
    </data-state>
  </nav>
</template>

<style scoped>
.sdk-app-menu {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 8px;
}
.app-menu-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.app-menu-heading {
  margin: 0;
  padding: 8px 8px 4px;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-secondary);
}
.app-menu-entry {
  display: flex;
  min-height: var(--nav-row-height);
  width: 100%;
  align-items: center;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.app-menu-entry:hover {
  background: var(--shell-panel-hover);
  color: var(--el-text-color-primary);
}
.app-menu-entry.active {
  background: var(--shell-panel-selected);
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.app-menu-entry:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
</style>
