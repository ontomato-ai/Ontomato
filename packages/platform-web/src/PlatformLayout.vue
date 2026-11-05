<script setup lang="ts">
import { computed, type Component } from "vue";
import { useRoute, useRouter, RouterView } from "vue-router";
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

/**
 * The page an address shows, as the platform knows it: the words of its header and whether it draws that header itself.
 * The host derives this from the same navigation it lists in the column, so a page cannot appear in one place and not
 * the other.
 */
export interface PlatformShownPage {
  /** The application the page belongs to. */
  appId: string;
  /** The page's own address, which is also the address of its route. */
  path: string;
  title: string;
  description?: string | null;
  /** The page draws its own 48px header (the ontology graph, the model settings, the conversation). */
  ownHeader?: boolean;
  /** `meta.page` of the route: a tab or a detail page names the page it is a screen of. */
  page: string;
}

const props = defineProps<{
  apps: readonly PlatformAppDeclaration[];
  account: PlatformAccount | null;
  preferences: PlatformPreferences;
  labels: PlatformShellLabels;
  brand?: { name: string; logo?: string };
  /** The page the current address shows; null on an address that is not a page (a conversation, a standalone screen). */
  shownPage: PlatformShownPage | null;
  pageActions: PlatformPageActions | null;
  /** The account's display name for the rail's menu. */
  signOut(): void;
  /** The word for a conversation application's column, e.g. the agent selector's label. */
  conversationPanel: Component | null;
}>();

const emit = defineEmits<{ selectApp: [id: string]; openSettings: [appId: string, entryId: string] }>();

const route = useRoute();

const railApps = computed(() => props.apps.map(railApp));
const activeAppId = computed(() => {
  const page = props.shownPage;
  if (page) return page.appId;
  const path = route.path;
  const match = props.apps
    .filter((app) => path === app.prefix || path.startsWith(`${app.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return match?.id ?? null;
});
const activeApp = computed(() => props.apps.find((app) => app.id === activeAppId.value) ?? null);
const panel = computed(() => (activeApp.value ? panelOf(activeApp.value) : null));
const headerShown = computed(() => {
  const page = props.shownPage;
  return page !== null && !page.ownHeader;
});
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
        @open-settings="emit('openSettings', activeApp?.id ?? '', $event)"
      >
        <AppPanelPages
          v-if="activeApp?.panel === 'pages'"
          :groups="activeApp.groups ?? []"
          :active-page-id="(route.meta.page as string | undefined) ?? null"
        />
        <component :is="conversationPanel" v-else-if="conversationPanel" />
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
    <div class="platform-page-body" :class="{ 'with-header': headerShown }">
      <RouterView />
    </div>
  </PlatformShell>
</template>

<style scoped>
/* The page area scrolls on its own: the header stays at the top of the workspace. */
.platform-page-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.platform-page-body :deep(.platform-page) {
  height: 100%;
}
</style>
