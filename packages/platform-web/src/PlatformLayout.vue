<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { copyExternalLink, externalLinkTab, rememberExternalLinkTab } from "./external-link";
import { useRoute, useRouter, RouterView, RouterLink } from "vue-router";
import { Link } from "lucide-vue-next";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import type { PanelThemeOverrides } from "@ontomato/contracts/panel-manifest";
import {
  AppPanelPages,
  PlatformPageHeader,
  PlatformShell,
  useAppTheme,
  type PlatformAccount,
  type PlatformBrand,
  type PlatformPageActions,
  type PlatformPreferences,
  type PlatformShellLabels,
} from "@ontomato/platform-shell";
import type { PlatformAppDeclaration } from "./apps";
import { railApp } from "./apps";
import {applicationShortcuts} from './application-shortcuts';

/**
 * The page the current address shows: its words, and whether it draws its own header. Which application it belongs to is
 * not given here: the address decides that, so the shell cannot name one application while showing another's page.
 */
export interface PlatformShownPage {
  title: string;
  description?: string | null;
  /** The page draws its own header (the ontology manager's pages, the conversation). */
  ownHeader?: boolean;
  /**
   * The page named itself (a panel application's entry): its title stands whether or not the application has a menu.
   */
  named?: boolean;
  /** Back to where the reader came from, for a page the application's menu does not reach. */
  back?: () => void;
  /** Optional custom label for the header back control (for example a detail view returning to its catalog). */
  backLabel?: string;
  /** The entry's external link (its address with its state), which the header's "more" offers to copy. */
  externalLink?: string;
}

const props = defineProps<{
  /** The applications the account may see, in rail order. */
  apps: readonly PlatformAppDeclaration[];
  dynamicAppIds?:readonly string[];
  pinnedAppIds?:readonly string[];
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
  /** The shown entry's application theme, assigned on the application's area: its menu and its page, never the rail. */
  appTheme?: PanelThemeOverrides | null;
  /** The shown application draws its own frame in its area: no menu column, header or gutter of the platform's. */
  appFramed?: boolean;
  /** The host shows no application at all (its licence is not in force, or the account holds no page). */
  blocked?: { reason: "licence" | "no-pages"; message: string } | null;
}>();

/** The application's area: its menu column and its page, beside the platform's rail and account area. */
const appBody = ref<HTMLElement | null>(null);
useAppTheme(appBody, () => props.appTheme, () => props.preferences.theme);

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
const railApps = computed(() => applicationShortcuts(props.apps??[],props.dynamicAppIds??[],props.pinnedAppIds??[],activeAppId.value).map(app => {
  // An application the reader opens from the rail opens in the platform; its external link is copied from its header.
  return railApp(app, () => emit('selectApp', app.id));
}));
const navigationContext=computed(()=>{
  if(route.query.navigationContext!=='ontology')return null;
  const app=props.apps.find(app=>app.id==='ontology');
  const page=(route.meta.page as string|undefined)??route.path;
  return app?.groups?.some(group=>group.pages.some(item=>item.id===page))?app:null;
});
const activeAppId = computed(() => navigationContext.value?.id??appFor(route.path)?.id ?? null);
const activeApp = computed(() => props.apps.find((app) => app.id === activeAppId.value) ?? null);
/**
 * An external link's tab (big main's ruling, 2026-11-21): an address the reader opened with `standalone=1` shows the
 * application without the platform's rail (and so without its account area); everything else - the menu or the
 * application's frame, the page header with its commands, the content, the composer - is drawn as in the platform. The
 * tab stays so as the reader goes to another entry, another application or a conversation; each entry is admitted as
 * ever.
 */
/** The header's "more": the entry's external link, when the page shown is an entry of an application. */
const moreActions = computed(() => props.shownPage?.externalLink
  ? [{ id: "copy-external-link", label: props.labels.copyExternalLink, icon: Link,
    onClick: () => void copyExternalLink(props.shownPage!.externalLink!, { copied: props.labels.externalLinkCopied, title: props.labels.copyExternalLink }) }]
  : []);
const externalTab = ref(externalLinkTab());
watch(() => route.query.standalone, (flag) => {
  if (flag !== '1' || externalTab.value) return;
  externalTab.value = true;
  rememberExternalLinkTab();
}, { immediate: true });
const browserWorkspace = computed(() => route.path === "/browser/data" || route.path.startsWith("/browser/data/"));

/**
 * An application whose pages are its own menu (the ontology manager, the system settings, the permissions) draws that
 * menu in its column, headed by the application's name, with its own entry at the foot (DESIGN.md "Platform shell and
 * layout"). The current row is the page the address shows: a screen of a page (a detail) marks that page.
 */
