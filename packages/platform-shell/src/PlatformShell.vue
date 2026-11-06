<script setup lang="ts">
import { computed, ref } from "vue";
import type { PlatformAccount, PlatformApp, PlatformPreferences, PlatformShellLabels } from "./types";
import PlatformRail from "./PlatformRail.vue";

/**
 * The platform shell: two layers, not three columns. The rail is the ground; the current application is one surface on
 * top of it, filling everything to the right, rounded only where it meets the rail and separated from it by a hairline
 * (`--shell-app-edge`), with no shadow.
 *
 * The application owns its inside: an application that wants a column draws it in its own area (DESIGN.md "Applications
 * and shells"). The shell knows nothing about columns and does not draw one.
 */
const props = withDefaults(
  defineProps<{
    apps: readonly PlatformApp[];
    activeAppId: string | null;
    account: PlatformAccount | null;
    preferences: PlatformPreferences;
    labels: PlatformShellLabels;
    brand?: { name: string; logo?: string };
    /** The name of each supported language, for the account menu. */
    localeNames?: Readonly<Record<string, string>>;
    /** Controlled from outside; when absent the shell remembers the choice itself. */
    collapsed?: boolean;
  }>(),
  { collapsed: undefined, brand: undefined },
);

const emit = defineEmits<{ selectApp: [id: string]; "update:collapsed": [value: boolean] }>();

const RAIL_KEY = "ontomato.platform.railCollapsed";

/** Collapsed unless the reader expanded it: the rail is a launcher, and the applications open full page. */
function readRemembered(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) !== "false";
  } catch {
    return true;
  }
}

const remembered = ref(readRemembered());
const collapsed = computed({
  get: () => (props.collapsed !== undefined ? props.collapsed : remembered.value),
  set: (value: boolean) => {
    if (props.collapsed === undefined) {
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
      :locale-names="localeNames"
      :collapsed="collapsed"
      @select-app="emit('selectApp', $event)"
      @update:collapsed="collapsed = $event"
    />
    <!-- The application: one surface on the rail's ground, filling the rest of the page. -->
    <div class="platform-app">
      <slot name="panel" />
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
@media (max-width: 760px) {
  .platform-shell {
    flex-direction: column;
    height: auto;
    min-height: 100dvh;
  }
  .platform-app {
    border-radius: var(--shell-app-radius) var(--shell-app-radius) 0 0;
    border-right: 1px solid var(--shell-app-edge);
    border-bottom: 0;
  }
  .platform-workspace {
    min-height: 60vh;
  }
}
</style>
