<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ChevronDown, ChevronUp, Moon, PanelLeftOpen, Pin, PinOff } from "lucide-vue-next";
import type {
  PlatformAccount,
  PlatformApp,
  PlatformBrand,
  PlatformPreferences,
  PlatformRailSection,
  PlatformShellLabels,
} from "./types";
import { appIcon, ExternalLink } from "./icons";
import PlatformAccountMenu from "./PlatformAccountMenu.vue";
import PlatformBrandMark from "./PlatformBrandMark.vue";
import { ElTooltip } from "element-plus";
import { actionTooltipProps } from "@ontomato/foundation-ui/overlay";

/**
 * The platform's own rail: the ground layer of the shell, with the pin control, every application in sections and the
 * account at the foot.
 *
 * Unpinned (collapsed) by default, it shows application icons only and expands as a floating overlay on pointer hover
 * without narrowing the application surface. Pinning it keeps the rail expanded in layout flow across reloads per user.
 */
const props = defineProps<{
  apps: readonly PlatformApp[];
  loading?: boolean;
  activeAppId: string | null;
  account: PlatformAccount | null;
  preferences: PlatformPreferences;
  labels: PlatformShellLabels;
  brand?: PlatformBrand;
  collapsed: boolean;
  /** The name of each supported language, for the account menu. */
  localeNames?: Readonly<Record<string, string>>;
}>();

const emit = defineEmits<{
  selectApp: [id: string];
  "update:collapsed": [value: boolean];
}>();

const BUILDERS_APP_FOLD_LIMIT = 5;
const BUILDERS_EXPANDED_KEY = "ontomato.platform.railBuildersExpanded";

function buildersStorageKey(account: PlatformAccount | null): string {
  const user = account?.userName?.trim();
  return user ? `${BUILDERS_EXPANDED_KEY}:${encodeURIComponent(user)}` : BUILDERS_EXPANDED_KEY;
}

function readBuildersExpanded(account: PlatformAccount | null): boolean {
  try {
    return localStorage.getItem(buildersStorageKey(account)) === "true";
  } catch {
    return false;
  }
}

const buildersExpanded = ref(readBuildersExpanded(props.account));
watch(
  () => props.account?.userName,
  () => {
    buildersExpanded.value = readBuildersExpanded(props.account);
  },
);

function toggleBuildersExpanded() {
  buildersExpanded.value = !buildersExpanded.value;
  try {
    localStorage.setItem(buildersStorageKey(props.account), String(buildersExpanded.value));
  } catch {
    // Remembering the fold state is a convenience only.
  }
}

const brandName = computed(() => props.brand?.name || props.labels.brand);
const markBrand = computed(() => ({ ...props.brand, name: brandName.value }));
const builtLabel = computed(() => props.labels.builtApplication || "App Builder");
const moreLabel = computed(() => props.labels.more || "More");
const collapseLabel = computed(() => props.labels.collapse || "Collapse");
const appLabel = (app: PlatformApp) => app.built ? `${app.label} · ${builtLabel.value}` : app.label;
const newTabLabel = (app: PlatformApp) => [appLabel(app), props.labels.opensInNewTab].filter(Boolean).join(" · ");
const standaloneActionText = computed(() => props.labels.openStandalone || props.labels.opensInNewTab || "Open standalone");
const standaloneAriaLabel = (app: PlatformApp) => `${app.label} · ${standaloneActionText.value}`;
const moreToggleAriaLabel = (hiddenCount: number) =>
  buildersExpanded.value ? collapseLabel.value : (hiddenCount > 0 ? `${moreLabel.value} (${hiddenCount})` : moreLabel.value);

interface RailSectionView {
  key: PlatformRailSection;
  apps: PlatformApp[];
  showToggle: boolean;
  hiddenCount: number;
}

/**
 * The rail's applications, in order: business applications, builders and their registered apps (folding registered
 * applications beyond 5 while always surfacing the currently open one), then ontology/operations.
 */
