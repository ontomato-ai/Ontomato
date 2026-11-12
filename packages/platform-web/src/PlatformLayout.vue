<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter, RouterView } from "vue-router";
import {
  AppPanelPages,
  PlatformPageHeader,
  PlatformShell,
  type PlatformAccount,
  type PlatformBrand,
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
  brand?: PlatformBrand;
  /** What the shown page handed to its header: its own buttons and its draft's Save. */
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
// Keep the workspace directly accessible while its navigation entry is temporarily hidden.
const railApps = computed(() => (props.apps ?? []).filter(app => app.id !== "personal-workspace").map((app) => railApp(app, () => emit("selectApp", app.id))));
const activeAppId = computed(() => appFor(route.path)?.id ?? null);
const activeApp = computed(() => props.apps.find((app) => app.id === activeAppId.value) ?? null);
const browserWorkspace = computed(() => route.path === "/browser/data" || route.path.startsWith("/browser/data/"));

/**
 * An application whose pages are its own menu (the ontology manager, the system settings, the permissions) draws that
 * menu in its column, headed by the application's name, with its own entry at the foot (DESIGN.md "Platform shell and
 * layout"). The current row is the page the address shows: a screen of a page (a detail) marks that page.
 */
const menu = computed(() => (activeApp.value?.frame === "menu" ? activeApp.value : null));
const activePageId = computed(() => (route.meta.page as string | undefined) ?? route.path);

/**
 * The one header above the page: in a menu application it names the page (the application's name heads the column);
 * an application of one page is named by its own header (the object browser). A page that draws its own header (the
 * ontology manager's, the external MCP services) is left to draw it, so no page has two.
 */
const headerTitle = computed(() => (menu.value ? (props.shownPage?.title ?? "") : (activeApp.value?.label ?? "")));
const headerDescription = computed(() =>
  menu.value ? (props.shownPage?.description ?? null) : (activeApp.value?.description ?? null),
);
const headerShown = computed(() => !props.blocked && props.shownPage !== null && !props.shownPage.ownHeader);
const headerLabels = computed(() => ({
  save: props.labels.save,
  discard: props.labels.discard,
  unsavedChanges: props.labels.unsavedChanges,
}));
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
    <!--
      One page area for every application, so the page is mounted once: the menu of an application that has its own (the
      ontology manager) is inserted beside the page, never around it. Which application has a menu is known only when the
      catalog arrives, after the page has been drawn; a page area per case would mount the page a second time then.
    -->
    <div class="platform-app-body" :class="{ 'has-menu': menu !== null && !blocked }">
      <aside v-if="menu && !blocked" class="platform-app-menu" :aria-label="labels.pages">
        <h2 class="app-menu-title">{{ menu.label }}</h2>
        <AppPanelPages
          class="app-menu-pages"
          :groups="menu.groups ?? []"
          :foot="menu.foot"
          :active-page-id="activePageId"
          @select-page="router.push($event)"
        />
      </aside>
      <div class="platform-app-page">
        <PlatformPageHeader
          v-if="headerShown"
          :title="headerTitle"
          :description="headerDescription"
          :actions="pageActions?.actions"
          :draft="pageActions?.draft ?? null"
          :labels="headerLabels"
          @save="pageActions?.draft?.save()"
          @discard="pageActions?.draft?.discard()"
        />
        <div v-if="blocked" class="platform-blocked" role="alert">{{ blocked.message }}</div>
        <!--
          A page that draws its own header carries its own gutter; every other page gets it here, once, with the header's.
        -->
        <div
          v-else
          class="platform-page-body platform-page-gutter"
          :class="{ 'own-header': shownPage?.ownHeader === true, 'own-frame': shownPage === null, 'browser-workspace': browserWorkspace }"
        >
          <RouterView />
        </div>
      </div>
    </div>
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
  display: flex;
  flex-direction: column;
  flex: 0 0 var(--shell-app-column);
  width: var(--shell-app-column);
  box-sizing: border-box;
  padding: 14px 10px 12px;
  background: var(--shell-panel-bg);
  border-right: 1px solid var(--el-border-color);
  overflow-y: auto;
}
/* The groups fill the column, so the application's own entry sits at its foot. */
.app-menu-pages {
  flex: 1 0 auto;
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
