import type { App } from "vue";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
// Design foundation shared with the workbench (type, spacing, shape, density, elevation, motion, component variables).
import "@ontomato/design-tokens/foundation.css";
import { computed } from "vue";
import { Cable, Cpu, Puzzle, Plug } from "lucide-vue-next";
import { skillLibraryCount } from "@ontomato/workbench-ui/features/workbench";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { ontologyAgentModelPages } from "@ontomato/platform-shell";
import { useTheme } from "@ontomato/workbench-ui/composables/useTheme";
import { workbenchI18n, type SupportedLocale } from "@ontomato/workbench-ui/i18n";
import { managerDestination } from "@ontomato/platform-admin/legacy-manager";
import {
  createManager,
  managerNavigation,
  type ManagerAuthFailureStatus,
  type ManagerCredential,
  type ManagerDataFallbacks,
  type ManagerKnowledgeTagValues,
  type ManagerPresentation,
} from "@ontomato/ontology-manager";
import { managerMessageTree, type ManagerMessages } from "@ontomato/ontology-manager/i18n";
import {
  type PlatformPreferences,
  mergeMessages,
  type PlatformGroup,
  type PlatformLocale,
  type PlatformNavigation,
  type PlatformPage,
} from "@ontomato/platform-admin";
import { readRuntimeConfig } from "./config";
export { readRuntimeConfig } from "./config";
import { serviceHome } from "./view";
import "./style.css";

/** Every static difference between the two products' Manager pages. */
export interface ManagerShellProfile {
  /** Default UI locale; with a single supported locale it is fixed and no language control is shown. */
  locale: string;
  /** Manager messages per supported locale; its keys are the locales the page accepts. */
  messages: Readonly<Record<string, ManagerMessages>>;
  /** Fixed data defaults, independent of the UI locale. */
  dataFallbacks: ManagerDataFallbacks;
  /** This product's Manager presentation values (theme values, node palette, graph interaction, narrow dialogs, etc.). */
  presentation: ManagerPresentation;
  /** This product's stored values for the business knowledge tags. */
  knowledgeTagValues: ManagerKnowledgeTagValues;
}

/** The page's theme and language, shared by the layout, the Manager pages and the platform pages. */
type ManagerShellPreferences = PlatformPreferences;

const LEGACY_SESSION_KEYS = ["ontology_manager_token", "ontology_manager_api_key"];

/**
 * The page no longer takes credentials from its URL or keeps a tab session. Old launch links lose only their tk/apiKey
 * (the rest of the query and the hash stay) and a credential left in this tab's session by the old launch is dropped,
 * never migrated.
 */
export function discardLegacyLaunchCredential() {
  for (const key of LEGACY_SESSION_KEYS) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Storage unavailable: nothing was kept.
    }
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has("tk") && !url.searchParams.has("apiKey")) return;
  url.searchParams.delete("tk");
  url.searchParams.delete("apiKey");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Starts the page's theme and language once; call it before mounting anything that reads them. */
export function startShellPreferences(profile: ManagerShellProfile): ManagerShellPreferences {
  const { isDark, setTheme } = useTheme();
  const locale = workbenchI18n().global.locale;
  const locales = Object.keys(profile.messages);
  return {
    locales, locale,
    setLocale(value) { if (locales.includes(value)) locale.value = value as SupportedLocale; },
    theme: computed(() => isDark.value ? "dark" : "light"),
    setTheme,
  };
}

const STALE_BUILD_RELOAD_KEY = "ontology_manager_stale_build_reload";

/*
 * Pages load as hashed chunks on first entry. After a redeployment an open tab still runs the old entry, whose chunks
 * no longer exist; reload once so the tab picks up the new build (the page is kept in the hash). The key records which
 * entry already reloaded, so a chunk that still fails after the reload surfaces its error instead of reloading in a loop.
 */
export function reloadOnStaleBuild() {
  window.addEventListener("vite:preloadError", (event) => {
    const entry = import.meta.url;
    if (sessionStorage.getItem(STALE_BUILD_RELOAD_KEY) === entry) return;
    sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, entry);
    event.preventDefault();
    window.location.reload();
  });
}

/**
 * The page's locales: per supported locale, the platform pages' messages and Element Plus locale plus the Manager's
 * messages, in one vue-i18n tree. Both sides must cover the same locales.
 */
export function serviceLocales(
  profile: ManagerShellProfile,
  platformLocales: Readonly<Record<string, PlatformLocale>>
): Record<string, PlatformLocale> {
  return Object.fromEntries(
    Object.keys(profile.messages).map((locale) => {
      const platform = platformLocales[locale];
      if (!platform) throw new Error(`No platform messages for locale ${locale}`);
      return [
        locale,
        { messages: mergeMessages(platform.messages, managerMessageTree(profile.messages[locale])), element: platform.element },
      ];
    })
  );
}

