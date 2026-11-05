<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ChevronsLeft, ChevronsRight } from "lucide-vue-next";
import type { PlatformAccount, PlatformApp, PlatformPreferences, PlatformShellLabels } from "./types";
import { appIcon, ExternalLink } from "./icons";
import PlatformAccountMenu from "./PlatformAccountMenu.vue";

/**
 * The platform's own rail: brand and the expand control, every application, then the account. It is the one part of
 * the shell that stays on screen across applications, so it carries no permission filtering and no per-application
 * content (DESIGN.md "Applications and shells"): the application's own navigation is the panel beside it.
 *
 * Collapsed, the rail shows icons only; the rows keep their accessible names.
 */
const props = defineProps<{
  apps: readonly PlatformApp[];
  activeAppId: string | null;
  account: PlatformAccount | null;
  preferences: PlatformPreferences;
  labels: PlatformShellLabels;
  brand?: { name: string; logo?: string };
  collapsed: boolean;
}>();

const emit = defineEmits<{
  selectApp: [id: string];
  "update:collapsed": [value: boolean];
}>();

const brandName = computed(() => props.brand?.name || props.labels.brand);

function selectApp(app: PlatformApp) {
  // External applications are never the current application; they open outside the platform.
  if (app.href || app.open || app.unavailableHint) return;
  emit("selectApp", app.id);
}

function toggle() {
  emit("update:collapsed", !props.collapsed);
}

/* ---- account menu ---- */
const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);

function onDocumentPointer(event: PointerEvent) {
  if (menuRoot.value && !menuRoot.value.contains(event.target as Node)) closeMenu();
}
function openMenu() {
  menuOpen.value = true;
  document.addEventListener("pointerdown", onDocumentPointer);
}
function closeMenu() {
  menuOpen.value = false;
  document.removeEventListener("pointerdown", onDocumentPointer);
}
const initial = computed(() => props.account?.userName.trim().charAt(0).toUpperCase() ?? "");

// The menu is part of the rail: collapsing it while open would leave it floating beside an icon rail.
watch(
  () => props.collapsed,
  (collapsed) => {
    if (collapsed) closeMenu();
  },
);

onBeforeUnmount(() => document.removeEventListener("pointerdown", onDocumentPointer));
</script>

<template>
  <nav
    class="platform-rail"
    :class="{ collapsed }"
    :aria-label="labels.applications"
  >
    <div class="rail-brand">
      <img v-if="brand?.logo" class="brand-logo" :src="brand.logo" alt="" />
      <span v-else class="brand-mark" aria-hidden="true">{{ brandName.charAt(0) }}</span>
      <span v-if="!collapsed" class="brand-name">{{ brandName }}</span>
      <button
        type="button"
        class="rail-toggle"
        :aria-label="collapsed ? labels.expandRail : labels.collapseRail"
        :title="collapsed ? labels.expandRail : labels.collapseRail"
        :aria-expanded="!collapsed"
        @click="toggle"
      >
        <ChevronsRight v-if="collapsed" :size="16" aria-hidden="true" />
        <ChevronsLeft v-else :size="16" aria-hidden="true" />
      </button>
    </div>

    <ul class="rail-apps">
      <li v-for="app in apps" :key="app.id">
        <a
          v-if="app.href"
          class="rail-row external"
          :href="app.href"
          target="_blank"
          rel="noopener noreferrer"
          :title="collapsed ? app.label : undefined"
          :aria-label="collapsed ? app.label : undefined"
        >
          <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
          <span v-if="!collapsed" class="rail-label">{{ app.label }}</span>
          <ExternalLink
            v-if="!collapsed"
            class="rail-external"
            :size="13"
            :role="labels.opensInNewTab ? 'img' : undefined"
            :aria-label="labels.opensInNewTab"
            :aria-hidden="labels.opensInNewTab ? undefined : 'true'"
          />
        </a>
        <!-- An external application whose address the host must resolve first (a signed jump). -->
        <button
          v-else-if="app.open"
          type="button"
          class="rail-row external"
          :title="collapsed ? app.label : undefined"
          :aria-label="collapsed ? app.label : undefined"
          @click="app.open()"
        >
          <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
          <span v-if="!collapsed" class="rail-label">{{ app.label }}</span>
          <ExternalLink
            v-if="!collapsed"
            class="rail-external"
            :size="13"
            :role="labels.opensInNewTab ? 'img' : undefined"
            :aria-label="labels.opensInNewTab"
            :aria-hidden="labels.opensInNewTab ? undefined : 'true'"
          />
        </button>
        <span
          v-else-if="app.unavailableHint"
          class="rail-row unavailable"
          aria-disabled="true"
          :title="app.unavailableHint"
          :aria-label="collapsed ? app.label : undefined"
        >
          <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
          <span v-if="!collapsed" class="rail-label">{{ app.label }}</span>
        </span>
        <button
          v-else
          type="button"
          class="rail-row"
          :class="{ active: app.id === activeAppId }"
          :aria-current="app.id === activeAppId ? 'page' : undefined"
          :title="collapsed ? app.label : undefined"
          :aria-label="collapsed ? app.label : undefined"
          @click="selectApp(app)"
        >
          <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
          <span v-if="!collapsed" class="rail-label">{{ app.label }}</span>
        </button>
      </li>
    </ul>

    <div v-if="account" ref="menuRoot" class="rail-account">
      <button
        type="button"
        class="account-trigger"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        :aria-label="labels.account"
        :title="collapsed ? account.userName : undefined"
        @click="menuOpen ? closeMenu() : openMenu()"
        @keydown.escape="closeMenu"
      >
        <span class="account-avatar" aria-hidden="true">{{ initial }}</span>
        <span v-if="!collapsed" class="account-name">{{ account.userName }}</span>
      </button>
      <div v-if="menuOpen" class="account-menu-anchor">
        <PlatformAccountMenu
          :account="account"
          :preferences="preferences"
          :labels="labels"
          @close="closeMenu"
        />
      </div>
    </div>
  </nav>
