<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { clearExternalLinkTab, copyExternalLink, externalLinkTab, rememberExternalLinkTab } from "./external-link";
import { allowsStandalone } from "@ontomato/contracts/platform-identity";
import type { PanelCurrentUser } from "@ontomato/contracts/panel-host";
import { useRoute, useRouter, RouterView, RouterLink } from "vue-router";
import { Link } from "lucide-vue-next";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import type { PanelThemeOverrides } from "@ontomato/contracts/panel-manifest";
import { authHost } from "@ontomato/workbench-ui/utils/auth";
import {
  PlatformPageHeader,
  PlatformShell,
  panelOverlayContainerKey,
  platformCurrentUserKey,
  useAppTheme,
  type AppMenuGroup,
  type PlatformAccount,
  type PlatformBrand,
  type PlatformPageActions,
  type PlatformPreferences,
  type PlatformShellLabels,
} from "@ontomato/platform-shell";
import ApplicationFrameHost, { type ApplicationFrameSpec } from "./ApplicationFrameHost.vue";
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
  standaloneApplications?: readonly string[];
  /** The host shows no application at all (its licence is not in force, or the account holds no page). */
  blocked?: { reason: "licence" | "no-pages"; message: string } | null;
}>();

const currentUser = computed<PanelCurrentUser | null>(() => {
  const fromAccount = props.account?.userName?.trim();
  if (fromAccount) return { displayName: fromAccount };
  try {
    const fromAuth = authHost().getUserInfo()?.userName?.trim();
    return fromAuth ? { displayName: fromAuth } : null;
  } catch {
    return null;
  }
});
provide(platformCurrentUserKey, currentUser);

/** The application's area: its menu column and its page, beside the platform's rail and account area. */
const appBody = ref<HTMLElement | null>(null);
useAppTheme(appBody, () => props.appTheme, () => props.preferences.theme);
provide(panelOverlayContainerKey, appBody);

const emit = defineEmits<{ selectApp: [id: string]; railVisible: [visible: boolean] }>();

/** The application whose prefix holds an address, the longest match winning: the rail's current row follows the address. */
function appFor(path: string): PlatformAppDeclaration | null {
  let match: PlatformAppDeclaration | null = null;
  for (const app of props.apps ?? []) {
    // The application gallery owns `/applications` alone; `/applications/<id>` belongs to that application.
    if (path !== app.prefix && (app.id === "application-gallery" || !path.startsWith(`${app.prefix}/`))) continue;
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
const standaloneRequested = ref(route.query.standalone === "1");
const standaloneAllowed = computed(() => allowsStandalone(activeApp.value));
const hideRail = computed(() => {
  if (route.meta.standaloneApplication === true) return true;
  if (activeAppId.value && props.standaloneApplications?.includes(activeAppId.value)) return true;
  if (!standaloneAllowed.value) return false;
  if (externalTab.value) return true;
  return route.query.standalone === "1" || standaloneRequested.value;
});
watch(hideRail, (hidden) => emit("railVisible", !hidden), { immediate: true });
watch(
  [() => route.query.standalone, () => activeApp.value],
  ([flag, app]) => {
    if (flag === "1") standaloneRequested.value = true;
    if (app && !allowsStandalone(app)) {
      standaloneRequested.value = false;
      if (externalTab.value) {
        externalTab.value = false;
        clearExternalLinkTab();
      }
      if (flag !== undefined) {
        const { standalone: _dropped, ...rest } = route.query;
        void router.replace({ path: route.path, query: rest, hash: route.hash });
      }
      return;
    }
    if (!standaloneRequested.value || externalTab.value) return;
    if (app === null) return;
    standaloneRequested.value = false;
    externalTab.value = true;
    rememberExternalLinkTab();
  },
  { immediate: true },
);
/**
 * Any route belonging to an application with a declared frame panel (hybrid built-in applications such as Ontology
 * manager, native built-in applications such as System settings, or pure panel applications) runs inside the single
 * persistent outer frame host so switching between native pages and panel entries never tears down the frame.
 */
const activePageId = computed(() => (route.meta.page as string | undefined) ?? route.path);
const applicationFrame = computed<ApplicationFrameSpec | null>(() => {
  // Edition-owned standalone routes already provide their own layout.
  if (props.blocked || route.meta.standaloneApplication === true) return null;
  const app = activeApp.value;
  if (!app?.framePanelId) return null;
  const groups: AppMenuGroup[] = (app.groups ?? []).map((group) => ({
    key: group.key,
    ...(group.label ? { label: group.label } : {}),
    items: group.pages,
  }));
  return {
    applicationId: app.id,
    framePanelId: app.framePanelId,
    title: app.label,
    groups: groups.length > 0 ? groups : null,
    activePageId: activePageId.value,
    ...(app.singleEntry !== undefined ? { singleEntry: app.singleEntry } : {}),
  };
});

/**
 * The one header above the page: in a framed menu application it names the page (the application's name heads the
 * column); an application of one page is named by its own header (the object browser). A page that draws its own header
 * (the ontology manager's, the external MCP services) is left to draw it, so no page has two.
 */
const hasFrameMenu = computed(() => Boolean(applicationFrame.value && !applicationFrame.value.singleEntry));
const headerTitle = computed(() =>
  (props.shownPage?.named || hasFrameMenu.value ? props.shownPage?.title : activeApp.value?.label) ?? props.shownPage?.title ?? "");
// A page that names itself with a description of its own (a panel entry's) says it, as the page it names.
const headerDescription = computed(() =>
  (hasFrameMenu.value || (props.shownPage?.named && props.shownPage.description) ? props.shownPage?.description : activeApp.value?.description)
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
    :hide-rail="hideRail"
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
      One page area for every application, so the page is mounted once even when the catalog arrives after initial
      render: ApplicationFrameHost keeps the page in place and moves it into `<current-entry>` once the frame attaches.
    -->
    <div ref="appBody" class="platform-app-body">
      <ApplicationFrameHost :frame="applicationFrame" :blocked="Boolean(blocked)">
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
            :class="{ 'own-header': shownPage?.ownHeader === true, 'own-frame': shownPage === null || appFramed }"
          >
            <RouterView />
          </div>
        </div>
      </ApplicationFrameHost>
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
@media(max-width:600px){
  .platform-app-page{flex:1;overflow:hidden}
}
</style>
