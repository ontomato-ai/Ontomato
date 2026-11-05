<script setup lang="ts">
import { computed } from "vue";
import { useRoute, RouterView } from "vue-router";
import {
  AppPanel,
  AppPanelPages,
  PlatformPageHeader,
  PlatformShell,
  type PlatformAccount,
  type PlatformPageActions,
  type PlatformPreferences,
  type PlatformShellLabels,
} from "@ontomato/platform-shell";
import type { PlatformAppDeclaration } from "./apps";
import { panelOf, railApp } from "./apps";
import { useAppColumnOf } from "@ontomato/agent-shell-ui";

/**
 * The page the current address shows: its words, and whether it draws its own header. Which application it belongs to is
 * not given here: the address decides that, so the column cannot name one application while showing another's page.
 */
export interface PlatformShownPage {
  title: string;
  description?: string | null;
  /** The page draws its own 48px header (the ontology graph, the model settings, the conversation). */
  ownHeader?: boolean;
}

const props = defineProps<{
  /** The applications the account may see, in rail order. */
  apps: readonly PlatformAppDeclaration[];
  /** Where the address belongs and what it shows; null on an address that is no page (a conversation). */
  shownPage: PlatformShownPage | null;
  account: PlatformAccount | null;
  preferences: PlatformPreferences;
  labels: PlatformShellLabels;
  brand?: { name: string; logo?: string };
  pageActions: PlatformPageActions | null;
  /** A page's permission state could not be read, or it holds none: shown instead of the page. */
  blocked?: { message: string } | null;
}>();

const emit = defineEmits<{ selectApp: [id: string]; openSettings: [appId: string, entryId: string] }>();

/** The application whose prefix holds an address, the longest match winning: the column follows the address. */
function appFor(path: string): PlatformAppDeclaration | null {
  let match: PlatformAppDeclaration | null = null;
  for (const app of props.apps ?? []) {
    if (path !== app.prefix && !path.startsWith(`${app.prefix}/`)) continue;
    if (!match || app.prefix.length > match.prefix.length) match = app;
  }
  return match;
}

const route = useRoute();
const railApps = computed(() => (props.apps ?? []).map(railApp));
const activeAppId = computed(() => appFor(route.path)?.id ?? null);
const activeApp = computed(() => props.apps.find((app) => app.id === activeAppId.value) ?? null);
const panel = computed(() => (activeApp.value ? panelOf(activeApp.value) : null));
/** What the current page contributes to the column, if it is a conversation application. */
const column = useAppColumnOf();
const contributed = computed(() => (column.value?.appId === activeAppId.value ? column.value : null));
const headerShown = computed(() => props.shownPage !== null && !props.shownPage.ownHeader);
</script>

<template>
  <PlatformShell
    :apps="railApps"
    :active-app-id="activeAppId"
    :account="account"
    :preferences="preferences"
    :labels="labels"
    :brand="brand"
    @select-app="emit('selectApp', $event)"
  >
    <template #panel>
      <AppPanel
        v-if="panel"
        :panel="panel"
        :labels="labels"
        @open-settings="emit('openSettings', activeAppId ?? '', $event)"
      >
        <component :is="contributed.content" v-if="contributed" />
        <AppPanelPages
          v-else-if="activeApp"
          :groups="activeApp.groups ?? []"
          :active-page-id="(route.meta.page as string | undefined) ?? null"
        />
      </AppPanel>
    </template>

    <PlatformPageHeader
      v-if="headerShown && shownPage"
      :title="shownPage.title"
      :description="shownPage.description"
      :actions="pageActions"
      :labels="{ save: labels.save, discard: labels.discard, unsavedChanges: labels.unsavedChanges }"
      @save="pageActions?.save()"
      @discard="pageActions?.discard()"
    />
    <div v-if="blocked" class="platform-blocked" role="alert">{{ blocked.message }}</div>
    <div v-else class="platform-page-body">
      <RouterView />
    </div>
  </PlatformShell>
</template>

<style scoped>
/* The page area scrolls on its own: the header stays at the top of the workspace. */
.platform-page-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
  padding: 16px;
}
.platform-page-body :deep(.platform-page) {
  height: 100%;
}
.platform-blocked {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  font-size: var(--text-base);
}
</style>
