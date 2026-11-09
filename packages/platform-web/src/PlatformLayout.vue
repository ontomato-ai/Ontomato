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
  /** The page draws its own header (the ontology manager's pages, the conversation). */
  ownHeader?: boolean;
}

const props = defineProps<{
  /** The applications the account may see, in rail order. */
  apps: readonly PlatformAppDeclaration[];
  loading?: boolean;
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

const emit = defineEmits<{ selectApp: [id: string] }>();

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
const browserWorkspace = computed(() => route.path === "/browser/data" || route.path.startsWith("/browser/data/"));

/**
 * The pages of the current application, in its own order, as one row: an application of several pages switches between
 * them in its header (DESIGN.md "Applications and shells"). An application whose pages are its own menu (the ontology
 * manager) draws that menu in the area instead, so the platform draws no tabs for it.
 */
const pageTabs = computed(() => {
  // An application whose pages are its own menu draws that menu instead; its groups are not header tabs.
  if (activeApp.value?.frame === "menu") return [];
  const pages = (activeApp.value?.groups ?? []).flatMap((group) => group.pages);
  // One page is not a tab: a single-screen application is its header and its page.
  return pages.length > 1 ? pages.map((page) => ({ path: page.id, label: page.label })) : [];
});
/** The tab the current address is in: a screen of a page (a tab of it, a detail row) marks that page. */
const activeTabPath = computed(() => (route.meta.page as string | undefined) ?? route.path);
const menuPages = computed(() => (activeApp.value?.frame === "menu" ? (activeApp.value.groups ?? []) : []));

/**
 * The one header: an application of several pages shows the application's name, its one line of description and its
 * pages as tabs; a single-page application shows its page's name and description. An application that declares a line
 * of its own (the object browser, the system settings) is named in the header however many of its pages there are: with
 * one — the open-source object browser, or an account that may open only one — it is the same header without tabs. A
 * page that draws its own title (the ontology manager's) is left to draw it, and its application's tabs, if any, still
 * sit above it.
 */
const namedByApp = computed(() => pageTabs.value.length > 0 || activeApp.value?.description != null);
const headerTitle = computed(() => (namedByApp.value ? (activeApp.value?.label ?? "") : (props.shownPage?.title ?? "")));
const headerDescription = computed(() =>
  namedByApp.value ? (activeApp.value?.description ?? null) : (props.shownPage?.description ?? null),
);
const headerShown = computed(
  () => !props.blocked && (pageTabs.value.length > 0 || (props.shownPage !== null && !props.shownPage.ownHeader)),
);
</script>

<template>
  <PlatformShell
    :loading="loading"
    :class="{ 'object-browser-layout': browserWorkspace }"
    :apps="blocked ? [] : railApps"
    :active-app-id="activeAppId"
    :account="account"
    :preferences="preferences"
    :locale-names="localeNames"
    :labels="labels"
    :brand="brand"
    @select-app="emit('selectApp', $event)"
  >
    <!-- The application's menu of its own (the ontology manager): its groups in their band, the page beside it. -->
    <div v-if="menuPages.length > 0 && !blocked" class="platform-app-body has-menu">
      <aside class="platform-app-menu">
        <h2 class="app-menu-title">{{ activeApp?.label }}</h2>
        <AppPanelPages
          :groups="menuPages"
          :active-page-id="(route.meta.page as string | undefined) ?? route.path"
          @select-page="router.push($event)"
        />
      </aside>
      <div class="platform-app-page">
        <PlatformPageHeader
          v-if="headerShown"
          :title="headerTitle"
          :description="headerDescription"
          :tabs="pageTabs.length > 0 ? pageTabs : undefined"
          :active-path="activeTabPath"
          :draft="pageActions"
          :labels="{ save: labels.save, discard: labels.discard, unsavedChanges: labels.unsavedChanges }"
          @save="pageActions?.save()"
          @discard="pageActions?.discard()"
          @select-tab="router.push($event)"
        />
        <div
          class="platform-page-body platform-page-gutter"
          :class="{ 'own-header': shownPage?.ownHeader === true, 'own-frame': shownPage === null, 'browser-workspace': browserWorkspace, 'tabbed-workspace': pageTabs.length > 0 }"
        >
          <RouterView />
        </div>
      </div>
    </div>
    <template v-else>
      <PlatformPageHeader
        v-if="headerShown"
        :title="headerTitle"
        :description="headerDescription"
        :tabs="pageTabs.length > 0 ? pageTabs : undefined"
        :active-path="activeTabPath"
        :draft="pageActions"
        :labels="{ save: labels.save, discard: labels.discard, unsavedChanges: labels.unsavedChanges }"
        @save="pageActions?.save()"
        @discard="pageActions?.discard()"
        @select-tab="router.push($event)"
      />
      <div v-if="blocked" class="platform-blocked" role="alert">{{ blocked.message }}</div>
      <!--
        A page that draws its own header carries its own gutter; every other page gets it here, once, with the header's.
      -->
      <div
        v-else
        class="platform-page-body platform-page-gutter"
        :class="{ 'own-header': shownPage?.ownHeader === true, 'own-frame': shownPage === null, 'browser-workspace': browserWorkspace, 'tabbed-workspace': pageTabs.length > 0 }"
      >
        <RouterView />
      </div>
    </template>
  </PlatformShell>
</template>

<style scoped>
/*
 * The page area is the application's: it fills the surface beside the rail. Its side padding is the header's gutter
 * (`platform-page-gutter`), so a title, a toolbar and the content under them start at the same place and no page writes
 * a side padding of its own.
 */
.platform-page-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: auto;
  padding-block: var(--page-content-gap) var(--spacing-xl);
  container: platform-page / inline-size;
}
.platform-page-body.tabbed-workspace {
  padding-top: var(--spacing-sm);
}
/*
 * A page with a header of its own carries that header's gutter, and so does an application whose pages are not in the
 * navigation (the dashboards, the scheduled tasks): its own frame takes the gutter, so it is not given twice.
 */
.platform-page-body.own-header,
.platform-page-body.own-frame {
  padding: 0;
}
.platform-page-body.browser-workspace {
  padding: 0;
  overflow: hidden;
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
.app-menu-title {
  display: flex;
  align-items: center;
  min-height: 36px;
  margin: 0;
  padding: 0 10px;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  line-height: var(--leading-lg);
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
