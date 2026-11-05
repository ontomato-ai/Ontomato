<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { PlatformAccount, PlatformApp, PlatformPreferences, PlatformShellLabels } from "./types";
import PlatformRail from "./PlatformRail.vue";

/**
 * The platform shell: the application rail, the current application's own column, and the workspace. It is what both
 * products' pages are mounted inside, so switching applications never reloads the page and the rail never goes away.
 *
 * The rail and the columns sit edge to edge on their own colour roles (rail, panel, workspace) with no dividers; the
 * order of their tones reverses between light and dark in the brand source, never here.
 */
const props = withDefaults(
  defineProps<{
    apps: readonly PlatformApp[];
    activeAppId: string | null;
    account: PlatformAccount | null;
    preferences: PlatformPreferences;
    labels: PlatformShellLabels;
    brand?: { name: string; logo?: string };
    /** Controlled from outside; when absent the shell remembers the choice itself. */
    collapsed?: boolean;
  }>(),
  { collapsed: undefined, brand: undefined },
);

const emit = defineEmits<{ selectApp: [id: string]; "update:collapsed": [value: boolean]; signOut: [] }>();

const RAIL_KEY = "ontomato.platform.railCollapsed";

function readRemembered(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "true";
  } catch {
    return false;
  }
}

const remembered = ref(readRemembered());
/** The reader collapsed or expanded the rail themselves: their choice wins over the narrow-screen default. */
const explicit = ref(false);
/* Below 1280px the rail starts collapsed; an explicit choice still wins, at any width. */
const narrow = ref(false);
const collapsed = computed({
  get: () => {
    if (props.collapsed !== undefined) return props.collapsed;
    return narrow.value && !explicit.value ? true : remembered.value;
  },
  set: (value: boolean) => {
    if (props.collapsed === undefined) {
      explicit.value = true;
      remembered.value = value;
      try {
        localStorage.setItem(RAIL_KEY, String(value));
      } catch {
        // Remembering the rail is a convenience only.
      }
    }
    emit("update:collapsed", value);
  },
});

let query: MediaQueryList | null = null;
const onNarrow = () => {
  narrow.value = query?.matches ?? false;
};

onMounted(() => {
  if (typeof window === "undefined" || !window.matchMedia) return;
  query = window.matchMedia("(max-width: 1279px)");
  onNarrow();
  query.addEventListener("change", onNarrow);
});
onBeforeUnmount(() => query?.removeEventListener("change", onNarrow));
</script>

<template>
  <div class="platform-shell" :class="{ 'rail-collapsed': collapsed }">
    <PlatformRail
      :apps="apps"
      :active-app-id="activeAppId"
      :account="account"
      :preferences="preferences"
      :labels="labels"
      :brand="brand"
      :collapsed="collapsed"
      @select-app="emit('selectApp', $event)"
      @update:collapsed="collapsed = $event"
      @sign-out="emit('signOut')"
    />
    <slot name="panel" />
    <main class="platform-workspace">
      <slot />
    </main>
  </div>
</template>

<style scoped>
/* Three full-height columns, edge to edge, separated by tone alone (DESIGN.md "Layout"). */
.platform-shell {
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--shell-workspace-bg);
  color: var(--el-text-color-primary);
  font-family: var(--font-sans, inherit);
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
.platform-workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--shell-workspace-bg);
  overflow: hidden;
}
@media (max-width: 760px) {
  .platform-shell {
    flex-direction: column;
    height: auto;
    min-height: 100dvh;
  }
  .platform-workspace {
    min-height: 60vh;
  }
}
</style>
