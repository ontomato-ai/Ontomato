<script setup lang="ts">
import { computed } from "vue";
import AppPanelPages from "./AppPanelPages.vue";
import type { AppMenuGroup, AppMenuIcon, AppMenuItem, PlatformPanelGroup, PlatformPanelPage } from "./types";

/**
 * Reusable application navigation menu column used both by the platform shell layout and by application frame panels.
 * Draws the application heading, a responsive compact selector on narrow screens, grouped navigation rows with icons,
 * optional directory counts, strictly single-item active highlight, and an optional pinned footer entry.
 */
const props = withDefaults(
  defineProps<{
    /** Application heading displayed at the top of the menu column. */
    title?: string;
    /** Grouped navigation items in display order. */
    groups?: readonly AppMenuGroup[];
    /** Optional map of `item.id -> count` overlaid onto matching items; finite numbers override item counts. */
    counts?: Readonly<Record<string, number | null | undefined>>;
    /** Optional map of `item.id -> icon` overlaid onto matching items (falls back to `item.icon`). */
    icons?: Readonly<Record<string, AppMenuIcon>>;
    /** Optional single footer entry rendered under a hairline at the bottom of the column. */
    foot?: AppMenuItem | null;
    /** Identifier of the currently active entry; at most one entry is highlighted as active. */
    activeId?: string | null;
    /** Accessible landmark label for the navigation sidebar and compact selector. */
    ariaLabel?: string;
  }>(),
  {
    title: "",
    groups: () => [],
    counts: undefined,
    icons: undefined,
    foot: null,
    activeId: null,
    ariaLabel: "Pages",
  },
);

const emit = defineEmits<{
  /** Fired when the reader chooses a navigation entry from either the column list or mobile selector. */
  select: [id: string];
}>();

function resolveCount(item: AppMenuItem): number | null {
  if (props.counts && Object.hasOwn(props.counts, item.id)) {
    const mapped = props.counts[item.id];
    if (typeof mapped === "number" && Number.isFinite(mapped)) return mapped;
  }
  return typeof item.count === "number" && Number.isFinite(item.count) ? item.count : null;
}

function toPanelPage(item: AppMenuItem): PlatformPanelPage {
  const icon = props.icons && Object.hasOwn(props.icons, item.id) ? props.icons[item.id] : item.icon;
  return {
    id: item.id,
    label: item.label,
    ...(icon !== undefined ? { icon } : {}),
    count: resolveCount(item),
    ...(item.unavailableHint ? { unavailableHint: item.unavailableHint } : {}),
  };
}

const panelGroups = computed<readonly PlatformPanelGroup[]>(() =>
  props.groups
    .map((group): PlatformPanelGroup => ({
      key: group.key,
      ...(group.label ? { label: group.label } : {}),
      pages: group.items.map(toPanelPage),
    }))
    .filter((group) => group.pages.length > 0),
);

const panelFoot = computed<PlatformPanelPage | null>(() => (props.foot ? toPanelPage(props.foot) : null));
</script>

<template>
  <aside class="platform-app-menu" :aria-label="ariaLabel">
    <h2 v-if="title" class="app-menu-title">{{ title }}</h2>
    <select
      class="mobile-page-select"
      :aria-label="ariaLabel"
      :value="activeId ?? ''"
      @change="emit('select', ($event.target as HTMLSelectElement).value)"
    >
      <optgroup v-for="group in panelGroups" :key="group.key" :label="group.label || title || ariaLabel">
        <option v-for="page in group.pages" :key="page.id" :value="page.id" :disabled="!!page.unavailableHint">
          {{ page.label }}
        </option>
      </optgroup>
      <option v-if="panelFoot" :value="panelFoot.id">{{ panelFoot.label }}</option>
    </select>
    <AppPanelPages
      class="app-menu-pages"
      :groups="panelGroups"
      :foot="panelFoot"
      :active-page-id="activeId ?? null"
      @select-page="emit('select', $event)"
    />
  </aside>
</template>

<style scoped>
.platform-app-menu {
  display: flex;
  flex-direction: column;
  flex: 0 0 var(--shell-app-column);
  width: var(--shell-app-column);
  box-sizing: border-box;
  padding: 14px 10px 12px;
  background: var(--shell-panel-bg);
  border-right: 1px solid var(--el-border-color);
  overflow: hidden;
  min-height: 0;
}
.platform-app-menu > .app-menu-pages {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
}
.app-menu-title {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  min-height: 36px;
  margin: 0;
  padding: 0 10px;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  line-height: var(--leading-lg);
}
.mobile-page-select {
  display: none;
}
@media (max-width: 600px) {
  .platform-app-menu {
    flex: 0 0 auto;
    width: 100%;
    padding: var(--spacing-sm) var(--page-gutter);
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color);
    flex-direction: row;
    align-items: center;
    gap: var(--spacing-md);
  }
  .app-menu-title {
    min-height: 28px;
    font-size: var(--text-sm);
    padding: 0;
    white-space: nowrap;
  }
  .platform-app-menu > .app-menu-pages {
    display: none;
  }
  .mobile-page-select {
    display: block;
    flex: 1;
    min-width: 0;
    max-width: 100%;
    height: var(--control-height);
    padding: var(--spacing-xs) var(--spacing-sm);
    border: 1px solid var(--el-border-color);
    border-radius: var(--radius-sm);
    background: var(--el-bg-color);
    color: var(--el-text-color-primary);
    font: inherit;
    font-size: var(--text-sm);
  }
}
</style>
