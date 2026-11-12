<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { PanelLeftClose, PanelLeftOpen, Moon } from "lucide-vue-next";
import type { PlatformAccount, PlatformApp, PlatformPreferences, PlatformShellLabels } from "./types";
import { appIcon, ExternalLink } from "./icons";
import PlatformAccountMenu from "./PlatformAccountMenu.vue";
import PlatformBrandMark from "./PlatformBrandMark.vue";

/**
 * The platform's own rail: the ground layer of the shell, with the expand control, every application in three sections
 * and the account at the foot.
 *
 * Collapsed — the default — it shows application icons only, each named by its tooltip and its accessible name, and the
 * control that expands it sits at the top with no brand mark. Expanded it shows the brand mark, the product name and the
 * names, and the control collapses it again. The rail carries no per-application content (DESIGN.md "Applications and
 * shells"): the application's own navigation is drawn by the application.
 */
const props = defineProps<{
  apps: readonly PlatformApp[];
  loading?: boolean;
  activeAppId: string | null;
  account: PlatformAccount | null;
  preferences: PlatformPreferences;
  labels: PlatformShellLabels;
  brand?: { name: string; logo?: string };
  collapsed: boolean;
  /** The name of each supported language, for the account menu. */
  localeNames?: Readonly<Record<string, string>>;
}>();

const emit = defineEmits<{
  selectApp: [id: string];
  "update:collapsed": [value: boolean];
}>();

const brandName = computed(() => props.brand?.name || props.labels.brand);
const markBrand = computed(() => ({ name: brandName.value, logo: props.brand?.logo }));

/** The rail's applications, in order: the ontology applications, then the business ones (the external one last). */
const scrolling = computed(() => {
  const of = (rail: PlatformApp["rail"]) => props.apps.filter((app) => (app.rail ?? "apps") === rail);
  return [of("top"), of("apps")].filter((section) => section.length > 0);
});

/**
 * The platform's own applications, at the foot of the rail above the account. They are not part of the scrolling area:
 * the business applications scroll under them, and a gap of the rail's own tone separates the two (DESIGN.md
 * "Applications and shells").
 */
const foot = computed(() => props.apps.filter((app) => app.rail === "bottom"));

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
  <nav class="platform-rail" :class="{ collapsed }" :aria-label="labels.applications">
    <!-- Collapsed: the expand control alone. Expanded: the brand mark, the product name and the collapse control. -->
    <div v-if="collapsed" class="rail-brand">
      <button
        type="button"
        class="rail-toggle"
        :aria-label="labels.expandRail"
        :title="labels.expandRail"
        :aria-expanded="false"
        @click="toggle"
      >
        <PanelLeftOpen :size="16" aria-hidden="true" />
      </button>
    </div>
    <div v-else class="rail-brand">
      <PlatformBrandMark :brand="markBrand" />
      <span class="brand-name">{{ brandName }}</span>
      <button
        type="button"
        class="rail-toggle"
        :aria-label="labels.collapseRail"
        :title="labels.collapseRail"
        :aria-expanded="true"
        @click="toggle"
      >
        <PanelLeftClose :size="16" aria-hidden="true" />
      </button>
    </div>

    <div class="rail-scroll">
      <div v-if="loading" class="rail-skeleton" aria-busy="true" :aria-label="labels.applications">
        <span v-for="item in 6" :key="item" />
      </div>
      <template v-for="(section, index) in scrolling" :key="index">
        <div v-if="index > 0" class="rail-divider" aria-hidden="true" />
        <ul class="rail-section">
          <li v-for="app in section" :key="app.id">
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
                :size="10"
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
                :size="10"
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
      </template>
    </div>

    <!-- The platform's own applications: the foot of the rail, above the account and outside the scrolling area. -->
    <ul v-if="foot.length > 0" class="rail-foot">
      <li v-for="app in foot" :key="app.id">
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
            :size="10"
            :role="labels.opensInNewTab ? 'img' : undefined"
            :aria-label="labels.opensInNewTab"
            :aria-hidden="labels.opensInNewTab ? undefined : 'true'"
          />
        </a>
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

    <!--
      The account menu is the only place the theme and language are chosen, so it exists in every edition: without a
      signed-in account it holds those two and no name.
    -->
    <div ref="menuRoot" class="rail-account">
      <div class="rail-divider" aria-hidden="true" />
      <button
        type="button"
        class="account-trigger"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        :aria-label="labels.account"
        :title="collapsed ? account?.userName : undefined"
        @click="menuOpen ? closeMenu() : openMenu()"
        @keydown.escape="closeMenu"
      >
        <span v-if="account" class="account-avatar" aria-hidden="true">{{ initial }}</span>
        <Moon v-else class="account-avatar-icon" :size="16" aria-hidden="true" />
        <span v-if="!collapsed && account" class="account-name">{{ account.userName }}</span>
        <span v-if="!collapsed && !account" class="account-name">{{ labels.account }}</span>
      </button>
      <div v-if="menuOpen" class="account-menu-anchor">
        <PlatformAccountMenu
          :account="account"
          :preferences="preferences"
          :labels="labels"
          :locale-names="localeNames"
          @close="closeMenu"
        />
      </div>
    </div>
  </nav>
