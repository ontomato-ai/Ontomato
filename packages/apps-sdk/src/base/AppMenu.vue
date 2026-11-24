<script setup lang="ts">
import { computed, getCurrentInstance, inject } from "vue";
import { useI18n } from "vue-i18n";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import { panelUsePath } from "@ontomato/contracts/panel-host";
import type { ApplicationEntryMenu } from "@ontomato/contracts/product-panels";
import { AppMenu as PlatformAppMenu } from "@ontomato/platform-shell";
import { panelContextKey } from "../panel/context";
import type { AppMenuGroup, AppMenuIcon, AppMenuItem } from "./app-menu-types";

/**
 * Official application navigation menu column shared by the platform shell and application frame panels.
 *
 * Inside an application frame panel, omit `groups` and `active-id` to automatically render the platform's admitted
 * application menu (`usePanelContext().entryMenu`) with the active entry highlighted and automatic navigation on click.
 * Use the `#item-trailing` slot (passing `{ item }`) to place trailing content per row, `:item-trailing-text` for
 * plain-text suffixes in the compact mobile selector, and `:icons` for curated platform icon keys.
 */
const props = withDefaults(
  defineProps<{
    /**
     * Application heading displayed at the top of the menu column. Inside an application frame, omitting
     * `title` displays the current application's name automatically. Use the menu heading as the frame title.
     */
    title?: string;
    /** Explicit navigation groups; when omitted inside a frame panel, derived automatically from the frame's menu. */
    groups?: readonly AppMenuGroup[];
    /** Optional map of `item.id -> trailing text` appended after each option label in the compact mobile selector. */
    itemTrailingText?: Readonly<Record<string, string | null | undefined>>;
    /** Optional map of `item.id -> icon` (curated platform icon key or Vue component) overlaid onto matching rows. */
    icons?: Readonly<Record<string, AppMenuIcon>>;
    /** Optional single footer entry rendered under a hairline at the bottom of the column. */
    foot?: AppMenuItem | null;
    /** Active entry identifier; defaults to `usePanelContext().currentEntry.path` when omitted inside a frame panel. */
    activeId?: string | null;
    /** Accessible landmark label for the sidebar and mobile selector; defaults to platform i18n (`platform.pages`). */
    ariaLabel?: string;
    /**
     * Automatically call `usePanelContext().navigate(id)` on row selection. Defaults to `true` when no `@select`
     * listener is attached and `false` when the caller handles `@select` explicitly.
     */
    autoNavigate?: boolean;
  }>(),
  {
    title: "",
    groups: undefined,
    itemTrailingText: undefined,
    icons: undefined,
    foot: null,
    activeId: undefined,
    ariaLabel: undefined,
    autoNavigate: undefined,
  },
);

const emit = defineEmits<{
  /** Fired when the reader chooses a navigation entry. */
  select: [id: string];
}>();

defineSlots<{
  /** Optional trailing content rendered at the end of each navigation row. */
  "item-trailing"?: (props: { item: AppMenuItem }) => unknown;
}>();

const panel = inject(panelContextKey, null);
const instance = getCurrentInstance();

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();

const currentLocale = computed(() => i18n?.locale.value ?? "en");

function translate(key: string, fallback: string): string {
  if (!i18n) return fallback;
  return i18n.te(key) ? i18n.t(key) : fallback;
}

function groupsFromEntryMenu(menu: ApplicationEntryMenu, locale: string): AppMenuGroup[] {
  const sortedGroups = [...menu.groups].sort((left, right) => left.sort - right.sort);
  const byGroup = new Map<string, AppMenuItem[]>();
  const ungrouped: AppMenuItem[] = [];

  for (const use of menu.panelUses) {
    if (!use.names) continue;
    const id = panelUsePath(use.path);
    const label = localizedApplicationText(use.names, locale) ?? use.pageKey;
    const item: AppMenuItem = { id, label, ...(use.icon ? { icon: use.icon } : {}) };
    if (use.groupKey && sortedGroups.some((group) => group.key === use.groupKey)) {
      const bucket = byGroup.get(use.groupKey) ?? [];
      bucket.push(item);
      byGroup.set(use.groupKey, bucket);
    } else {
      ungrouped.push(item);
    }
  }

  const result: AppMenuGroup[] = [];
  for (const group of sortedGroups) {
    const items = byGroup.get(group.key);
    if (!items?.length) continue;
    result.push({
      key: group.key,
      label: localizedApplicationText(group.names, locale) ?? group.key,
      items,
    });
  }
  if (ungrouped.length) {
    result.push({ key: "__ungrouped__", items: ungrouped });
  }
  return result;
}

const resolvedGroups = computed<readonly AppMenuGroup[]>(() => {
  if (props.groups !== undefined) return props.groups;
  const hostMenu = panel?.hostMenu?.value;
  if (hostMenu && hostMenu.length > 0) return hostMenu;
  const entryMenu = panel?.entryMenu.value;
  if (entryMenu) return groupsFromEntryMenu(entryMenu, currentLocale.value);
  return [];
});

const resolvedActiveId = computed<string | null>(() => {
  if (props.activeId !== undefined) return props.activeId;
  return panel?.currentEntry.value?.path ?? null;
});

const resolvedTitle = computed(() => {
  if (props.title) return props.title;
  const names = panel?.entryMenu.value?.names;
  return names ? (localizedApplicationText(names, currentLocale.value) ?? "") : "";
});

const resolvedAriaLabel = computed(() => props.ariaLabel || translate("platform.pages", "Pages"));

function handleSelect(id: string) {
  emit("select", id);
  const hasSelectListener = Boolean(instance?.vnode.props?.onSelect);
  const shouldNavigate = props.autoNavigate ?? !hasSelectListener;
  if (shouldNavigate && panel) {
    void panel.navigate(id);
  }
}
</script>

<template>
  <PlatformAppMenu
    :title="resolvedTitle"
    :groups="resolvedGroups"
    :item-trailing-text="itemTrailingText"
    :icons="icons"
    :foot="foot"
    :active-id="resolvedActiveId"
    :aria-label="resolvedAriaLabel"
    @select="handleSelect"
  >
    <template v-if="$slots['item-trailing']" #item-trailing="slotProps">
      <slot name="item-trailing" :item="slotProps.item" />
    </template>
  </PlatformAppMenu>
</template>
