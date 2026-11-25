<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import {readHomeState,HOME_PREFERENCES_CHANGED} from './features/home/api';
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import {
  confirmDanger,
  pageAdmissionKey,
  platformApplicationNameKey,
  pilotPageKey,
  platformPageAccessKey,
  provideApplicationFrame,
  provideApplicationTheme,
  providePageActions,
  providePageHeading,
  provideUnsavedChanges,
} from "@ontomato/platform-shell";
import { usePlatformHost, type PlatformPage } from "@ontomato/platform-admin";
import PlatformLayout from "./PlatformLayout.vue";
import { localeAutonyms } from "./locale-names";
import type { PlatformShownPage } from "./PlatformLayout.vue";
import { appDeclarations } from "./partition";
import { catalogPartition, type NativeLayout } from "./native-layouts";
import type { PlatformBrand } from "@ontomato/platform-shell";
import { isPanelApplication } from "@ontomato/contracts/platform-identity";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { builtinApplicationForPath, panelEntryApplication, resetApplicationCatalog, useApplicationCatalog } from "./catalog";
import { ApiRequestError, nodeApiRequest } from "@ontomato/workbench-ui";
import { resolveApplicationEntry } from "./panel-host";
import { appAt } from "./apps";
import { pilotPageResolver as resolvePilotPages } from "./pilot-pages";
import { providePlatformPageCounter } from "./page-counter";
import { createRecentVisitReporter, recentDestination } from "./recent-work";
import { openApplicationKey, platformApplicationsKey, platformBrandKey, type PlatformAppDeclaration } from "./apps";
import { useApplicationOpening } from "./application-opening";
import { installPanelApplicationOpener } from "./panel-navigate";
import { agentBuilderShortcut } from "./application-shortcuts";

/**
 * The platform's one shell around the router: the rail, the current application's column and the page area, with the
 * platform's host supplying the language, theme and account.
 *
 * It reads the navigation the host publishes rather than keeping a list of its own, so the column, the page header and
 * the router guard all come from the same pages and the same permission codes.
 */
const props = defineProps<{
  /** Edition-owned page layouts and link launchers; the catalog owns application metadata. */
  renderers?: Record<string, NativeLayout>;
  /** The edition's mark; its name defaults to the platform's service name. */
  brand?: Omit<PlatformBrand, "name"> & { name?: string };
  standaloneApplications?: readonly string[];
}>();

const host = usePlatformHost();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const catalog = useApplicationCatalog();
const pinnedAppIds=ref<string[]>([]);
const dynamicAppIds=computed(()=>catalog.mergedApplications.value.filter(app=>['hosted','connected','link'].includes(app.kind)).map(app=>app.id));
async function readShortcuts(){try{pinnedAppIds.value=(await readHomeState()).favorites.filter(item=>item.kind==='application').map(item=>item.id);}catch{/* Shortcut discovery must not prevent opening the platform. */}}
const railVisible = ref(false);
let railDataLoaded = false;
function loadRailData() {
  if (railDataLoaded) return;
  railDataLoaded = true;
  void host.access.load();
  void readShortcuts();
  void catalog.ensureCatalog();
}
watch(railVisible, (visible) => {
  if (visible) loadRailData();
});
function onHomePreferencesChanged() {
  if (railVisible.value) void readShortcuts();
}
onMounted(() => { window.addEventListener(HOME_PREFERENCES_CHANGED, onHomePreferencesChanged); });
onBeforeUnmount(() => {
  window.removeEventListener(HOME_PREFERENCES_CHANGED, onHomePreferencesChanged);
  resetApplicationCatalog();
});
// The home and application gallery list every application, so entering them ensures the catalog; returning to home refreshes it.
watch(
  () => route.path === platformRoutes.home.path || route.path === platformRoutes.applicationGallery.path,
  (needsCatalog) => { if (needsCatalog) void catalog.ensureCatalog(); },
  { immediate: true },
);
watch(() => route.path === platformRoutes.home.path, (home) => { if (home) void catalog.refresh(); });
/** The rail's placeholders stand in for a list it does not have yet; a later read keeps the rows it shows. */
const railLoading = computed(() => catalog.loading.value && catalog.applications.value.length === 0);
/** Whether the shown application draws its own frame in its area (its page writes it). */
const appFramed = provideApplicationFrame();
const partition = computed(() => catalogPartition(catalog.mergedApplications.value, host.preferences.locale.value, props.renderers));