</template>

<style scoped>
.rail-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.rail-skeleton span {
  height: 28px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--el-text-color-secondary) 15%, transparent);
  animation: rail-pulse 1.4s ease-in-out infinite;
}
@keyframes rail-pulse {
  50% { opacity: 0.35; }
}
@media (prefers-reduced-motion: reduce) {
  .rail-skeleton span { animation: none; }
}
/*
 * The rail is the ground the application sits on: `rail` in light mode the darkest band, in dark mode the lightest. It
 * draws no divider against the application — the application's own hairline does that — and only the sections, the
 * account and the foot are separated inside it (DESIGN.md "Layout").
 */
.platform-rail {
  display: flex;
  flex-direction: column;
  width: var(--shell-platform-rail);
  flex-shrink: 0;
  height: 100%;
  min-height: 0;
  padding: 10px 10px 12px;
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
  align-items: center;
  padding: 10px 0 12px;
}
.rail-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--shell-rail-button);
  margin-bottom: 6px;
  padding: 0 6px;
  flex-shrink: 0;
}
.brand-name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rail-toggle {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
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
  background: var(--shell-rail-hover);
  color: var(--el-text-color-primary);
}
/* Collapsed: the expand control is the top row, at the size of the icon rows below it. */
.collapsed .rail-brand {
  justify-content: center;
  height: auto;
  padding: 0;
}
.collapsed .rail-toggle {
  width: var(--shell-rail-button);
  height: var(--shell-rail-button);
  margin-left: 0;
  border-radius: var(--radius-md);
}
.rail-scroll {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
.rail-section,
.rail-foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
/*
 * The foot sits at the bottom, above the account: the business applications scroll under it, and the gap between the two
 * is the rail's own tone — no divider, and nothing of the platform among the applications.
 */
.rail-foot {
  flex-shrink: 0;
  margin-top: 12px;
}
/* The hairline between the rail's sections: a short rule, never a group name. */
.rail-divider {
  flex: 0 0 1px;
  height: 1px;
  margin: 8px 10px;
  background: var(--el-border-color);
}
.collapsed .rail-divider {
  width: 24px;
  margin: 8px auto;
}
.rail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  font-weight: var(--font-normal);
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
  background: var(--shell-rail-hover);
  color: var(--el-text-color-primary);
}
.rail-row.active {
  background: var(--shell-rail-selected);
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.rail-row.active .rail-icon {
  color: var(--brand-link);
}
.rail-row.active:hover {
  background: var(--shell-rail-selected-hover);
}
.rail-row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.rail-row.unavailable {
  cursor: default;
  color: var(--el-text-color-tertiary);
}
.rail-row.unavailable .rail-icon,
.rail-row .rail-external {
  color: var(--el-text-color-tertiary);
}
/*
 * An expanded rail shows every application's name in full, in every language: a long name wraps onto a second line and
 * its row grows, rather than being cut to an ellipsis that tells the reader nothing.
 */
.rail-label {
  flex: 1;
  min-width: 0;
  line-height: 1.25;
  overflow-wrap: anywhere;
  white-space: normal;
}
.rail-external {
  flex-shrink: 0;
}
.collapsed .rail-row {
  justify-content: center;
  width: var(--shell-rail-button);
  height: var(--shell-rail-button);
  padding: 0;
}
.collapsed .rail-section,
.collapsed .rail-foot {
  align-items: center;
}
.collapsed .rail-foot {
  width: 100%;
}
.rail-account {
  position: relative;
  flex-shrink: 0;
}
.account-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 6px 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.account-trigger:hover {
  background: var(--shell-rail-hover);
  color: var(--el-text-color-primary);
}
.account-avatar-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.account-avatar {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--el-color-primary-light-9);
  color: var(--brand-link);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
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
  width: var(--shell-rail-button);
  height: var(--shell-rail-button);
  padding: 0;
  border-radius: var(--radius-md);
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
