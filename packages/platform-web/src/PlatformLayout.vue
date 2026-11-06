<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter, RouterView } from "vue-router";
import {
  AppPanelPages,
  PlatformPageHeader,
  PlatformShell,
  type PlatformAccount,
  type PlatformPageActions,
  type PlatformPreferences,
  type PlatformShellLabels,
} from "@ontomato/platform-shell";
import type { PlatformAppDeclaration } from "./apps";
import { railApp } from "./apps";

/**
 * The page the current address shows: its words, and whether it draws its own header. Which application it belongs to is
 * not given here: the address decides that, so the shell cannot name one application while showing another's page.
 */
export interface PlatformShownPage {
  title: string;
  description?: string | null;
  /** The page draws its own header (the ontology graph, the model settings, the conversation). */
  ownHeader?: boolean;
}

const props = defineProps<{
  /** The applications the account may see, in rail order. */
  apps: readonly PlatformAppDeclaration[];
  /** Where the address belongs and what it shows; null on an address that is no page (a conversation). */
  shownPage: PlatformShownPage | null;
  account: PlatformAccount | null;
  preferences: PlatformPreferences;
  /** The name of each supported language, in the words the shell shows. */
  localeNames?: Readonly<Record<string, string>>;
  labels: PlatformShellLabels;
  brand?: { name: string; logo?: string };
  pageActions: PlatformPageActions | null;
  /** The host shows no application at all (its licence is not in force, or the account holds no page). */
  blocked?: { reason: "licence" | "no-pages"; message: string } | null;
}>();

const emit = defineEmits<{ selectApp: [id: string]; openSettings: [appId: string, entryId: string] }>();

/** The application whose prefix holds an address, the longest match winning: the rail's current row follows the address. */
function appFor(path: string): PlatformAppDeclaration | null {
  let match: PlatformAppDeclaration | null = null;
  for (const app of props.apps ?? []) {
    if (path !== app.prefix && !path.startsWith(`${app.prefix}/`)) continue;
    if (!match || app.prefix.length > match.prefix.length) match = app;
  }
  return match;
}

const route = useRoute();
const router = useRouter();
const railApps = computed(() => (props.apps ?? []).map(railApp));
const activeAppId = computed(() => appFor(route.path)?.id ?? null);
const activeApp = computed(() => props.apps.find((app) => app.id === activeAppId.value) ?? null);
const headerShown = computed(() => props.shownPage !== null && !props.shownPage.ownHeader);

/**
 * The pages of the current application, in its own order, as one row: an application of several pages switches between
 * them in its header (DESIGN.md "Applications and shells"). An application whose pages are its own menu (the ontology
 * manager) draws that menu in the area instead, so the platform draws neither a column nor tabs for it.
 */
const pageTabs = computed(() => {
  const pages = (activeApp.value?.groups ?? []).flatMap((group) => group.pages);
  // One page is not a tab: a single-screen application is its header and its page.
  return pages.length > 1 ? pages.map((page) => ({ path: page.id, label: page.label })) : [];
});
/** The tab the current address is in: a screen of a page (a tab of it, a detail row) marks that page. */
const activeTabPath = computed(() => (route.meta.page as string | undefined) ?? route.path);
const menuPages = computed(() => (activeApp.value?.frame === "menu" ? (activeApp.value.groups ?? []) : []));
</script>

<template>
  <PlatformShell
    :apps="blocked ? [] : railApps"
    :active-app-id="activeAppId"
    :account="account"
    :preferences="preferences"
    :locale-names="localeNames"
    :labels="labels"
    :brand="brand"
    @select-app="emit('selectApp', $event)"
  >
    <!--
      The application's own header, then its page. An application of several pages puts them here as tabs; an
      application with a menu of its own draws that menu beside its pages, inside its own area.
    -->
    <div v-if="menuPages.length > 0 && !blocked" class="platform-app-body has-menu">
      <aside class="platform-app-menu">
        <AppPanelPages
          :groups="menuPages"
          :active-page-id="(route.meta.page as string | undefined) ?? route.path"
          @select-page="router.push($event)"
        />
      </aside>
      <div class="platform-app-page">
        <PlatformPageHeader
          v-if="headerShown && shownPage"
          :title="shownPage.title"
          :description="shownPage.description"
          :actions="pageActions"
          :labels="{ save: labels.save, discard: labels.discard, unsavedChanges: labels.unsavedChanges }"
          @save="pageActions?.save()"
          @discard="pageActions?.discard()"
        />
        <div class="platform-page-body">
          <RouterView />
        </div>
      </div>
    </div>
    <template v-else>
      <PlatformPageHeader
        v-if="headerShown && shownPage && !blocked"
        :title="shownPage.title"
        :description="shownPage.description"
        :tabs="pageTabs.length > 0 ? pageTabs : undefined"
        :active-path="activeTabPath"
        :actions="pageActions"
        :labels="{ save: labels.save, discard: labels.discard, unsavedChanges: labels.unsavedChanges }"
        @save="pageActions?.save()"
        @discard="pageActions?.discard()"
        @select-tab="router.push($event)"
      />
      <!--
        A page that draws its own title still gets its application's tabs above it: the tabs belong to the application,
        the title to the page.
      -->
      <PlatformPageHeader
        v-if="shownPage && shownPage.ownHeader && !blocked && pageTabs.length > 0"
        :tabs="pageTabs"
        :active-path="activeTabPath"
        :labels="{ save: labels.save, discard: labels.discard, unsavedChanges: labels.unsavedChanges }"
        @select-tab="router.push($event)"
      />
      <div v-if="blocked" class="platform-blocked" role="alert">{{ blocked.message }}</div>
      <div v-else class="platform-page-body">
        <RouterView />
      </div>
    </template>
  </PlatformShell>
</template>

<style scoped>
/*
 * The page area is the application's: it fills the surface beside the rail with no gutter of its own, so a page that
 * wants the full width is not inset by the platform (DESIGN.md "Layout").
 */
.platform-page-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
}
.platform-page-body :deep(.platform-page) {
  height: 100%;
}
.platform-app-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
/* An application with a menu of its own: the menu in its band, the page on the application's surface. */
.platform-app-menu {
  flex: 0 0 var(--shell-app-column);
  width: var(--shell-app-column);
  box-sizing: border-box;
  padding: 14px 10px 12px;
  background: var(--shell-panel-bg);
  border-right: 1px solid var(--el-border-color);
  overflow-y: auto;
}
.platform-app-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
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