export function installServiceMessages(profile: ManagerShellProfile, platformLocales: Readonly<Record<string, PlatformLocale>>) {
  const i18n = workbenchI18n();
  for (const [locale, { messages }] of Object.entries(serviceLocales(profile, platformLocales))) {
    i18n.global.mergeLocaleMessage(locale, messages);
  }
  return i18n;
}

/** The Manager pages' state for this page load, following the page's preferences and text. */
export function createServiceManager(options: {
  profile: ManagerShellProfile;
  preferences: ManagerShellPreferences;
  i18n: { global: { t(key: string, params?: Record<string, unknown>): string } };
  credential: ManagerCredential;
  onAuthFailure: (status: ManagerAuthFailureStatus) => void;
}) {
  const { profile, preferences, i18n } = options;
  return createManager({
    apiBase: readRuntimeConfig().apiBase,
    credential: options.credential,
    theme: preferences.theme,
    locale: preferences.locale,
    translate: (key, params) => i18n.global.t(key, params ?? {}),
    dataFallbacks: profile.dataFallbacks,
    presentation: profile.presentation,
    knowledgeTagValues: profile.knowledgeTagValues,
    onAuthFailure: options.onAuthFailure,
  });
}

/**
 * The Ontology Service navigation: the Manager's groups (ontology, assets, knowledge) followed by this edition's
 * platform administration group, in display order.
 */
export const ontologyWorkspacePages: readonly PlatformPage[] = [
  { path: platformRoutes.ontologySkills.path, titleKey: "capabilities.skillTitle", icon: Puzzle, permissions: ["skill-management"], group: "assets", ownHeader: true, count: skillLibraryCount },
];

/**
 * The system settings' connections the agent platform's pages draw: the external MCP services agents may call (its page
 * draws its own header) and the MCP services the platform publishes (under the settings' header).
 */
export const systemIntegrationPages: readonly PlatformPage[] = [
  { path: platformRoutes.externalMcp.path, titleKey: "capabilities.mcpTitle", icon: Cable, permissions: ["mcp-service"], group: "platform", ownHeader: true },
  { path: platformRoutes.publishedMcp.path, titleKey: "mcp.publishedSettingsTitle", descriptionKey: "mcp.publishedHint", icon: Plug, permissions: ["mcp-service"], group: "platform" },
];

/**
 * Each application's "Models" page of its ontology service agents. It keeps the permission those agents' choices have
 * always had (`system-config`), so only an account that holds it sees the entry or may open the page, without being given
 * any other page of the application. The page draws its own header.
 */
export const agentModelPages: readonly PlatformPage[] = ontologyAgentModelPages.map((page) => ({
  path: page.path,
  titleKey: "platform.agentModels.title",
  descriptionKey: "platform.agentModels.description",
  icon: Cpu,
  permissions: ["system-config"],
  group: page.app,
  ownHeader: true,
}));

export function serviceNavigation(
  manager: ReturnType<typeof createManager>,
  platformGroup: PlatformGroup,
  platformPages: readonly PlatformPage[]
): PlatformNavigation {
  const ontology = managerNavigation(manager.counts);
  return {
    groups: [...ontology.groups, platformGroup],
    pages: [...ontology.pages, ...platformPages, ...ontologyWorkspacePages, ...systemIntegrationPages, ...agentModelPages],
  };
}

/** The root address's landing page for this deployment (see `serviceHome`). */
export function startPage() {
  return managerDestination(serviceHome(readRuntimeConfig().initialRoute));
}

/** The gateway sends old Manager documents to the root with a source marker and their original fragment. */
export function normalizeManagerEntry() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("__manager")) return;
  discardLegacyLaunchCredential();
  // The old document put its page in the hash too (`<root>/#/objects`); that address is the page, not a suffix.
  const path = window.location.hash.replace(/^#/, "");
  const target = path && path !== "/" ? managerDestination(path) : startPage();
  window.history.replaceState(window.history.state, "", url.pathname + "#" + target);
}

/** Unmounts the page and shows only this status line (open source: a 401 has no sign-in to go to). */
export function stopPage(app: App, message: string) {
  app.unmount();
  const root = document.querySelector("#app");
  if (!root) return;
  const status = document.createElement("p");
  status.className = "manager-shell-status";
  status.setAttribute("role", "alert");
  status.textContent = message;
  root.append(status);
}