const scrolling = computed<RailSectionView[]>(() => {
  const of = (rail: PlatformRailSection) => props.apps.filter((app) => (app.rail ?? "apps") === rail);
  const sections: RailSectionView[] = [];
  for (const key of ["top", "builders", "apps"] as const) {
    const sectionApps = of(key);
    if (sectionApps.length === 0) continue;
    if (key !== "builders") {
      sections.push({ key, apps: sectionApps, showToggle: false, hiddenCount: 0 });
      continue;
    }
    const pinnedBuilders = sectionApps.filter((app) => !app.built);
    const registeredApps = sectionApps.filter((app) => Boolean(app.built));
    if (registeredApps.length <= BUILDERS_APP_FOLD_LIMIT) {
      sections.push({ key, apps: sectionApps, showToggle: false, hiddenCount: 0 });
      continue;
    }
    if (buildersExpanded.value) {
      sections.push({ key, apps: [...pinnedBuilders, ...registeredApps], showToggle: true, hiddenCount: 0 });
      continue;
    }
    const head = registeredApps.slice(0, BUILDERS_APP_FOLD_LIMIT);
    const tail = registeredApps.slice(BUILDERS_APP_FOLD_LIMIT);
    const activeInTail = tail.find((app) => app.id === props.activeAppId);
    const visibleRegistered = activeInTail ? [...head, activeInTail] : head;
    const hiddenCount = tail.length - (activeInTail ? 1 : 0);
    sections.push({
      key,
      apps: [...pinnedBuilders, ...visibleRegistered],
      showToggle: hiddenCount > 0,
      hiddenCount,
    });
  }
  return sections;
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

/* ---- hover expand & account menu ---- */
const railRoot = ref<HTMLElement | null>(null);
const hovered = ref(false);
const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);

const visuallyExpanded = computed(() => !props.collapsed || hovered.value || menuOpen.value);
const floating = computed(() => props.collapsed && visuallyExpanded.value);

function onRailEnter() {
  if (props.collapsed) hovered.value = true;
}

function onRailLeave() {
  hovered.value = false;
}

function toggle() {
  const nextCollapsed = !props.collapsed;
  if (nextCollapsed) hovered.value = false;
  emit("update:collapsed", nextCollapsed);
}

function onDocumentPointer(event: PointerEvent) {
  const target = event.target as Node;
  if (menuRoot.value && !menuRoot.value.contains(target)) {
    closeMenu();
    if (props.collapsed && railRoot.value && !railRoot.value.contains(target)) {
      hovered.value = false;
    }
  }
}
function openMenu() {
  menuOpen.value = true;
  document.addEventListener("pointerdown", onDocumentPointer);
}
function closeMenu() {
  menuOpen.value = false;
  document.removeEventListener("pointerdown", onDocumentPointer);
}
function onMenuClose() {
  closeMenu();
  if (!props.collapsed) return;
  void nextTick(() => {
    try {
      if (!railRoot.value?.matches(":hover")) hovered.value = false;
    } catch {
      hovered.value = false;
    }
  });
}
const initial = computed(() => props.account?.userName.trim().charAt(0).toUpperCase() ?? "");

// Unpinning while the account menu is open closes the menu together with the rail.
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
    ref="railRoot"
    class="platform-rail"
    :class="{ collapsed: !visuallyExpanded, floating }"
    :aria-label="labels.applications"
    @mouseenter="onRailEnter"
    @mouseleave="onRailLeave"
  >
    <!-- Visually collapsed: the pin/expand control alone. Expanded (hovered or pinned): brand mark, name, pin toggle. -->
    <div v-if="!visuallyExpanded" class="rail-brand">
      <ElTooltip v-bind="actionTooltipProps" :content="labels.expandRail">
      <button
        type="button"
        class="rail-toggle"
        :aria-label="labels.expandRail"
        :aria-expanded="false"
        :aria-pressed="false"
        @click="toggle"
      >
        <PanelLeftOpen :size="16" aria-hidden="true" />
      </button>
      </ElTooltip>
    </div>
    <div v-else class="rail-brand">
      <PlatformBrandMark :brand="markBrand" />
      <span class="brand-name">{{ brandName }}</span>
      <ElTooltip v-bind="actionTooltipProps" :content="collapsed ? labels.expandRail : labels.collapseRail">
      <button
        type="button"
        class="rail-toggle"
        :class="{ pinned: !collapsed }"
        :aria-label="collapsed ? labels.expandRail : labels.collapseRail"
        :aria-expanded="!collapsed"
        :aria-pressed="!collapsed"
        @click="toggle"
      >
        <PinOff v-if="!collapsed" :size="15" aria-hidden="true" />
        <Pin v-else :size="15" aria-hidden="true" />
      </button>
      </ElTooltip>
    </div>

    <div class="rail-scroll">
      <div v-if="loading" class="rail-skeleton" aria-busy="true" :aria-label="labels.applications">
        <span v-for="item in 6" :key="item" />
      </div>
      <template v-for="(section, index) in scrolling" :key="section.key">
        <div v-if="index > 0" class="rail-divider" aria-hidden="true" />
        <ul class="rail-section" :data-section="section.key">
          <li v-for="app in section.apps" :key="app.id">
            <a
              v-if="app.href"
              class="rail-row external"
              :class="{ active: app.built && app.id === activeAppId }"
              :aria-current="app.built && app.id === activeAppId ? 'page' : undefined"
              :href="app.href"
              target="_blank"
              rel="noopener noreferrer"
              :title="app.built ? newTabLabel(app) : !visuallyExpanded ? app.label : undefined"
              :aria-label="app.built ? newTabLabel(app) : !visuallyExpanded ? app.label : undefined"
            >
              <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
              <span v-if="visuallyExpanded" class="rail-label">{{ app.label }}</span>
              <ExternalLink v-if="app.built && visuallyExpanded" :size="12" class="rail-built-icon" aria-hidden="true" />
              <ExternalLink
                v-else-if="visuallyExpanded"
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
              :title="!visuallyExpanded ? app.label : undefined"
              :aria-label="!visuallyExpanded ? app.label : undefined"
              @click="app.open()"
            >
              <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
              <span v-if="visuallyExpanded" class="rail-label">{{ app.label }}</span>
              <ExternalLink
                v-if="visuallyExpanded"
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
              :aria-label="!visuallyExpanded ? app.label : undefined"
            >
              <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
              <span v-if="visuallyExpanded" class="rail-label">{{ app.label }}</span>
            </span>
            <div
              v-else
              class="rail-item"
              :class="{ active: app.id === activeAppId, 'has-standalone': visuallyExpanded && Boolean(app.standaloneHref) }"
            >
              <button
                type="button"
                class="rail-row"
                :class="{ active: app.id === activeAppId }"
                :aria-current="app.id === activeAppId ? 'page' : undefined"
                :title="!visuallyExpanded || app.built ? appLabel(app) : undefined"
                :aria-label="!visuallyExpanded || app.built ? appLabel(app) : undefined"
                @click="selectApp(app)"
              >
                <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
                <span v-if="visuallyExpanded" class="rail-label">{{ app.label }}</span>
              </button>
              <ElTooltip v-if="visuallyExpanded && app.standaloneHref" v-bind="actionTooltipProps" :content="standaloneActionText">
                <a
                  class="rail-standalone"
                  :href="app.standaloneHref"
                  target="_blank"
                  rel="noopener noreferrer"
                  :aria-label="standaloneAriaLabel(app)"
                >
                  <ExternalLink :size="13" aria-hidden="true" />
                </a>
              </ElTooltip>
            </div>
          </li>
          <li v-if="section.showToggle" class="rail-more-item">
            <button
              type="button"
              class="rail-row rail-more-toggle"
              :aria-expanded="buildersExpanded"
              :title="!visuallyExpanded ? moreToggleAriaLabel(section.hiddenCount) : undefined"
              :aria-label="!visuallyExpanded ? moreToggleAriaLabel(section.hiddenCount) : undefined"
              @click="toggleBuildersExpanded"
            >
              <ChevronUp v-if="buildersExpanded" class="rail-icon" :size="16" aria-hidden="true" />
              <ChevronDown v-else class="rail-icon" :size="16" aria-hidden="true" />
              <span v-if="visuallyExpanded" class="rail-label">{{ buildersExpanded ? collapseLabel : moreLabel }}</span>
              <span v-if="visuallyExpanded && !buildersExpanded && section.hiddenCount > 0" class="rail-more-count">
                {{ section.hiddenCount }}
              </span>
            </button>
          </li>
        </ul>
      </template>
    </div>

    <div v-if="foot.length > 0 && scrolling.length > 0" class="rail-divider rail-management-divider" aria-hidden="true" />
    <!-- Settings form the final group, above the account and outside the scrolling area. -->
    <ul v-if="foot.length > 0" class="rail-foot">
      <li v-for="app in foot" :key="app.id">
        <a
          v-if="app.href"
          class="rail-row external"
          :href="app.href"
          target="_blank"
          rel="noopener noreferrer"
          :title="!visuallyExpanded ? app.label : undefined"
          :aria-label="!visuallyExpanded ? app.label : undefined"
        >
          <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
          <span v-if="visuallyExpanded" class="rail-label">{{ app.label }}</span>
          <ExternalLink
            v-if="visuallyExpanded"
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
          :title="!visuallyExpanded ? app.label : undefined"
          :aria-label="!visuallyExpanded ? app.label : undefined"
          @click="app.open()"
        >
          <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
          <span v-if="visuallyExpanded" class="rail-label">{{ app.label }}</span>
        </button>
        <span
          v-else-if="app.unavailableHint"
          class="rail-row unavailable"
          aria-disabled="true"
          :title="app.unavailableHint"
          :aria-label="!visuallyExpanded ? app.label : undefined"
        >
          <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
          <span v-if="visuallyExpanded" class="rail-label">{{ app.label }}</span>
        </span>
        <div
          v-else
          class="rail-item"
          :class="{ active: app.id === activeAppId, 'has-standalone': visuallyExpanded && Boolean(app.standaloneHref) }"
        >
          <button
            type="button"
            class="rail-row"
            :class="{ active: app.id === activeAppId }"
            :aria-current="app.id === activeAppId ? 'page' : undefined"
            :title="!visuallyExpanded ? app.label : undefined"
            :aria-label="!visuallyExpanded ? app.label : undefined"
            @click="selectApp(app)"
          >
            <component :is="appIcon(app.icon)" class="rail-icon" :size="16" aria-hidden="true" />
            <span v-if="visuallyExpanded" class="rail-label">{{ app.label }}</span>
          </button>
          <ElTooltip v-if="visuallyExpanded && app.standaloneHref" v-bind="actionTooltipProps" :content="standaloneActionText">
            <a
              class="rail-standalone"
              :href="app.standaloneHref"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="standaloneAriaLabel(app)"
            >
              <ExternalLink :size="13" aria-hidden="true" />
            </a>
          </ElTooltip>
        </div>
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
        :title="!visuallyExpanded ? account?.userName : undefined"
        @click="menuOpen ? onMenuClose() : openMenu()"
        @keydown.escape="onMenuClose"
      >
        <span v-if="account" class="account-avatar" aria-hidden="true">{{ initial }}</span>
        <Moon v-else class="account-avatar-icon" :size="16" aria-hidden="true" />
        <span v-if="visuallyExpanded && account" class="account-name">{{ account.userName }}</span>
        <span v-if="visuallyExpanded && !account" class="account-name">{{ labels.account }}</span>
      </button>
      <div v-if="menuOpen" class="account-menu-anchor">
        <PlatformAccountMenu
          :account="account"
          :preferences="preferences"
          :labels="labels"
          :locale-names="localeNames"
          @close="onMenuClose"
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
  transition: width var(--transition-base), box-shadow var(--transition-fast);
  overflow: visible;
}
.platform-rail.collapsed {
  width: var(--shell-platform-rail-collapsed);
  align-items: center;
  padding: 10px 0 12px;
}
/* Hover-expanded while unpinned: floats over the application surface without shifting or narrowing page content. */
.platform-rail.floating {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 40;
  width: var(--shell-platform-rail);
  border-right: 1px solid var(--shell-app-edge);
  border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
  box-shadow: var(--elevation-overlay);
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
.rail-toggle.pinned {
  color: var(--brand-link);
}
.rail-toggle.pinned:hover {
  background: var(--shell-rail-hover);
  color: var(--brand-link);
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
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.rail-scroll::-webkit-scrollbar {
  display: none;
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
/* Management stays above the account and has the same separator as the other application groups. */
.rail-foot {
  flex-shrink: 0;
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
.rail-item {
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
  transition: background-color var(--transition-fast);
}
.rail-item.has-standalone:hover {
  background: var(--shell-rail-hover);
}
.rail-item.has-standalone.active {
  background: var(--shell-rail-selected);
}
.rail-item.has-standalone.active:hover {
  background: var(--shell-rail-selected-hover);
}
.rail-item.has-standalone > .rail-row {
  flex: 1;
  min-width: 0;
  padding-right: 4px;
  background: transparent;
}
.rail-item.has-standalone > .rail-row:hover,
.rail-item.has-standalone > .rail-row.active,
.rail-item.has-standalone > .rail-row.active:hover {
  background: transparent;
}
.rail-standalone {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  margin-right: 4px;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-tertiary);
  opacity: 0.65;
  text-decoration: none;
  transition: background-color var(--transition-fast), color var(--transition-fast), opacity var(--transition-fast);
}
.rail-item:hover .rail-standalone,
.rail-item:focus-within .rail-standalone {
  opacity: 1;
  color: var(--el-text-color-secondary);
}
.rail-standalone:hover,
.rail-standalone:focus-visible {
  background: var(--shell-rail-hover);
  color: var(--el-text-color-primary);
  opacity: 1;
}
.rail-standalone:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.collapsed .rail-item {
  justify-content: center;
}
.rail-row {
  position: relative;
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
.rail-built-icon {
  flex: none;
  color: var(--el-text-color-secondary);
  opacity: 0.8;
}
.rail-more-toggle {
  color: var(--el-text-color-secondary);
}
.rail-more-count {
  flex-shrink: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-tertiary);
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
