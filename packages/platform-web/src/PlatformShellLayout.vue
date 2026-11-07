<script setup lang="ts">
import { computed, provide } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { usePageActionsOf, usePlatformHost, type PlatformPage } from "@ontomato/platform-admin";
import PlatformLayout from "./PlatformLayout.vue";
import type { PlatformShownPage } from "./PlatformLayout.vue";
import { appDeclarations } from "./partition";
import { appPartition, appPartitionKey, type PartitionOptions } from "./app-partition";
import type { PlatformAppDeclaration } from "./apps";

/**
 * The platform's one shell around the router: the rail, the current application's column and the page area, with the
 * platform's host supplying the language, theme and account.
 *
 * It reads the navigation the host publishes rather than keeping a list of its own, so the column, the page header and
 * the router guard all come from the same pages and the same permission codes.
 */
const props = defineProps<{
  /** Applications only this edition has (its external ones); the platform's own are always the same. */
  apps?: PartitionOptions;
}>();

const host = usePlatformHost();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/** This edition's applications in rail order; the pages under the shell read the same list (`appPartitionKey`). */
const partition = computed(() => appPartition(props.apps));
provide(appPartitionKey, partition);

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

/** Where an application's rail row goes: the address its declaration carries (worked out in `appDeclarations`). */
function homeOf(app: PlatformAppDeclaration): string | null {
  return app.home ?? null;
}

function selectApp(id: string) {
  const app = declarations.value.find((candidate) => candidate.id === id);
  // An external application is opened by the rail itself; nothing here makes it current.
  const path = app ? homeOf(app) : null;
  if (path) void router.push(path);
}

/** Language names: the platform's own tree names each supported locale. */
/** Language names: the platform's own tree names each supported locale. */
const localeNames = computed(() =>
  Object.fromEntries(host.preferences.locales.map((code) => [code, t(`lang.${code.replace("-", "")}`)])),
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
    :shown-page="shownPage"
    :account="account"
    :preferences="preferences"
    :locale-names="localeNames"
    :labels="labels"
    :page-actions="pageActions"
    :blocked="blocked"
    @select-app="selectApp"
  />
</template>