</template>

<style scoped>
/*
 * The rail is the darkest band in light mode and the lightest in dark mode; the order comes from the colour roles, so
 * nothing here branches on the mode. Rows are 32px with a 36px hit target for the toggle (DESIGN.md "Navigation row").
 */
.platform-rail {
  display: flex;
  flex-direction: column;
  width: var(--shell-platform-rail);
  flex-shrink: 0;
  height: 100%;
  min-height: 0;
  padding: 0 8px 8px;
  box-sizing: border-box;
  background: var(--shell-rail-bg);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  transition: width var(--transition-base);
  overflow: visible;
}
.platform-rail.collapsed {
  width: var(--shell-platform-rail-collapsed);
}
.rail-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--page-header-height);
  flex-shrink: 0;
}
.brand-logo {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}
.brand-mark {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--el-color-primary);
  color: var(--on-primary);
  font-size: var(--text-base);
  font-weight: 600;
}
.brand-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-toggle {
  display: grid;
  place-items: center;
  width: var(--shell-rail-button);
  height: var(--shell-rail-button);
  flex-shrink: 0;
  margin-left: auto;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.rail-toggle:hover {
  background: var(--el-fill-color-light);
}
.collapsed .rail-brand {
  flex-direction: column;
  height: auto;
  padding: 8px 0 4px;
  gap: 4px;
}
.collapsed .rail-toggle {
  margin-left: 0;
}
.rail-apps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  overflow-x: hidden;
}
.rail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: var(--nav-row-height);
  padding: 0 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.rail-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.rail-row:hover:not(.unavailable) {
  background: var(--el-fill-color-light);
}
.rail-row.active {
  background: var(--shell-rail-selected);
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.rail-row.active .rail-icon {
  color: var(--el-text-color-primary);
}
.rail-row.unavailable {
  cursor: default;
  color: var(--el-text-color-tertiary);
}
.rail-row.unavailable .rail-icon,
.rail-row .rail-external {
  color: var(--el-text-color-tertiary);
}
.rail-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-external {
  flex-shrink: 0;
}
.collapsed .rail-row {
  justify-content: center;
  padding: 0;
}
.collapsed .rail-apps {
  align-items: center;
}
.rail-account {
  position: relative;
  flex-shrink: 0;
  padding-top: 8px;
}
.account-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: var(--nav-row-height);
  padding: 0 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.account-trigger:hover {
  background: var(--el-fill-color-light);
}
.account-avatar {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-primary);
  font-size: var(--text-xs);
  font-weight: 600;
}
.account-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collapsed .account-trigger {
  justify-content: center;
  padding: 0;
}
/* The menu anchors to the account row and opens upward, or beside the rail when it is collapsed. */
.account-menu-anchor {
  position: absolute;
  z-index: 30;
  bottom: calc(100% + 4px);
  left: 0;
}
.collapsed .account-menu-anchor {
  left: calc(100% + 4px);
  bottom: 0;
}
.rail-toggle:focus-visible,
.rail-row:focus-visible,
.account-trigger:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
</style>
