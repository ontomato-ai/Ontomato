<script setup lang="ts">
import { computed, provide, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { usePageActionsOf, usePlatformHost, type PlatformPage } from "@ontomato/platform-admin";
import PlatformLayout from "./PlatformLayout.vue";
import { localeAutonyms } from "./locale-names";
import type { PlatformShownPage } from "./PlatformLayout.vue";
import { appDeclarations } from "./partition";
import { catalogPartition, type NativeLayout } from "./native-layouts";
import type { PlatformBrand } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "./catalog";
import { openApplicationKey, platformApplicationsKey, platformBrandKey, type PlatformAppDeclaration } from "./apps";
import { useApplicationOpening } from "./application-opening";

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
const { t } = useI18n();
const route = useRoute();

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

/** The page the navigation names for this address; a tab names the page it is a screen of. */
function pageAt(path: string): PlatformPage | undefined {
  return host.navigation.value.pages.find((page) => page.path === route.meta.page) ??
    host.navigation.value.pages.find((page) => page.path === path);
}

const shownPage = computed<PlatformShownPage | null>(() => {
  const page = pageAt(route.path);
  if (!page) return null;
  return {
    title: page.title ?? t(page.titleKey),
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

/** Each language retains its own name when the UI locale changes. */
const localeNames = computed(() =>
  Object.fromEntries(host.preferences.locales.map((code) => [code, localeAutonyms[code] ?? code])),
);

const pageActions = usePageActionsOf();

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