const menu = computed(() => (activeApp.value?.frame === "menu" && !props.appFramed ? activeApp.value : null));
const activePageId = computed(() => (route.meta.page as string | undefined) ?? route.path);
function selectMenuPage(path:string){
  const external=activeApp.value?.id==='ontology'&&!path.startsWith('/ontology/');
  void router.push({path,query:external?{navigationContext:'ontology'}:{}});
}

/**
 * The one header above the page: in a menu application it names the page (the application's name heads the column);
 * an application of one page is named by its own header (the object browser). A page that draws its own header (the
 * ontology manager's, the external MCP services) is left to draw it, so no page has two.
 */
const headerTitle = computed(() =>
  (props.shownPage?.named || menu.value ? props.shownPage?.title : activeApp.value?.label) ?? props.shownPage?.title ?? "");
// A page that names itself with a description of its own (a panel entry's) says it, as the page it names.
const headerDescription = computed(() =>
  (menu.value || (props.shownPage?.named && props.shownPage.description) ? props.shownPage?.description : activeApp.value?.description)
    ?? props.shownPage?.description ?? null,
);
const headerShown = computed(() => !props.blocked && props.shownPage !== null && !props.shownPage.ownHeader && !props.appFramed);
const headerLabels = computed(() => ({
  save: props.labels.save,
  discard: props.labels.discard,
  unsavedChanges: props.labels.unsavedChanges,
}));
</script>

<template>
  <PlatformShell
    :loading="loading"
    :hide-rail="externalTab"
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
    <div ref="appBody" class="platform-app-body" :class="{ 'has-menu': menu !== null && !blocked }">
      <aside v-if="menu && !blocked" class="platform-app-menu" :aria-label="labels.pages">
        <h2 class="app-menu-title">{{ menu.label }}</h2>
        <select class="mobile-page-select" :aria-label="labels.pages" :value="activePageId" @change="selectMenuPage(($event.target as HTMLSelectElement).value)"><optgroup v-for="group in menu.groups??[]" :key="group.key" :label="group.label||menu.label"><option v-for="page in group.pages" :key="page.id" :value="page.id" :disabled="!!page.unavailableHint">{{page.label}}</option></optgroup><option v-if="menu.foot" :value="menu.foot.id">{{menu.foot.label}}</option></select>
        <AppPanelPages
          class="app-menu-pages"
          :groups="menu.groups ?? []"
          :foot="menu.foot"
          :active-page-id="activePageId"
          @select-page="selectMenuPage"
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
          :back-label="shownPage?.back ? (shownPage.backLabel ?? labels.back) : undefined"
          :more="moreActions"
          :more-label="labels.more"
          @back="shownPage?.back?.()"
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
          :class="{ 'own-header': shownPage?.ownHeader === true, 'own-frame': shownPage === null || appFramed, 'browser-workspace': browserWorkspace }"
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
.platform-page-body.browser-workspace,
.platform-page-body:has(> .panel-application-area),
.platform-page-body:has(> .panel-host) {
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
  overflow: hidden;
  min-height: 0;
}
/* The groups fill the column, so the application's own entry sits at its foot. */
/*
 * The pages' list fills the room the title leaves, so the foot sits at the bottom of the column. The list draws itself at
 * least as tall as its parent; under the title that is one title too tall and pushes the foot out of view.
 */
.platform-app-menu > .app-menu-pages {
  flex: 1 1 0;
  min-height: 0;
  height: auto;
}
.app-menu-title {
  flex-shrink: 0;
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
.mobile-page-select{display:none}
@media(max-width:600px){
  .platform-app-body.has-menu{flex-direction:column;min-width:0}
  .platform-app-menu{flex:0 0 auto;width:100%;padding:var(--spacing-sm) var(--page-gutter);border-right:0;border-bottom:1px solid var(--el-border-color);flex-direction:row;align-items:center;gap:var(--spacing-md)}
  .app-menu-title{min-height:28px;font-size:var(--text-sm);padding-inline:var(--spacing-sm)}
  .platform-app-menu>.app-menu-pages{display:none}
  .app-menu-title{padding:0;white-space:nowrap}
  .mobile-page-select{display:block;flex:1;min-width:0;max-width:100%;height:var(--control-height);padding:var(--spacing-xs) var(--spacing-sm);border:1px solid var(--el-border-color);border-radius:var(--radius-sm);background:var(--el-bg-color);color:var(--el-text-color-primary);font:inherit;font-size:var(--text-sm)}
  .platform-app-page{flex:1;overflow:hidden}
}
</style>
