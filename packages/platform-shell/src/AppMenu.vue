<script setup lang="ts">
import { computed } from "vue";
import AppPanelPages from "./AppPanelPages.vue";
import type { AppMenuGroup, AppMenuIcon, AppMenuItem, PlatformPanelGroup, PlatformPanelPage } from "./types";

/**
 * Reusable application navigation menu column used both by the platform shell layout and by application frame panels.
 * Draws the application heading, a responsive compact selector on narrow screens, grouped navigation rows with icons,
 * optional trailing content, strictly single-item active highlight, and an optional pinned footer entry.
 */
const props = withDefaults(
  defineProps<{
    /** Application heading displayed at the top of the menu column. */
    title?: string;
    /** Grouped navigation items in display order. */
    groups?: readonly AppMenuGroup[];
    /** Optional map of `item.id -> trailing text` appended after the option label in the compact mobile selector. */
    itemTrailingText?: Readonly<Record<string, string | null | undefined>>;
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
    itemTrailingText: undefined,
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

defineSlots<{
  /** Optional trailing content rendered at the end of each navigation row. */
  "item-trailing"?: (props: { item: AppMenuItem }) => unknown;
}>();

function optionLabel(page: PlatformPanelPage): string {
  const trailing = props.itemTrailingText?.[page.id]?.trim();
  return trailing ? `${page.label} ${trailing}` : page.label;
}

function toPanelPage(item: AppMenuItem): PlatformPanelPage {
  const icon = props.icons && Object.hasOwn(props.icons, item.id) ? props.icons[item.id] : item.icon;
  return {
    id: item.id,
    label: item.label,
    ...(icon !== undefined ? { icon } : {}),
    ...(item.unavailableHint ? { unavailableHint: item.unavailableHint } : {}),
  };
}

function toMenuItem(page: PlatformPanelPage): AppMenuItem {
  return {
    id: page.id,
    label: page.label,
    ...(page.icon !== undefined ? { icon: page.icon } : {}),
    ...(page.unavailableHint ? { unavailableHint: page.unavailableHint } : {}),
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

/**
 * Resolves the highlighted menu entry: prefers an exact id match, and otherwise falls back to the longest ancestor
 * path prefix so a hidden child entry (e.g. `/ontology/relations/detail`) keeps its parent menu item highlighted.
 */
const matchedActiveId = computed<string | null>(() => {
  const active = props.activeId;
  if (!active) return null;
  const ids: string[] = [];
  for (const group of panelGroups.value) {
    for (const page of group.pages) ids.push(page.id);
  }
  if (panelFoot.value) ids.push(panelFoot.value.id);
  if (ids.includes(active)) return active;
  if (!active.startsWith("/")) return active;
  let best: string | null = null;
  for (const id of ids) {
    if (id.length > 1 && id.startsWith("/") && active.startsWith(`${id}/`) && (!best || id.length > best.length)) {
      best = id;
    }
  }
  return best ?? active;
});
</script>

<template>
  <aside class="platform-app-menu" :aria-label="ariaLabel">
    <h2 v-if="title" class="app-menu-title">{{ title }}</h2>
    <select
      class="mobile-page-select"
      :aria-label="ariaLabel"
      :value="matchedActiveId ?? ''"
      @change="emit('select', ($event.target as HTMLSelectElement).value)"
    >
      <optgroup v-for="group in panelGroups" :key="group.key" :label="group.label || title || ariaLabel">
        <option v-for="page in group.pages" :key="page.id" :value="page.id" :disabled="!!page.unavailableHint">
          {{ optionLabel(page) }}
        </option>
      </optgroup>
      <option v-if="panelFoot" :value="panelFoot.id" :disabled="!!panelFoot.unavailableHint">
        {{ optionLabel(panelFoot) }}
      </option>
    </select>
    <AppPanelPages
      class="app-menu-pages"
      :groups="panelGroups"
      :foot="panelFoot"
      :active-page-id="matchedActiveId"
      @select-page="emit('select', $event)"
    >
      <template v-if="$slots['item-trailing']" #item-trailing="slotProps">
        <slot name="item-trailing" :item="toMenuItem(slotProps.item)" />
      </template>
    </AppPanelPages>
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
@container (max-width: 760px) {
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
@media (max-width: 760px) {
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
