<script setup lang="ts">
import { Check, Languages, LogOut, Moon, Sun } from "lucide-vue-next";
import type { PlatformAccount, PlatformPreferences, PlatformShellLabels } from "./types";

/**
 * The account menu at the foot of the platform rail: language, theme, sign out. It replaces the account rows the two
 * applications used to draw in their own sidebars.
 */
const props = defineProps<{
  account: PlatformAccount;
  preferences: PlatformPreferences;
  labels: PlatformShellLabels;
}>();

const emit = defineEmits<{ close: [] }>();

function chooseLocale(locale: string) {
  props.preferences.setLocale(locale);
  emit("close");
}
function chooseTheme() {
  props.preferences.setTheme(props.preferences.theme === "dark" ? "light" : "dark");
}
/** Signing out is the account's own action; the menu only reports that it is closing. */
function signOut() {
  props.account.signOut();
  emit("close");
}
</script>

<template>
  <div class="platform-account-menu" role="menu" @keydown.escape="emit('close')">
    <template v-if="preferences.locales.length > 1">
      <p class="menu-heading">{{ labels.language }}</p>
      <button
        v-for="locale in preferences.locales"
        :key="locale"
        type="button"
        role="menuitemradio"
        class="menu-row"
        :aria-checked="preferences.locale === locale"
        @click="chooseLocale(locale)"
      >
        <Languages :size="15" aria-hidden="true" />
        <span>{{ locale }}</span>
        <Check v-if="preferences.locale === locale" :size="15" class="menu-check" aria-hidden="true" />
      </button>
      <div class="menu-divider" role="separator" />
    </template>
    <button type="button" role="menuitem" class="menu-row" @click="chooseTheme">
      <Sun v-if="preferences.theme === 'dark'" :size="15" aria-hidden="true" />
      <Moon v-else :size="15" aria-hidden="true" />
      <span>{{ preferences.theme === 'dark' ? labels.theme.light : labels.theme.dark }}</span>
    </button>
    <button type="button" role="menuitem" class="menu-row" @click="signOut">
      <LogOut :size="15" aria-hidden="true" />
      <span>{{ labels.signOut }}</span>
    </button>
  </div>
</template>

<style scoped>
.platform-account-menu {
  min-width: 180px;
  margin: 0;
  padding: 4px;
  border-radius: var(--radius-md);
  background: var(--el-bg-color-overlay);
  box-shadow: var(--elevation-overlay);
}
.menu-heading {
  margin: 0;
  padding: 6px 8px 4px;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  color: var(--el-text-color-secondary);
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
.menu-row:hover {
  background: var(--el-fill-color-light);
}
.menu-row span {
  flex: 1;
  min-width: 0;
}
.menu-check {
  color: var(--el-color-primary);
}
.menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--el-border-color);
}
</style>
