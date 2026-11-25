<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { PlatformAccount, PlatformApp, PlatformBrand, PlatformPreferences, PlatformShellLabels } from "./types";
import PlatformRail from "./PlatformRail.vue";

/**
 * The platform shell: two layers, not three columns. The rail is the ground; the current application is one surface on
 * top of it, filling everything to the right, rounded only where it meets the rail and separated from it by a hairline
 * (`--shell-app-edge`), with no shadow.
 *
 * The application owns its inside: an application that wants a column, a menu or tabs draws them in its own area
 * (DESIGN.md "Applications and shells"). The shell draws none of them.
 */
const props = withDefaults(
  defineProps<{
    apps: readonly PlatformApp[];
    loading?: boolean;
    activeAppId: string | null;
    account: PlatformAccount | null;
    preferences: PlatformPreferences;
    labels: PlatformShellLabels;
    brand?: PlatformBrand;
    /** The name of each supported language, for the account menu. */
    localeNames?: Readonly<Record<string, string>>;
    /** Controlled from outside; when absent the shell remembers the choice per user itself. */
    collapsed?: boolean;
    hideRail?: boolean;
  }>(),
  { collapsed: undefined, brand: undefined },
);

const emit = defineEmits<{ selectApp: [id: string]; "update:collapsed": [value: boolean] }>();

const RAIL_KEY = "ontomato.platform.railCollapsed";

function railStorageKey(account: PlatformAccount | null): string {
  const user = account?.userName?.trim();
  return user ? `${RAIL_KEY}:${encodeURIComponent(user)}` : RAIL_KEY;
}

/** Collapsed (unpinned) unless the reader pinned it open: hovering floats the rail over the page without squeezing it. */
function readRemembered(account: PlatformAccount | null): boolean {
  try {
    return localStorage.getItem(railStorageKey(account)) !== "false";
  } catch {
    return true;
  }
}

const remembered = ref(readRemembered(props.account));
watch(
  () => props.account?.userName,
  () => {
    remembered.value = readRemembered(props.account);
  },
);
const collapsed = computed({
  get: () => (props.collapsed !== undefined ? props.collapsed : remembered.value),
  set: (value: boolean) => {
    if (props.collapsed === undefined) {
      remembered.value = value;
      try {
        localStorage.setItem(railStorageKey(props.account), String(value));
      } catch {
        // Remembering the rail is a convenience only.
      }
    }
    emit("update:collapsed", value);
  },
});
</script>

<template>
  <div class="platform-shell" :class="{ 'rail-collapsed': collapsed && !hideRail, 'rail-hidden': hideRail }">
    <div v-if="!hideRail" class="platform-rail-slot" :class="{ 'slot-collapsed': collapsed }">
      <PlatformRail
        :loading="loading"
        :apps="apps"
        :active-app-id="activeAppId"
        :account="account"
        :preferences="preferences"
        :labels="labels"
        :brand="brand"
        :locale-names="localeNames"
        :collapsed="collapsed"
        @select-app="emit('selectApp', $event)"
        @update:collapsed="collapsed = $event"
      />
    </div>
    <!-- The application: one surface on the rail's ground, filling the rest of the page. -->
    <div class="platform-app">
      <main class="platform-workspace">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
/*
 * Two layers: the rail is the ground and the page's background; the application sits on it as one surface. Only the
 * corners where the two meet are rounded, and only a hairline separates them (DESIGN.md "Layout").
 */
.platform-shell {
  position: relative;
  display: flex;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  background: var(--shell-rail-bg);
  color: var(--el-text-color-primary);
  font-family: var(--font-sans, inherit);
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
/* Reserves the rail's layout footprint so hover-expanding an unpinned rail floats without narrowing the page. */
.platform-rail-slot {
  position: relative;
  flex: 0 0 var(--shell-platform-rail);
  width: var(--shell-platform-rail);
  height: 100%;
  min-height: 0;
  z-index: 40;
  transition: width var(--transition-base), flex-basis var(--transition-base);
}
.platform-rail-slot.slot-collapsed {
  flex: 0 0 var(--shell-platform-rail-collapsed);
  width: var(--shell-platform-rail-collapsed);
}
.platform-app {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  margin: 0;
  box-sizing: border-box;
  border: 1px solid var(--shell-app-edge);
  border-right: 0;
  border-radius: var(--shell-app-radius) 0 0 var(--shell-app-radius);
  background: var(--shell-workspace-bg);
  overflow: hidden;
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
.rail-hidden > .platform-app { border: 0; border-radius: 0; }
</style>
