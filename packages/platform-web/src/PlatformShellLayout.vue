<script setup lang="ts">
import { computed, onBeforeUnmount, provide, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessageBox } from "element-plus";
import {
  agentModelLabelsKey,
  platformApplicationNameKey,
  platformPageAccessKey,
  providePageActions,
  provideUnsavedChanges,
  type AgentModelLabels,
} from "@ontomato/platform-shell";
import { availablePages, usePlatformHost, type PlatformPage } from "@ontomato/platform-admin";
import PlatformLayout from "./PlatformLayout.vue";
import { localeAutonyms } from "./locale-names";
import type { PlatformShownPage } from "./PlatformLayout.vue";
import { appDeclarations } from "./partition";
import { catalogPartition, type NativeLayout } from "./native-layouts";
import type { PlatformBrand } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "./catalog";
import { nodeApiRequest } from "@ontomato/workbench-ui";
import { appAt } from "./apps";
import { recentDestination } from "./recent-work";
import { openApplicationKey, platformApplicationsKey, platformBrandKey, type PlatformAppDeclaration } from "./apps";
import { useApplicationOpening } from "./application-opening";
import { workspaceObjectHostKey } from "@ontomato/contracts/workspace-objects";
import { createWorkspaceObjectHost } from "./workspace-objects";

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
}>();

const host = usePlatformHost();
const { t, te } = useI18n();
const route = useRoute();
const router = useRouter();
provide(workspaceObjectHostKey, createWorkspaceObjectHost());

const catalog = useApplicationCatalog();
watch(() => host.navigation.value, () => { void catalog.refresh(); }, { immediate: true, deep: true });
// The home lists every application, so returning to it reads the catalog again; the first read above covers a shell
// mounted on the home.
watch(() => route.path === platformRoutes.home.path, (home) => { if (home) void catalog.refresh(); });
/** The rail's placeholders stand in for a list it does not have yet; a later read keeps the rows it shows. */
const railLoading = computed(() => catalog.loading.value && catalog.applications.value.length === 0);
const partition = computed(() => catalogPartition(catalog.applications.value, host.preferences.locale.value, props.renderers));

const declarations = computed<PlatformAppDeclaration[]>(() =>
  appDeclarations(host.navigation.value, host.access, partition.value, (key) => t(key)),
);

/** The page the navigation names for this address; a screen of a page (a detail) names the page it belongs to. */
function pageAt(path: string): PlatformPage | undefined {
  return host.navigation.value.pages.find((page) => page.path === route.meta.page) ??
    host.navigation.value.pages.find((page) => page.path === path);
}

const shownPage = computed<PlatformShownPage | null>(() => {
  const page = pageAt(route.path);
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
  expandRail: t("platform.expandRail"),
  collapseRail: t("platform.collapseRail"),
  applications: t("platform.apps"),
  brand: t("platform.serviceName"),
  account: t("platform.account"),
  language: t("platform.language"),
  theme: { light: t("platform.themeLight"), dark: t("platform.themeDark") },
  signOut: t("platform.signOut"),
  opensInNewTab: t("platform.openInNewTab"),
  pages: t("platform.pages"),
  save: t("platform.save"),
  discard: t("platform.discard"),
  unsavedChanges: t("platform.unsavedChanges"),
}));

/** The rail's rows and every page inside (the home's cards, the app builder) open applications through this entry. */
const openApplication = useApplicationOpening(declarations);
provide(openApplicationKey, openApplication);
provide(platformApplicationsKey, declarations);
const shellBrand = computed<PlatformBrand>(() => ({ ...props.brand, name: props.brand?.name ?? t("platform.serviceName") }));
provide(platformBrandKey, shellBrand);

const recentVisit = computed(() => {
  if (catalog.loading.value || catalog.error.value || host.blocked?.value) return null;
  const destination = recentDestination(route, appAt(declarations.value, route.path) ?? undefined);
  return destination ? JSON.stringify(destination) : null;
});
watch(recentVisit, destination => {
  if (destination) void nodeApiRequest("/api/personal-workspace/recent", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: destination,
  }).catch(() => { /* Recording a visit must not interrupt the page being opened. */ });
}, { immediate: true });

/** Each language retains its own name when the UI locale changes. */
const localeNames = computed(() =>
  Object.fromEntries(host.preferences.locales.map((code) => [code, localeAutonyms[code] ?? code])),
);

/** What the shown page hands to its header: the frame reads it, the header presents it. */
const pageActions = providePageActions();

/**
 * Leaving a draft with unsaved changes asks first: before the address leaves every page that edits it, and before the
 * document is closed or reloaded. The drafts stay the pages'; this frame only asks.
 */
const unsaved = provideUnsavedChanges(() =>
  ElMessageBox.confirm(t("admin.leaveUnsavedConfirm"), t("admin.unsavedChanges"), {
    type: "warning",
    confirmButtonText: t("admin.leaveWithoutSaving"),
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false,
  ),
);
const removeLeaveCheck = router.beforeEach((to) => unsaved.allows(to.path));
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
provide(platformPageAccessKey, (path: string) =>
  availablePages(host.navigation.value, host.access).some((page) => page.path === path),
);
provide(platformApplicationNameKey, (id: string) => declarations.value.find((app) => app.id === id)?.label ?? id);

/** The applications' model pages' words, in the platform's language. */
provide(
  agentModelLabelsKey,
  computed<AgentModelLabels>(() => ({
    title: t("platform.agentModels.title"),
    description: t("platform.agentModels.description"),
    followDefault: (model) => t("admin.followDomainDefault", { model: model ?? t("admin.noDefaultModel") }),
    unavailable: (id) => t("admin.modelUnavailable", { id }),
    missing: (id) => t("admin.modelSelectionMissing", { id }),
    backToDefault: t("admin.followDefaultAction"),
    agentName: (kind, fallback) => (te(`admin.ontologyAgentKinds.${kind}`) ? t(`admin.ontologyAgentKinds.${kind}`) : fallback),
    empty: t("platform.agentModels.empty"),
    loadFailed: t("admin.loadConfigFailed"),
    retry: t("common.retry"),
    saved: t("platform.agentModels.saved"),
    saveFailed: t("platform.agentModels.saveFailed"),
    discardTitle: t("admin.discardChanges"),
    discardMessage: t("admin.discardChangesConfirm"),
    cancel: t("common.cancel"),
    save: t("platform.save"),
    discard: t("platform.discard"),
    unsavedChanges: t("platform.unsavedChanges"),
  })),
);

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
    :apps="declarations"
    :loading="railLoading"
    :shown-page="shownPage"
    :account="account"
    :preferences="preferences"
    :locale-names="localeNames"
    :labels="labels"
    :brand="shellBrand"
    :page-actions="pageActions"
    :blocked="catalog.error.value ? { reason: 'no-pages', message: catalog.error.value } : blocked"
    @select-app="openApplication"
  />
</template>