const declarations = computed<PlatformAppDeclaration[]>(() =>
  appDeclarations(host.navigation.value, host.access, partition.value, (key) => t(key)),
);
// Static native routes opened standalone without the rail still need their owning application summary to verify `allowStandalone`.
watch(
  [railVisible, () => route.path, () => Boolean(appAt(declarations.value, route.path))],
  ([visible, path, hasApp]) => {
    if (visible || hasApp || path.startsWith("/applications/") || route.meta.standaloneApplication === true) return;
    void catalog.ensureCatalog();
  },
  { immediate: true, flush: "post" },
);
// Ensure any cross-application built-in whose panel entries appear inside the active application's menu (for example,
// permissions entries shown under ontology governance) has its entry table loaded on demand.
watch(
  [() => route.path, () => partition.value],
  async ([path, parts]) => {
    const active = appAt(declarations.value, path);
    const activePart = active ? parts.find((part) => part.id === active.id) : null;
    const sectionPaths = activePart?.sections.flatMap(section => "paths" in section ? section.paths : []) ?? [];
    const owners = new Set(sectionPaths.flatMap(entryPath => {
      const owner = builtinApplicationForPath(entryPath);
      return owner && owner.panelUses === undefined ? [owner.id] : [];
    }));
    await Promise.all([...owners].map(id => catalog.ensureApplication(id)));
  },
  { immediate: true },
);
const agentBuilder = computed(() => agentBuilderShortcut(
  declarations.value,
  host.access.canEnter(platformRoutes.agents.path),
  t("platform.agentBuilder"),
));
const railDeclarations = computed(() => agentBuilder.value ? [...declarations.value, agentBuilder.value] : declarations.value);

/** The page the navigation names for this address; a screen of a page (a detail) names the page it belongs to. */
function pageAt(path: string): PlatformPage | undefined {
  return host.navigation.value.pages.find((page) => page.path === route.meta.page) ??
    host.navigation.value.pages.find((page) => page.path === path);
}

/** What a page the navigation does not name says of itself: a panel application's entry, its name and its way back. */
const heading = providePageHeading();

const shownPage = computed<PlatformShownPage | null>(() => {
  const page = pageAt(route.path);
  if (heading.value) {
    return {
      title: heading.value.title,
      description: heading.value.backLabel ? null : (heading.value.description ?? (page?.descriptionKey ? t(page.descriptionKey) : null)),
      named: true,
      back: heading.value.back,
      backLabel: heading.value.backLabel,
      externalLink: heading.value.externalLink,
    };
  }
  if (!page) return null;
  return {
    title: t(page.titleKey),
    description: page.descriptionKey ? t(page.descriptionKey) : null,
    ownHeader: route.meta.ownHeader === true || page.ownHeader === true,
  };
});

/** The account's name in the rail's menu; null in an edition without sign-in. */
const account = computed(() => host.account && { userName: host.account.userName, signOut: host.account.signOut });

const preferences = computed(() => ({
  locales: host.preferences.locales,
  locale: host.preferences.locale.value,
  setLocale: host.preferences.setLocale,
  theme: host.preferences.theme.value,
  setTheme: host.preferences.setTheme,
}));

const labels = computed(() => ({
  back: t("common.back"),
  more: t("common.more"),
  collapse: t("common.collapse"),
  copyExternalLink: t("platform.copyExternalLink"),
  externalLinkCopied: t("platform.externalLinkCopied"),
  expandRail: t("platform.expandRail"),
  collapseRail: t("platform.collapseRail"),
  applications: t("platform.apps"),
  home: t("ontology.productHomeTitle"),
  builtApplication: t("platform.builtApplication"),
  brand: t("platform.serviceName"),
  account: t("platform.account"),
  language: t("platform.language"),
  theme: { light: t("platform.themeLight"), dark: t("platform.themeDark") },
  signOut: t("platform.signOut"),
  opensInNewTab: t("platform.openInNewTab"),
  openStandalone: t("platform.openStandalone"),
  pages: t("platform.pages"),
  save: t("platform.save"),
  discard: t("platform.discard"),
  unsavedChanges: t("platform.unsavedChanges"),
}));

/** The rail's rows and every page inside (the home's cards, the app builder) open applications through this entry. */
const openApplication = useApplicationOpening(declarations, id => props.standaloneApplications?.includes(id) ?? false);
const uninstallApplicationOpener = installPanelApplicationOpener((address, { beside }) => {
  const match = declarations.value.find((app) => app.prefix === address || (Boolean(app.home) && app.home === address));
  if (!match) return false;
  const externalOrStandalone = Boolean(match.open || match.href || props.standaloneApplications?.includes(match.id));
  if (beside && !externalOrStandalone) return false;
  openApplication(match.id);
  return true;
});
onBeforeUnmount(uninstallApplicationOpener);
function selectRailApp(id: string) {
  if (id !== "agent-builder") openApplication(id);
  else if (agentBuilder.value?.home) void router.push(agentBuilder.value.home);
}
provide(openApplicationKey, openApplication);
provide(platformApplicationsKey, declarations);
const shellBrand = computed<PlatformBrand>(() => ({ ...props.brand, name: props.brand?.name ?? t("platform.serviceName") }));
provide(platformBrandKey, shellBrand);

