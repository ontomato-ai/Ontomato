<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { Check, ChevronRight, Languages, LogOut, Moon, Sun } from "lucide-vue-next";
import type { PlatformAccount, PlatformPreferences, PlatformShellLabels } from "./types";

/**
 * The account menu at the foot of the platform rail: language submenu, theme, sign out. It replaces the account rows
 * the two applications used to draw in their own sidebars.
 */
const props = defineProps<{
  /** Null in an edition without sign-in: the menu then holds the theme and language only. */
  account: PlatformAccount | null;
  preferences: PlatformPreferences;
  labels: PlatformShellLabels;
  /** The name of each supported language in its own terms; the account menu lists the languages by name. */
  localeNames?: Readonly<Record<string, string>>;
}>();

const emit = defineEmits<{ close: [] }>();

const languageOpen = ref(false);
let closeLanguageTimer: ReturnType<typeof setTimeout> | null = null;

function cancelLanguageClose() {
  if (closeLanguageTimer !== null) {
    clearTimeout(closeLanguageTimer);
    closeLanguageTimer = null;
  }
}

function openLanguageMenu() {
  cancelLanguageClose();
  languageOpen.value = true;
}

function closeLanguageMenu() {
  cancelLanguageClose();
  languageOpen.value = false;
}

function scheduleLanguageClose() {
  cancelLanguageClose();
  closeLanguageTimer = setTimeout(() => {
    languageOpen.value = false;
    closeLanguageTimer = null;
  }, 120);
}

function toggleLanguageMenu() {
  cancelLanguageClose();
  languageOpen.value = !languageOpen.value;
}

function chooseLocale(locale: string) {
  props.preferences.setLocale(locale);
  closeLanguageMenu();
  emit("close");
}
function chooseTheme() {
  closeLanguageMenu();
  props.preferences.setTheme(props.preferences.theme === "dark" ? "light" : "dark");
}
/** Signing out is the account's own action; the menu only reports that it is closing. */
function signOut() {
  closeLanguageMenu();
  props.account?.signOut();
  emit("close");
}

onBeforeUnmount(cancelLanguageClose);
</script>

<template>
  <div class="platform-account-menu" role="menu" @keydown.escape="emit('close')">
    <div
      v-if="preferences.locales.length > 1"
      class="menu-submenu-wrap"
      @mouseenter="openLanguageMenu"
      @mouseleave="scheduleLanguageClose"
    >
      <button
        type="button"
        role="menuitem"
        class="menu-row menu-submenu-trigger"
        :class="{ active: languageOpen }"
        aria-haspopup="menu"
        :aria-expanded="languageOpen"
        @click="toggleLanguageMenu"
        @keydown.arrow-right.prevent="openLanguageMenu"
        @keydown.arrow-left.prevent="closeLanguageMenu"
      >
        <Languages :size="15" aria-hidden="true" />
        <span>{{ labels.language }}</span>
        <ChevronRight :size="14" class="menu-chevron" aria-hidden="true" />
      </button>
      <div
        v-if="languageOpen"
        class="account-submenu"
        role="menu"
        :aria-label="labels.language"
        @mouseenter="openLanguageMenu"
        @mouseleave="scheduleLanguageClose"
        @keydown.escape.stop="closeLanguageMenu"
        @keydown.arrow-left.stop.prevent="closeLanguageMenu"
      >
        <button
          v-for="locale in preferences.locales"
          :key="locale"
          type="button"
          role="menuitemradio"
          class="menu-row"
          :aria-checked="preferences.locale === locale"
          @click="chooseLocale(locale)"
        >
          <span>{{ localeNames?.[locale] ?? locale }}</span>
          <Check v-if="preferences.locale === locale" :size="15" class="menu-check" aria-hidden="true" />
        </button>
      </div>
    </div>
    <button type="button" role="menuitem" class="menu-row" @mouseenter="closeLanguageMenu" @click="chooseTheme">
      <Sun v-if="preferences.theme === 'dark'" :size="15" aria-hidden="true" />
      <Moon v-else :size="15" aria-hidden="true" />
      <span>{{ preferences.theme === 'dark' ? labels.theme.light : labels.theme.dark }}</span>
    </button>
    <button v-if="account" type="button" role="menuitem" class="menu-row" @mouseenter="closeLanguageMenu" @click="signOut">
      <LogOut :size="15" aria-hidden="true" />
      <span>{{ labels.signOut }}</span>
    </button>
  </div>
</template>

<style scoped>
.platform-account-menu {
  position: relative;
  min-width: 180px;
  margin: 0;
  padding: 4px;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}
.menu-submenu-wrap {
  position: relative;
}
.menu-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: var(--nav-row-height);
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.menu-row:hover,
.menu-row.active {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.menu-row span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.menu-chevron {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.account-submenu {
  position: absolute;
  left: calc(100% + 6px);
  bottom: -4px;
  z-index: 40;
  min-width: 168px;
  max-height: min(360px, calc(100vh - 24px));
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}
/* Invisible hover bridge spanning the gap between the primary menu and language submenu. */
.account-submenu::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -10px;
  width: 10px;
}
.menu-check {
  flex-shrink: 0;
  color: var(--el-color-primary);
}
</style>
