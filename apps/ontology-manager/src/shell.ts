import type { App } from "vue";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
// Design foundation shared with the workbench (type, spacing, shape, density, elevation, motion, component variables).
import "@ontomato/design-tokens/foundation.css";
import { Sparkles } from "lucide-vue-next";
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
  createPlatformI18n,
  mergeMessages,
  type PlatformGroup,
  type PlatformI18n,
  type PlatformLink,
  type PlatformLocale,
  type PlatformNavigation,
  type PlatformPage,
} from "@ontomato/platform-admin";
import { readRuntimeConfig } from "./config";
import { syncLocale, syncTheme, type LocalePreference, type ThemePreference } from "./preferences";
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
export interface ManagerShellPreferences extends ThemePreference, LocalePreference {
  locales: readonly string[];
}

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
  const locales = Object.keys(profile.messages);
  return { ...syncTheme(), ...syncLocale(profile.locale, locales), locales };
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

/** The page's one vue-i18n instance over `serviceLocales`. */
export function createServiceI18n(
  profile: ManagerShellProfile,
  platformLocales: Readonly<Record<string, PlatformLocale>>,
  preferences: ManagerShellPreferences
) {
  const locales = serviceLocales(profile, platformLocales);
  return { locales, i18n: createPlatformI18n(locales, preferences.locale.value) };
}

/** The Manager pages' state for this page load, following the page's preferences and text. */
export function createServiceManager(options: {
  profile: ManagerShellProfile;
  preferences: ManagerShellPreferences;
  i18n: PlatformI18n;
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
export function serviceNavigation(
  manager: ReturnType<typeof createManager>,
  platformGroup: PlatformGroup,
  platformPages: readonly PlatformPage[]
): PlatformNavigation {
  const ontology = managerNavigation(manager.counts);
  return { groups: [...ontology.groups, platformGroup], pages: [...ontology.pages, ...platformPages] };
}

/** The root address's landing page for this deployment (see `serviceHome`). */
export function startPage() {
  return serviceHome(readRuntimeConfig().initialRoute);
}

/** The Agent Platform (the workbench, at the deployment root next to `ontology-manager/`), opened in a new tab. */
export function agentPlatformLink(href: string): PlatformLink {
  return { key: "agent-platform", titleKey: "platform.agentPlatform", icon: Sparkles, href };
}

/** The deployment root derived from the API root (`P/api` → `P/`), where the workbench lives. */
export function deploymentRoot(apiBase: string) {
  const url = new URL(apiBase, window.location.href);
  return `${url.pathname.replace(/\/+$/, "").replace(/\/api$/, "")}/`;
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