const recentVisit = computed(() => {
  if (catalog.error.value || host.blocked?.value) return null;
  const app = appAt(declarations.value, route.path);
  if (!app) return null;
  const catalogApp = catalog.applicationById(app.id);
  const destination = recentDestination(route, app, {
    panelApplication: Boolean(catalogApp && isPanelApplication(catalogApp)),
  });
  return destination ? JSON.stringify(destination) : null;
});
const recentVisitReporter = createRecentVisitReporter((destination) => {
  void nodeApiRequest("/api/personal-workspace/recent", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: destination,
  }).catch(() => { /* Recording a visit must not interrupt the page being opened. */ });
});
watch(recentVisit, (destination) => {
  recentVisitReporter.schedule(destination);
}, { immediate: true });
onBeforeUnmount(() => recentVisitReporter.cancel());

/** Each language retains its own name when the UI locale changes. */
const localeNames = computed(() =>
  Object.fromEntries(host.preferences.locales.map((code) => [code, localeAutonyms[code] ?? code])),
);

/** What the shown page hands to its header: the frame reads it, the header presents it. */
const pageActions = providePageActions();
/** What the shown entry's application assigns in its area, written by the application's page. */
const appTheme = provideApplicationTheme();

/**
 * The pages the platform's assembly can mount beside a conversation: the conversation application asks for one by
 * address and hands over its own navigation, so it never imports another application's page.
 */
provide(pilotPageKey, resolvePilotPages);


/** The one counter a page at its own address sends its message to. */
providePlatformPageCounter(router);

/**
 * Leaving a draft with unsaved changes asks first: before the address leaves every page that edits it, and before the
 * document is closed or reloaded. The drafts stay the pages'; this frame only asks.
 */
const unsaved = provideUnsavedChanges(() =>
  confirmDanger(t("admin.leaveUnsavedConfirm"), t("admin.unsavedChanges"), {
    confirmButtonText: t("admin.leaveWithoutSaving"),
    cancelButtonText: t("common.cancel"),
  }),
);
const removeLeaveCheck = router.beforeEach((to) => unsaved.allows(to.path, to.fullPath));
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!unsaved.dirty()) return;
  event.preventDefault();
  event.returnValue = "";
}
window.addEventListener("beforeunload", warnBeforeUnload);
onBeforeUnmount(() => {
  removeLeaveCheck();
  window.removeEventListener("beforeunload", warnBeforeUnload);
});

/**
 * Whether the account may open a page of the navigation: the applications whose column is their own (the agent
 * platform, knowledge governance) list an entry from it, by the same rule the guard and the menus read.
 */
function authorizedPath(path: string) {
  const { meta } = router.resolve(path);
  return typeof meta.entryPath === "string" ? meta.entryPath : typeof meta.page === "string" ? meta.page : path;
}
const hasPageAccess = (path: string) => host.access.canEnter(authorizedPath(path));

provide(platformPageAccessKey, hasPageAccess);
provide(pageAdmissionKey, async (address: string) => {
  const path = address.replace(/^#/, "").split("?")[0] ?? "";
  if (!path.startsWith("/") || path.startsWith("//")) {
    return { ok: false, reason: "unsupported_target", error: { code: "UNSUPPORTED_TARGET", message: "Expected a site-relative path" } };
  }
  try {
    const resolved = await resolveApplicationEntry({ path: authorizedPath(path) });
    if (!panelEntryApplication(path)) await catalog.ensureApplication(resolved.applicationId);
    return { ok: true, openedEntry: resolved };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 403) {
      return { ok: false, reason: "forbidden", error: { code: "FORBIDDEN", message: error.message } };
    }
    if (error instanceof ApiRequestError && error.status === 404) {
      return {
        ok: false,
        reason: path.startsWith("/applications/") ? "not_found" : "unsupported_target",
        error: { code: "NOT_FOUND", message: error.message },
      };
    }
    return {
      ok: false,
      reason: "forbidden",
      error: { code: "ACCESS_CHECK_FAILED", message: error instanceof Error ? error.message : String(error) },
    };
  }
});
provide(platformApplicationNameKey, (id: string) => declarations.value.find((app) => app.id === id)?.label ?? id);

/**
 * Why the platform shows no applications, if it shows none: the edition's licence is not in force, or the account holds
 * no page at all. The decision is the host's — it knows about licences and permissions — and this layout only renders
 * the answer: no applications, no column, the account menu alone, and the reason in the page area.
 */
const blocked = computed(() => {
  const blocked = host.blocked?.value;
  if (blocked) return { reason: blocked.reason, message: t(blocked.messageKey) };
  return null;
});
</script>

<template>
  <PlatformLayout
    :apps="railDeclarations"
    :dynamic-app-ids="dynamicAppIds"
    :pinned-app-ids="pinnedAppIds"
    :loading="railLoading"
    :shown-page="shownPage"
    :account="account"
    :preferences="preferences"
    :locale-names="localeNames"
    :labels="labels"
    :brand="shellBrand"
    :page-actions="pageActions"
    :app-theme="appTheme"
    :app-framed="appFramed"
    :standalone-applications="standaloneApplications"
    :blocked="catalog.error.value ? { reason: 'no-pages', message: catalog.error.value } : blocked"
    @select-app="selectRailApp"
    @rail-visible="railVisible = $event"
  />
</template>
