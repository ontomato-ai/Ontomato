import { computed, createApp, h, ref, type Component, type ComputedRef } from "vue";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import {
  OntologyManager,
  type ManagerAuthFailureStatus,
  type ManagerCredential,
  type ManagerDataFallbacks,
  type ManagerKnowledgeTagValues,
  type ManagerPresentation,
} from "@ontomato/ontology-manager";
import { ontologyText, type ManagerMessages } from "@ontomato/ontology-manager/i18n";
import { readRuntimeConfig } from "./config";
import { ShellHeaderControls } from "./header-controls";
import { syncLocale, syncTheme, type LocalePreference, type ThemePreference } from "./preferences";
import { syncView } from "./view";
import "./style.css";

export { ShellHeaderControls };

/** Every static difference between the two products' standalone shells. */
export interface ManagerShellProfile {
  /** Default UI locale; with a single supported locale it is fixed and no language control is shown. */
  locale: string;
  /** Messages per supported locale; its keys are the locales the shell accepts. */
  messages: Readonly<Record<string, ManagerMessages>>;
  /** Fixed data defaults, independent of the UI locale. */
  dataFallbacks: ManagerDataFallbacks;
  /** This product's Manager presentation values (theme values, node palette, graph interaction, narrow dialogs, etc.). */
  presentation: ManagerPresentation;
  /** This product's stored values for the business knowledge tags. */
  knowledgeTagValues: ManagerKnowledgeTagValues;
}

/**
 * What the page's host supplies for one page load. The credential is fixed for the page: a host whose credential can
 * change (another tab signs in or out) rebuilds the whole page, so no old data or request outlives its credential.
 */
export interface ManagerShellHost {
  credential: ManagerCredential;
  /** 401/402 from a Manager request. Without it a 401 stops the component and reports the status. */
  onAuthFailure?: (status: ManagerAuthFailureStatus) => void;
  /** Host controls after the shell's theme and language controls (e.g. account and log out); receives `messages`. */
  headerActions?: Component;
}

/** The page's theme and language, shared by the Manager view and any host page on the same document. */
export interface ManagerShellPreferences extends ThemePreference, LocalePreference {
  locales: readonly string[];
  messages: ComputedRef<ManagerMessages>;
}

const LEGACY_SESSION_KEYS = ["ontology_manager_token", "ontology_manager_api_key"];

/**
 * The Manager no longer takes credentials from its URL or keeps a tab session. Old launch links lose only their tk/apiKey
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
  const theme = syncTheme();
  const locale = syncLocale(profile.locale, locales);
  return {
    ...theme,
    ...locale,
    locales,
    messages: computed(() => profile.messages[locale.locale.value]),
  };
}

const STALE_BUILD_RELOAD_KEY = "ontology_manager_stale_build_reload";

/*
 * Pages load as hashed chunks on first entry. After a redeployment an open tab still runs the old entry, whose chunks
 * no longer exist; reload once so the tab picks up the new build (the view is kept in the hash). The key records which
 * entry already reloaded, so a chunk that still fails after the reload surfaces its error instead of reloading in a loop.
 */
function reloadOnStaleBuild() {
  window.addEventListener("vite:preloadError", (event) => {
    const entry = import.meta.url;
    if (sessionStorage.getItem(STALE_BUILD_RELOAD_KEY) === entry) return;
    sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, entry);
    event.preventDefault();
    window.location.reload();
  });
}

export function startManagerShell(
  profile: ManagerShellProfile,
  host: ManagerShellHost,
  preferences: ManagerShellPreferences = startShellPreferences(profile)
) {
  reloadOnStaleBuild();
  discardLegacyLaunchCredential();
  const authExpired = ref(false);
  const { apiBase, initialRoute } = readRuntimeConfig();
  const { view, replaceView } = syncView(initialRoute);

  function onAuthFailure(status: ManagerAuthFailureStatus) {
    if (host.onAuthFailure) {
      host.onAuthFailure(status);
      return;
    }
    // 402 (license failure) keeps the component; the component shows the error.
    if (status === 401) authExpired.value = true;
  }

  createApp({
    render: () =>
      authExpired.value
        ? h(
            "p",
            { class: "manager-shell-status", role: "alert" },
            ontologyText(preferences.messages.value, "requestFailedStatus", { status: 401 })
          )
        : h(
            OntologyManager,
            {
              apiBase,
              credential: host.credential,
              locale: preferences.locale.value,
              messages: preferences.messages.value,
              theme: preferences.theme.value,
              view: view.value,
              dataFallbacks: profile.dataFallbacks,
              presentation: profile.presentation,
              knowledgeTagValues: profile.knowledgeTagValues,
              "onUpdate:view": replaceView,
              onAuthFailure,
            },
            {
              "header-actions": () => [
                h(ShellHeaderControls, { preferences }),
                host.headerActions
                  ? h(host.headerActions, { messages: preferences.messages.value })
                  : null,
              ],
            }
          ),
  }).mount("#app");
}
